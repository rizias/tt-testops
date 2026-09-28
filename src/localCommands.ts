import { existsSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Flags } from './args.js';
import { AttachmentStore, humanSize } from './attachmentStore.js';
import {
  configInit,
  configProfiles,
  configUse,
  configView,
  renderConfigText,
  renderProfilesText,
} from './configCommand.js';
import { loadConfig } from './config.js';
import { ConfigError } from './errors.js';
import { resolveProfile } from './settingsPaths.js';
import { setupAdvice } from './setup.js';
import { runInit, runUpdate } from './skills/setup.js';

export const LOCAL_COMMANDS = ['setup', 'config', 'init', 'update'];

export function storeCommand(cmd: string, f: Flags): boolean {
  return cmd === 'attachments' && (f._[0] === undefined || f._[0] === 'clear');
}
const INIT_TOOLS = ['claude', 'agents'] as const;
type InitTool = (typeof INIT_TOOLS)[number];

interface LocalCommandResult {
  output: string;
  code: number;
}

async function storeOutput(f: Flags, env: NodeJS.ProcessEnv): Promise<string> {
  const settingsFlags = { profile: f.profile };
  const selection = resolveProfile(settingsFlags, env);
  const store = new AttachmentStore(selection.profileDir);
  if (f._[0] === 'clear') {
    const before = store.stats();
    await store.clear(() =>
      process.stderr.write('Предупреждение: ожидание освобождения хранилища перед очисткой\n'),
    );
    return `Очищено: файлов вложений ${before.files}, ${humanSize(before.bytes)}; сессии и списки деревьев удалены.`;
  }
  const s = store.stats();
  const cfg = loadConfig(settingsFlags, env);
  const saved = store.getSession(cfg.baseUrl, cfg.token);
  return [
    `Хранилище: ${s.dir}`,
    `Файлов вложений: ${s.files}`,
    `Занимает: ${humanSize(s.bytes)}`,
    saved
      ? saved.expiresAt === null
        ? 'Сессия настроенной пары без срока: действует, пока сервер её не отверг.'
        : `Сессия настроенной пары действует до: ${new Date(saved.expiresAt).toISOString()}`
      : 'Сессия для настроенной пары отсутствует.',
  ].join('\n');
}

async function configOutput(f: Flags, env: NodeJS.ProcessEnv): Promise<LocalCommandResult> {
  const settingsFlags = { profile: f.profile };
  const words = f._;
  const sub = words[0];
  if (sub === 'init') {
    const { created } = await configInit(f.profile ?? 'default', env);
    return {
      output: created.length ? `Создано:\n${created.join('\n')}` : 'Уже создано, изменений нет.',
      code: 0,
    };
  }
  if (sub === 'use') {
    const name = words[1];
    if (!name) throw new ConfigError('Команде config use нужно имя профиля: tt-testops config use <профиль>. Список — tt-testops config profiles.');
    await configUse(name, env);
    return { output: `Текущий профиль: ${name}`, code: 0 };
  }
  if (sub === 'profiles') {
    const list = configProfiles(env);
    return {
      output: renderProfilesText(list),
      code: 0,
    };
  }
  const view = configView(settingsFlags, env);
  return {
    output: renderConfigText(view),
    code: 0,
  };
}

function toolsFrom(names: string): InitTool[] {
  const tools = names.split(',').map((s) => s.trim()) as InitTool[];
  const unknown = tools.filter((tool) => !INIT_TOOLS.includes(tool));
  if (unknown.length)
    throw new Error(
      `Неизвестный инструмент: ${unknown.join(', ')}. Доступны: ${INIT_TOOLS.join(', ')}.`,
    );
  return tools;
}

async function initOutput(f: Flags): Promise<LocalCommandResult> {
  const project = f._[0] ?? process.cwd();
  const tools = f.for === undefined ? undefined : toolsFrom(f.for);
  if (tools === undefined && !process.stdin.isTTY) {
    throw new ConfigError(
      'Некого спросить: ввод не терминал. Назови каталоги явно, например --for claude,agents. Ничего не создано.',
    );
  }
  const root = resolve(project);
  if (!existsSync(root) || !statSync(root).isDirectory()) {
    throw new ConfigError(`Проекта нет по пути: ${root}. Ничего не создано.`);
  }
  const report = await runInit(project, tools);
  return {
    output: JSON.stringify(report, null, 2),
    code: report.skipped.length === 0 ? 0 : 1,
  };
}

export async function localCommand(
  cmd: string,
  f: Flags,
  version: string,
  toolDir: string,
): Promise<LocalCommandResult> {
  if (cmd === 'setup') {
    const advice = setupAdvice(f._[0] ?? process.cwd(), toolDir, version);
    return { output: advice.lines.join('\n'), code: 0 };
  }
  if (cmd === 'attachments') return { output: await storeOutput(f, process.env), code: 0 };
  if (cmd === 'config') return configOutput(f, process.env);
  if (cmd === 'update') {
    const code = runUpdate();
    process.exitCode = code;
    return { output: '', code };
  }
  return initOutput(f);
}
