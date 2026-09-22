import { existsSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { Flags } from './args.js';
import { CaseCache, humanSize } from './cache.js';
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

export const LOCAL_COMMANDS = ['setup', 'cache', 'config', 'init', 'update'];
const INIT_TOOLS = ['claude', 'agents'] as const;
type InitTool = (typeof INIT_TOOLS)[number];

interface LocalCommandResult {
  output: string;
  code: number;
}

async function cacheOutput(f: Flags, env: NodeJS.ProcessEnv): Promise<string> {
  const settingsFlags = { profile: f.profile, config: f.config };
  const selection = resolveProfile(settingsFlags, env);
  const cache = new CaseCache(join(selection.profileDir, 'cache'));
  if (f._[0] === 'clear') {
    const before = cache.stats();
    await cache.clear(() =>
      process.stderr.write('Предупреждение: ожидание освобождения хранилища перед очисткой\n'),
    );
    if (f.format === 'json') return JSON.stringify({ cleared: before }, null, 2);
    return `Очищено: ${before.cases} кейсов, ${before.attachments} вложений, ${humanSize(before.bytes)}.`;
  }
  const s = cache.stats();
  const cfg = loadConfig(settingsFlags, env);
  const saved = cache.getSession(cfg.baseUrl, cfg.token);
  const session = saved ? { expiresAt: new Date(saved.expiresAt).toISOString() } : null;
  if (f.format === 'json') return JSON.stringify({ ...s, session }, null, 2);
  return [
    `Хранилище: ${s.dir}`,
    `Кейсов: ${s.cases}`,
    `Вложений: ${s.attachments}`,
    `Занимает: ${humanSize(s.bytes)}`,
    session
      ? `Сессия настроенной пары действует до: ${session.expiresAt}`
      : 'Сессия для настроенной пары отсутствует.',
  ].join('\n');
}

async function configOutput(f: Flags, env: NodeJS.ProcessEnv): Promise<LocalCommandResult> {
  const settingsFlags = { profile: f.profile, config: f.config };
  const words = f._.filter((word) => word !== '--json');
  const json = f.format === 'json' || words.length !== f._.length;
  const sub = words[0];
  if (sub === 'init') {
    const { created } = await configInit(f.profile ?? 'default', env);
    if (json) return { output: JSON.stringify({ created }, null, 2), code: 0 };
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
      output: json ? JSON.stringify(list, null, 2) : renderProfilesText(list),
      code: 0,
    };
  }
  const view = configView(settingsFlags, env);
  return {
    output: json ? JSON.stringify(view, null, 2) : renderConfigText(view),
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
  env: NodeJS.ProcessEnv = process.env,
): Promise<LocalCommandResult> {
  if (cmd === 'setup') {
    const advice = setupAdvice(f._[0] ?? process.cwd(), toolDir, version);
    return {
      output: f.format === 'json' ? JSON.stringify(advice, null, 2) : advice.lines.join('\n'),
      code: 0,
    };
  }
  if (cmd === 'cache') return { output: await cacheOutput(f, env), code: 0 };
  if (cmd === 'config') return configOutput(f, env);
  if (cmd === 'update') return { output: '', code: runUpdate() };
  return initOutput(f);
}
