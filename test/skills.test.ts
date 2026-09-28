import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createAsk, type Terminal } from '../src/skills/setup.js';
import { installSkills, maybeRefreshSkills } from '../src/skills/updater.js';
import type { Ask, TargetOption } from '../src/skills/updaterState.js';

let root: string;
let project: string;
let stateDir: string;
let templates: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'tt-skills-'));
  project = join(root, 'project');
  stateDir = join(root, 'state');
  templates = join(root, 'templates');
  mkdirSync(project);
  cpSync(join(process.cwd(), 'skills'), templates, { recursive: true });
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

const destination = () => join(project, '.claude', 'skills', 'tt-testops');
const template = () => join(templates, 'tt-testops');
const registryFile = () => join(stateDir, 'skills-registry.json');
const SHIPPED = [
  'SKILL.md',
  'references/aql.md',
  'references/commands.md',
  'references/format.md',
  'references/settings.md',
];

function ask(confirm = true): Ask {
  return {
    chooseTargets: async () => [{ id: 'custom', root: join(project, '.claude', 'skills') }],
    confirm: async () => confirm,
  };
}

function options(version: string, confirm = true) {
  return {
    pkgName: 'tt-testops',
    version,
    templates,
    stateDir,
    ask: ask(confirm),
    projectDir: project,
  };
}

function stubTerminal(answers: string[], prompts: string[]): Terminal {
  return {
    question: async (prompt) => {
      prompts.push(prompt);
      return answers.shift() ?? '';
    },
    close: () => undefined,
  };
}

function changeTemplateStamp(version: string): void {
  const file = join(template(), 'SKILL.md');
  const text = readFileSync(file, 'utf8').replace(
    /tt-testops-skill-version: [^\n]+/,
    `tt-testops-skill-version: ${version}`,
  );
  writeFileSync(file, text, 'utf8');
}

