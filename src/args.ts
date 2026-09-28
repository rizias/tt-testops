import type { TreeChoice } from './tree.js';

export interface RawQuery {
  kind: 'inline' | 'file';
  value: string;

  afterProject: number;
}

export interface Flags {
  _: string[];
  format?: string;

  projects: string[];

  queries: RawQuery[];
  limit?: number;
  out?: string;
  noMarks?: boolean;
  for?: string;

  tree?: TreeChoice;

  find?: string;

  text?: string;

  profile?: string;
  used: string[];
}

const FORMATS = ['markdown', 'html', 'raw'];

function treeFlag(raw: string): TreeChoice {
  const text = raw.trim();
  return /^\d+$/.test(text) ? Number(text) : text;
}

function parseFormat(value: string): string {
  if (!FORMATS.includes(value)) {
    throw new Error(`Формат «${value}» не поддерживается. Доступны: ${FORMATS.join(', ')}.`);
  }
  return value;
}

function parseLimit(raw: string): number {
  const limit = Number(raw);
  if (!Number.isInteger(limit) || limit <= 0) {
    throw new Error(`Флаг --limit должен быть целым числом больше нуля, получено: ${raw}.`);
  }
  return limit;
}

type FlagSetter = (f: Flags, value: string) => void;

const VALUE_FLAGS: Record<string, FlagSetter> = {
  '--format': (f, v) => {
    f.format = parseFormat(v);
  },
  '--project': (f, v) => {
    f.projects.push(v);
  },
  '--rql': (f, v) => addQuery(f, 'inline', v),
  '--rql-file': (f, v) => addQuery(f, 'file', v),
  '--limit': (f, v) => {
    f.limit = parseLimit(v);
  },
  '--out': (f, v) => {
    f.out = v;
  },
  '--for': (f, v) => {
    f.for = v;
  },
  '--find': (f, v) => {
    f.find = v;
  },
  '--text': (f, v) => {
    if (!v.trim()) throw new Error('Флагу --text нужна непустая фраза для поиска.');
    f.text = v;
  },
  '--tree': (f, v) => {
    f.tree = treeFlag(v);
  },
  '--profile': (f, v) => {
    f.profile = v;
  },
};

const BOOLEAN_FLAGS: Record<string, (f: Flags) => void> = {
  '--no-marks': (f) => {
    f.noMarks = true;
  },
};

function addQuery(f: Flags, kind: RawQuery['kind'], value: string): void {
  f.queries.push({ kind, value, afterProject: f.projects.length - 1 });
}

function valueAfter(args: string[], index: number): string {
  const value = args[index + 1];
  if (value === undefined || value.startsWith('--')) {
    throw new Error(`Флагу ${args[index]} нужно значение.`);
  }
  return value;
}

export function parseFlags(args: string[]): Flags {
  const f: Flags = { _: [], projects: [], queries: [], used: [] };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === undefined || a === '') continue;
    const withValue = VALUE_FLAGS[a];
    const bare = BOOLEAN_FLAGS[a];
    if (withValue || bare) f.used.push(a);
    if (withValue) withValue(f, valueAfter(args, i++));
    else if (bare) bare(f);
    else if (a.startsWith('--')) throw new Error(`Незнакомый флаг: ${a}.`);
    else {
      f._.push(a);
      addQuery(f, 'inline', a);
    }
  }
  return f;
}

const COMMON_FLAGS = ['--profile', '--out'];
const QUERY_FLAGS = ['--project', '--rql', '--rql-file', '--text'];

const COMMAND_FLAGS: Record<string, string[]> = {
  case: ['--format', '--no-marks', '--tree'],
  list: ['--format', '--no-marks', '--tree', '--limit', ...QUERY_FLAGS],
  count: QUERY_FLAGS,
  link: QUERY_FLAGS,
  fields: ['--project', '--find'],
  trees: ['--project'],
  projects: [],
  attachments: [],
  config: [],
  setup: [],
  update: [],
  init: ['--for'],
};

export function validateFlags(cmd: string, f: Flags): void {
  const allowed = new Set([...COMMON_FLAGS, ...(COMMAND_FLAGS[cmd] ?? [])]);
  const stray = f.used.find((flag) => !allowed.has(flag));
  if (stray !== undefined) throw new Error(`Флаг ${stray} у команды ${cmd} не используется.`);
  if (f.format === 'raw' && cmd !== 'case') {
    throw new Error(`Формат raw для команды ${cmd} не поддерживается — он только для case.`);
  }
  if (f.format === 'html' && cmd !== 'case' && cmd !== 'list') {
    throw new Error(`Формат html для команды ${cmd} не поддерживается — он для case и list.`);
  }
}
