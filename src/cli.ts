#!/usr/bin/env node
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { type Flags, parseFlags, validateFlags } from './args.js';
import { CATALOG_COMMANDS } from './catalogCommands.js';
import { handleAttachments, handleCase } from './caseCommand.js';
import { loadConfig } from './config.js';
import { Gateway } from './gateway.js';
import { handleCatalog, handleLink, handleList } from './listCommand.js';
import { LOCAL_COMMANDS, localCommand, storeCommand } from './localCommands.js';
import { finish, type CommandResult } from './output.js';
import { treesFromLinks } from './querySources.js';
import { loadProfile } from './profile.js';
import { keepInstalledSkillsFresh } from './skills/setup.js';
import { USAGE } from './usage.js';

const KNOWN = ['case', 'list', 'link', 'attachments', ...CATALOG_COMMANDS, ...LOCAL_COMMANDS];

type CommandHandler = (gw: Gateway, f: Flags) => Promise<CommandResult | number>;

const COMMAND_HANDLERS: Record<string, CommandHandler> = {
  case: handleCase,
  list: handleList,
  link: handleLink,
  ...Object.fromEntries(
    CATALOG_COMMANDS.map((cmd): [string, CommandHandler] => [cmd, (gw, f) => handleCatalog(cmd, gw, f)]),
  ),
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

function treeRequired(cmd: string): boolean {
  return cmd === 'case' || cmd === 'list';
}

async function runLocalCommand(cmd: string, f: Flags, startedAt: number): Promise<number> {
  const toolDir = join(dirname(fileURLToPath(import.meta.url)), '..');
  const result = await localCommand(cmd, f, ownVersion(), toolDir);
  return finish(result.output, f, null, startedAt, result.code);
}

async function buildGateway(cmd: string, f: Flags): Promise<Gateway> {
  const cfg = loadConfig({ profile: f.profile }, process.env);
  const profile = loadProfile(cfg.formatFile);
  const gw = Gateway.fromConfig(cfg, f.noMarks ? { ...profile, showMarks: false } : profile);
  gw.useTree(f.tree ?? null, treesFromLinks(f), treeRequired(cmd));
  return gw;
}

async function main(): Promise<number> {
  const startedAt = Date.now();
  const [cmd, ...rest] = process.argv.slice(2);
  if (cmd !== 'init') await keepInstalledSkillsFresh();

  const early = precheckCommand(cmd);
  if (early !== null) return early;
  const command = cmd as string;

  const f = parseFlags(rest);
  validateFlags(command, f);

  if (LOCAL_COMMANDS.includes(command) || storeCommand(command, f)) return runLocalCommand(command, f, startedAt);

  const gw = await buildGateway(command, f);
  if (command === 'attachments') return handleAttachments(gw, f, startedAt);

  const result = await (COMMAND_HANDLERS[command] as CommandHandler)(gw, f);
  if (typeof result === 'number') return result;

  return finish(result.out, f, result.htmlName, startedAt);
}

main()
  .then((code) => process.exit(code))
  .catch((e) => {
    process.stderr.write(`Error: ${(e as Error).message ?? e}\n`);
    process.exit(1);
  });
