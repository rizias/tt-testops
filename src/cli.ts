#!/usr/bin/env node
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  extractSettingsFlags,
  type Flags,
  parseFlags,
  projectsInPlay,
  treesFromLinks,
} from './args.js';
import { CATALOG_COMMANDS } from './catalogCommands.js';
import { handleAttachments, handleCase } from './caseCommand.js';
import { loadConfig } from './config.js';
import { Gateway } from './gateway.js';
import { handleAudit, handleCatalog, handleLink, handleList } from './listCommand.js';
import { LOCAL_COMMANDS, localCommand } from './localCommands.js';
import { finish, type CommandResult } from './output.js';
import { loadProfile } from './profile.js';
import { lostReport } from './report.js';
import { keepInstalledSkillsFresh } from './skills/setup.js';
import { USAGE } from './usage.js';

const KNOWN = ['case', 'list', 'audit', 'link', 'attachments', ...CATALOG_COMMANDS, ...LOCAL_COMMANDS];

type CommandHandler = (gw: Gateway, f: Flags) => Promise<CommandResult | number>;

const COMMAND_HANDLERS: Record<string, CommandHandler> = {
  case: handleCase,
  list: handleList,
  audit: handleAudit,
  link: handleLink,
  fields: (gw, f) => handleCatalog('fields', gw, f),
  trees: (gw, f) => handleCatalog('trees', gw, f),
  projects: (gw, f) => handleCatalog('projects', gw, f),
  count: (gw, f) => handleCatalog('count', gw, f),
};

function ownVersion(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  for (const p of [join(here, '../package.json'), join(here, '../../package.json')]) {
    if (existsSync(p))
      return (JSON.parse(readFileSync(p, 'utf8')) as { version?: string }).version ?? '0.0.0';
  }
  return '0.0.0';
}

function precheckCommand(cmd: string | undefined): number | null {
  if (!cmd || cmd === '-h' || cmd === '--help') {
    process.stdout.write(`${USAGE}\n`);
    return cmd ? 0 : 1;
  }
  if (cmd === '--version' || cmd === '-v') {
    process.stdout.write(`${ownVersion()}\n`);
    return 0;
  }
  if (!KNOWN.includes(cmd)) {
    process.stderr.write(
      `Unknown command: ${cmd}
Продукт только читает: изменить кейс, раздел или значение поля можно в интерфейсе TestOps.
${USAGE}
`,
    );
    return 1;
  }
  return null;
}

function buildFlags(rest: string[]): Flags {
  const settingsFlags = extractSettingsFlags(rest);
  const f = parseFlags(settingsFlags.rest);
  f.profile = settingsFlags.profile;
  f.config = settingsFlags.config;
  return f;
}

function validateFlags(cmd: string, f: Flags): void {
  if (f.format === 'raw' && cmd !== 'case') {
    throw new Error(`Формат raw для команды ${cmd} не поддерживается — он только для case.`);
  }
  if (f.format === 'html' && !['case', 'list'].includes(cmd)) {
    throw new Error(`Формат html для команды ${cmd} не поддерживается — он для case и list.`);
  }
  if (f.find !== undefined && cmd !== 'fields') {
    throw new Error(`Флаг --find есть только у команды fields, а не у ${cmd}.`);
  }
}

function treeRequired(cmd: string): boolean {
  return cmd === 'case' || cmd === 'list';
}

async function runLocalCommand(cmd: string, f: Flags, startedAt: number): Promise<number> {
  const toolDir = join(dirname(fileURLToPath(import.meta.url)), '..');
  const result = await localCommand(cmd, f, ownVersion(), toolDir);
  return finish(result.output, f, null, startedAt, result.code);
}

async function buildGateway(cmd: string, f: Flags): Promise<Gateway> {
  const cfg = loadConfig({ profile: f.profile, config: f.config }, process.env);
  const profile = loadProfile(cfg.formatFile);
  const gw = Gateway.fromConfig(
    cfg,
    f.noMarks && cmd !== 'audit' ? { ...profile, showMarks: false } : profile,
    f.refresh ?? false,
  );
  gw.useTree(f.tree ?? null, treesFromLinks(f), treeRequired(cmd));
  if (cmd !== 'projects' && cmd !== 'case') {
    for (const p of projectsInPlay(f)) gw.warnUnagreed(p);
  }
  return gw;
}

async function main(): Promise<number> {
  const startedAt = Date.now();
  const [cmd, ...rest] = process.argv.slice(2);
  if (cmd !== 'init') await keepInstalledSkillsFresh();

  const early = precheckCommand(cmd);
  if (early !== null) return early;
  const command = cmd as string;

  const f = buildFlags(rest);
  validateFlags(command, f);

  if (LOCAL_COMMANDS.includes(command)) return runLocalCommand(command, f, startedAt);

  const gw = await buildGateway(command, f);
  if (command === 'attachments') return handleAttachments(gw, f, startedAt);

  const handler = COMMAND_HANDLERS[command];
  if (!handler) throw new Error(`Unknown command: ${command}`);
  const result = await handler(gw, f);
  if (typeof result === 'number') return result;

  const lost = lostReport(gw.lostAttachments());
  if (lost) process.stderr.write(`Предупреждение: ${lost}\n`);
  return finish(result.out, f, result.htmlName, startedAt);
}

main()
  .then((code) => process.exit(code))
  .catch((e) => {
    process.stderr.write(`Error: ${(e as Error).message ?? e}\n`);
    process.exit(1);
  });