describe('установка скиллов', () => {
  it('пишет реестр и копию, равную шаблону, по указанному пути', async () => {
    const report = await installSkills(options('0.1.0'));
    expect(report.installed).toEqual([destination().replace(/\\/g, '/')]);
    expect(readFileSync(join(destination(), 'SKILL.md'), 'utf8')).toBe(
      readFileSync(join(template(), 'SKILL.md'), 'utf8'),
    );
    const registry = JSON.parse(readFileSync(registryFile(), 'utf8'));
    expect(registry['tt-testops'].version).toBe('0.1.0');
    expect(registry['tt-testops'].skills['tt-testops'][0]).toEqual({
      path: destination().replace(/\\/g, '/'),
      files: SHIPPED,
    });
    for (const file of SHIPPED) {
      expect(readFileSync(join(destination(), file))).toEqual(readFileSync(join(template(), file)));
    }
  });

  it('без подтверждения не создаёт копию и реестр', async () => {
    const report = await installSkills(options('0.1.0', false));
    expect(report.installed).toEqual([]);
    expect(report.skipped).toEqual([]);
    expect(existsSync(destination())).toBe(false);
    expect(existsSync(registryFile())).toBe(false);
  });

  it('обновляет копию по новому штампу и сохраняет чужой файл', async () => {
    await installSkills(options('0.1.0'));
    const foreign = join(destination(), 'new-file.txt');
    writeFileSync(foreign, 'чужой файл', 'utf8');
    writeFileSync(join(template(), 'new-file.txt'), 'файл пакета', 'utf8');
    changeTemplateStamp('0.2.0');

    const report = maybeRefreshSkills({
      pkgName: 'tt-testops',
      version: '0.2.0',
      templates,
      stateDir,
    });
    expect(report.refreshed).toEqual([]);
    expect(report.skipped).toEqual([
      expect.objectContaining({ path: destination().replace(/\\/g, '/'), reason: 'foreign-files' }),
    ]);
    expect(readFileSync(foreign, 'utf8')).toBe('чужой файл');
    expect(readFileSync(join(destination(), 'SKILL.md'), 'utf8')).not.toBe(
      readFileSync(join(template(), 'SKILL.md'), 'utf8'),
    );
  });

  it('обновляет копию при смене штампа, если чужого файла нет', async () => {
    await installSkills(options('0.1.0'));
    changeTemplateStamp('0.2.0');
    const report = maybeRefreshSkills({
      pkgName: 'tt-testops',
      version: '0.2.0',
      templates,
      stateDir,
    });
    expect(report.refreshed).toEqual([destination().replace(/\\/g, '/')]);
    expect(readFileSync(join(destination(), 'SKILL.md'), 'utf8')).toBe(
      readFileSync(join(template(), 'SKILL.md'), 'utf8'),
    );
  });

  it('refreshes a copy and preserves a foreign file absent from the template', async () => {
    await installSkills(options('0.1.0'));
    const foreign = join(destination(), 'user-file.txt');
    writeFileSync(foreign, 'чужой файл', 'utf8');
    changeTemplateStamp('0.2.0');

    const report = maybeRefreshSkills({
      pkgName: 'tt-testops',
      version: '0.2.0',
      templates,
      stateDir,
    });
    expect(report.refreshed).toEqual([destination().replace(/\\/g, '/')]);
    expect(readFileSync(join(destination(), 'SKILL.md'), 'utf8')).toBe(
      readFileSync(join(template(), 'SKILL.md'), 'utf8'),
    );
    expect(readFileSync(foreign, 'utf8')).toBe('чужой файл');
  });

  it('убирает из копии дополнение, которое пакет больше не поставляет, и не трогает файл пользователя', async () => {
    await installSkills(options('0.1.0'));
    const own = join(destination(), 'notes.md');
    writeFileSync(own, 'заметки пользователя', 'utf8');
    rmSync(join(template(), 'references', 'aql.md'));
    changeTemplateStamp('0.2.0');

    const report = maybeRefreshSkills({
      pkgName: 'tt-testops',
      version: '0.2.0',
      templates,
      stateDir,
    });
    expect(report.refreshed).toEqual([destination().replace(/\\/g, '/')]);
    expect(existsSync(join(destination(), 'references', 'aql.md'))).toBe(false);
    expect(readFileSync(join(destination(), 'references', 'settings.md'))).toEqual(
      readFileSync(join(template(), 'references', 'settings.md')),
    );
    expect(readFileSync(own, 'utf8')).toBe('заметки пользователя');
    const registry = JSON.parse(readFileSync(registryFile(), 'utf8'));
    expect(registry['tt-testops'].skills['tt-testops'][0].files).toEqual(
      SHIPPED.filter((file) => file !== 'references/aql.md'),
    );
  });

  it('asks for project or custom skill destination without a global option', async () => {
    const prompts: string[] = [];
    const writes = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const targetOptions: TargetOption[] = [
      {
        id: 'project',
        roots: [join(project, '.claude', 'skills'), join(project, '.agents', 'skills')],
      },
      { id: 'custom', roots: [] },
    ];
    const choose = (answers: string[]) =>
      createAsk(stubTerminal(answers, prompts), project).chooseTargets({
        skills: ['tt-testops'],
        options: targetOptions,
      });
    const customRoot = join(root, 'custom-skills');

    try {
      await expect(choose(['1'])).resolves.toEqual([{ id: 'project' }]);
      await expect(choose(['2', customRoot])).resolves.toEqual([
        { id: 'custom', root: customRoot },
      ]);
      await expect(choose([''])).resolves.toEqual([]);
      const text = [...prompts, ...writes.mock.calls.map(([value]) => String(value))].join('\n');
      expect(text).not.toMatch(/global/i);
      expect(text).not.toMatch(/глобально/i);
      expect(text).toContain(project);
      expect(text).toContain(join(project, '.claude', 'skills'));
      expect(text).toContain(join(project, '.agents', 'skills'));
    } finally {
      writes.mockRestore();
    }
  });

  it('prints every confirmation path and accepts only y or Y', async () => {
    const writes = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const ask = createAsk(stubTerminal(['y', 'Y', 'n', 'yes'], []), project);
    const paths = [join(project, 'one'), join(project, 'two')];

    try {
      await expect(ask.confirm({ message: 'install?', paths })).resolves.toBe(true);
      await expect(ask.confirm({ message: 'install?', paths })).resolves.toBe(true);
      await expect(ask.confirm({ message: 'install?', paths })).resolves.toBe(false);
      await expect(ask.confirm({ message: 'install?', paths })).resolves.toBe(false);
      const text = writes.mock.calls.map(([value]) => String(value)).join('');
      for (const target of paths) expect(text).toContain(target);
    } finally {
      writes.mockRestore();
    }
  });

  it('не переписывает уже актуальную копию', async () => {
    await installSkills(options('0.1.0'));
    const skillFile = join(destination(), 'SKILL.md');
    const oldTime = new Date('2020-01-02T03:04:05.000Z');
    utimesSync(skillFile, oldTime, oldTime);
    const before = statSync(skillFile).mtimeMs;
    const report = maybeRefreshSkills({
      pkgName: 'tt-testops',
      version: '0.1.0',
      templates,
      stateDir,
    });
    expect(report).toEqual({ refreshed: [], skipped: [] });
    expect(statSync(skillFile).mtimeMs).toBe(before);
  });

  it('удаляет из реестра запись с исчезнувшим родительским каталогом и отдаёт её в pruned', async () => {
    await installSkills(options('0.1.0'));
    rmSync(join(project, '.claude', 'skills'), { recursive: true, force: true });
    const report = await installSkills({ ...options('0.1.0'), ask: ask(false) });
    expect(report.pruned).toEqual([destination().replace(/\\/g, '/')]);
    expect(JSON.parse(readFileSync(registryFile(), 'utf8'))['tt-testops'].skills).toEqual({});
  });

  it('помечает недоступный путь в реестре и не печатает его повторно в те же сутки', async () => {
    await installSkills(options('0.1.0'));
    rmSync(join(project, '.claude', 'skills'), { recursive: true, force: true });
    const write = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    try {
      const first = maybeRefreshSkills({
        pkgName: 'tt-testops',
        version: '0.1.0',
        templates,
        stateDir,
      });
      const second = maybeRefreshSkills({
        pkgName: 'tt-testops',
        version: '0.1.0',
        templates,
        stateDir,
      });
      expect(first.skipped).toEqual([
        expect.objectContaining({ path: destination().replace(/\\/g, '/'), reason: 'unavailable' }),
      ]);
      expect(second.skipped).toEqual(first.skipped);
      expect(write).toHaveBeenCalledTimes(1);
      expect(write.mock.calls[0]?.[0]).toContain('path unavailable');
      const registry = JSON.parse(readFileSync(registryFile(), 'utf8'));
      expect(registry['tt-testops'].unavailable).toHaveProperty(destination().replace(/\\/g, '/'));
    } finally {
      write.mockRestore();
    }
  });
});
