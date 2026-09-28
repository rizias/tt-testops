import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';
import { ConfigError } from '../errors.js';
import { homeDirFrom, stateDir } from '../settingsPaths.js';
import { withLock } from '../stateLock.js';
import { installSkills, maybeRefreshSkills } from './updater.js';
import { type Ask, type ChosenTarget, type InstallReport, samePath, type TargetOption } from './updaterState.js';

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
type InitTool = 'claude' | 'agents';
const GLOBAL_SKILL_DIRS = ['.claude', '.agents', '.codex'];

function refuseGlobalRoot(root: string): void {
  const home = homeDirFrom(process.env);
  const expanded = root.startsWith('~') ? path.join(home, root.slice(1)) : root;
  const globalRoot = GLOBAL_SKILL_DIRS.map((dir) => path.join(home, dir, 'skills')).find((dir) =>
    samePath(dir, expanded),
  );
  if (globalRoot === undefined) return;
  throw new ConfigError(
    `Скилл не ставится глобально: ${globalRoot} — каталог домашней папки, скилл оттуда виден во всех проектах. Назови каталог проекта: tt-testops init <путь к проекту>. Ничего не создано.`,
  );
}

function refuseHomeProject(projectDir: string): void {
  for (const dir of GLOBAL_SKILL_DIRS) refuseGlobalRoot(path.join(path.resolve(projectDir), dir, 'skills'));
}

function packageMeta(): { name: string; version: string } {
  const parsed = JSON.parse(readFileSync(path.join(packageRoot, 'package.json'), 'utf8')) as {
    name: string;
    version: string;
  };
  return parsed;
}

export { stateDir };

export function templatesDir(): string {
  return path.join(packageRoot, 'skills');
}

export function runUpdate(): number {
  const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const result = spawnSync(npm, ['i', '-g', `${packageMeta().name}@latest`], {
    stdio: ['inherit', 'inherit', 'inherit'],
    windowsHide: false,
    shell: process.platform === 'win32',
  });
  return result.status ?? 1;
}

export interface Terminal {
  question(prompt: string): Promise<string>;
  close(): void;
}

function createTerminal(): Terminal {
  const reader = readline.createInterface({ input: process.stdin, output: process.stdout });
  const lines: string[] = [];
  const waiters: ((line: string) => void)[] = [];
  reader.on('line', (line) => {
    const waiter = waiters.shift();
    if (waiter) waiter(line);
    else lines.push(line);
  });
  reader.on('close', () => {
    while (waiters.length > 0) waiters.shift()?.('');
  });
  return {
    question(prompt: string): Promise<string> {
      process.stderr.write(prompt);
      const ready = lines.shift();
      if (ready !== undefined) return Promise.resolve(ready);
      return new Promise((resolve) => waiters.push(resolve));
    },
    close(): void {
      reader.close();
    },
  };
}

function writeTargets(options: TargetOption[], projectDir: string, skills: string[]): void {
  const project = options.find((option) => option.id === 'project');
  const roots = project?.roots.join(', ') ?? '';
  process.stderr.write(
    [
      `Проект: ${path.resolve(projectDir)}`,
      '',
      `Скиллы к установке: ${skills.join(', ')}`,
      'Куда ставить скилл?',
      `  1. этот проект -> ${roots}`,
      '  2. путь, который введёте',
      '',
    ].join('\n'),
  );
}

export function createAsk(terminal: Terminal, projectDir: string, tools?: InitTool[]): Ask {
  return {
    async chooseTargets({ skills, options }) {
      if (tools !== undefined) {
        return tools.map((tool) => ({
          id: 'custom',
          root: path.join(path.resolve(projectDir), `.${tool}`, 'skills'),
        }));
      }
      writeTargets(options, projectDir, skills);
      const picked = await terminal.question('Куда ставить (1 или 2, пусто — отмена): ');
      const chosen: ChosenTarget[] = [];
      for (const part of picked
        .split(',')
        .map((value) => value.trim())
        .filter(Boolean)) {
        const option = options[Number(part) - 1];
        if (option === undefined) continue;
        if (option.id === 'custom') {
          const root = (await terminal.question('Путь: ')).trim();
          if (root !== '') {
            refuseGlobalRoot(root);
            chosen.push({ id: 'custom', root });
          }
        } else {
          chosen.push({ id: option.id });
        }
      }
      return chosen;
    },

    async confirm({ message, paths }) {
      if (tools !== undefined) return true;
      for (const target of paths) process.stderr.write(`  ${target}\n`);
      const answer = await terminal.question(`${message} [y/N]: `);
      return answer.trim().toLowerCase() === 'y';
    },
  };
}

export async function runInit(projectDir: string, tools?: InitTool[]): Promise<InstallReport> {
  refuseHomeProject(projectDir);
  await keepInstalledSkillsFresh();
  const meta = packageMeta();
  const terminal = createTerminal();
  try {
    return await withLock(stateDir(), () =>
      installSkills({
        pkgName: meta.name,
        version: meta.version,
        templates: templatesDir(),
        stateDir: stateDir(),
        ask: createAsk(terminal, projectDir, tools),
        projectDir,
      }),
    );
  } finally {
    terminal.close();
  }
}

export async function keepInstalledSkillsFresh(): Promise<void> {
  try {
    if (process.stdout.isTTY) {
      const { default: updateNotifier } = await import('update-notifier');
      updateNotifier({ pkg: packageMeta(), updateCheckInterval: 1000 * 60 * 60 * 24 }).notify();
    }
    const meta = packageMeta();
    await withLock(stateDir(), () =>
      maybeRefreshSkills({
        pkgName: meta.name,
        version: meta.version,
        templates: templatesDir(),
        stateDir: stateDir(),
      }),
    );
  } catch {
    return;
  }
}
