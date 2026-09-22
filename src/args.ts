import { readFileSync } from 'node:fs';
import { ConfigError } from './errors.js';
import { isFilterLink, parseFilterLink } from './links.js';
import { idsOnly } from './queryCheck.js';
import { buildSources, type QueryToken, type Source } from './sources.js';
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
  refresh?: boolean;

  tree?: TreeChoice;

  find?: string;

  profile?: string;
  config?: string;
}

const FORMATS = ['markdown', 'json', 'html', 'raw'];

export interface SettingsFlags {
  profile?: string;
  config?: string;
  rest: string[];
}

export function extractSettingsFlags(args: string[]): SettingsFlags {
  const out: SettingsFlags = { rest: [] };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === undefined) continue;
    if (a === '--profile' || a === '--config') {
      const value = args[i + 1];
      if (value === undefined || value.startsWith('--')) {
        throw new Error(`Флагу ${a} нужно значение.`);
      }
      if (a === '--profile') out.profile = value;
      else out.config = value;
      i++;
    } else {
      out.rest.push(a);
    }
  }
  return out;
}

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
  '--tree': (f, v) => {
    f.tree = treeFlag(v);
  },
};

const BOOLEAN_FLAGS: Record<string, (f: Flags) => void> = {
  '--no-marks': (f) => {
    f.noMarks = true;
  },
  '--refresh': (f) => {
    f.refresh = true;
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
  const f: Flags = { _: [], projects: [], queries: [] };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === undefined || a === '') continue;
    const withValue = VALUE_FLAGS[a];
    const bare = BOOLEAN_FLAGS[a];
    if (withValue) withValue(f, valueAfter(args, i++));
    else if (bare) bare(f);
    else {
      f._.push(a);
      addQuery(f, 'inline', a);
    }
  }
  return f;
}

function resolveQuery(raw: string, project?: string): Source {
  if (!isFilterLink(raw)) return { rql: raw, project };
  const parsed = parseFilterLink(raw);
  for (const w of parsed.warnings) process.stderr.write(`Предупреждение: ${w}\n`);
  return {
    rql: parsed.rql,
    project: project ?? (parsed.projectId === null ? undefined : String(parsed.projectId)),
  };
}

function linkOf(q: RawQuery): { treeId: number | null; projectId: number | null } {
  const text = q.kind === 'file' ? readFileSync(q.value, 'utf8').trim() : q.value;
  if (!isFilterLink(text)) return { treeId: null, projectId: null };
  try {
    const parsed = parseFilterLink(text);
    return { treeId: parsed.treeId, projectId: parsed.projectId };
  } catch {
    return { treeId: null, projectId: null };
  }
}

function projectKeys(f: Flags, q: RawQuery, fromLink: number | null): string[] {
  if (f.queries.length <= 1 && f.projects.length) return f.projects;
  const explicit = q.afterProject >= 0 ? f.projects[q.afterProject] : undefined;
  if (explicit !== undefined) return [explicit];
  return fromLink === null ? [] : [String(fromLink)];
}

export function treesFromLinks(f: Flags): Record<string, number> {
  const out: Record<string, number> = {};
  for (const q of f.queries) {
    const { treeId, projectId } = linkOf(q);
    if (treeId === null) continue;
    for (const key of projectKeys(f, q, projectId)) out[key] = treeId;
  }
  return out;
}

export function projectsInPlay(f: Flags): Array<string | undefined> {
  const out = new Set<string | undefined>();
  const queryText = (q: RawQuery) =>
    q.kind === 'file' ? readFileSync(q.value, 'utf8').trim() : q.value;
  if (f.queries.length && f.queries.every((q) => idsOnly(queryText(q)))) return [];
  for (const q of f.queries) {
    const { projectId } = linkOf(q);
    for (const key of projectKeys(f, q, projectId)) out.add(key);
  }
  for (const p of f.projects) out.add(p);
  if (!out.size) out.add(undefined);
  return [...out];
}
export function sourcesOf(f: Flags): Source[] {
  const queries = f.queries.map((q) => {
    const text = q.kind === 'file' ? readFileSync(q.value, 'utf8').trim() : q.value;
    return { ...resolveQuery(text), afterProject: q.afterProject };
  });

  const tokens: QueryToken[] = queries.map((q) => ({
    text: q.rql,
    afterProject: q.afterProject,
  }));
  if (queries.length <= 1) {
    if (f.projects.length || queries[0]?.project === undefined) {
      return buildSources(f.projects, tokens);
    }
    return [{ rql: queries[0].rql, project: queries[0].project }];
  }

  const projectsFromLinks = queries.filter(
    (query) => query.afterProject < 0 && query.project !== undefined,
  ).length;
  const projectCount = f.projects.length + projectsFromLinks;
  if (projectCount !== queries.length) {
    throw new ConfigError(
      `Проектов ${projectCount}, а запросов ${queries.length}. Либо один запрос на все проекты, либо по запросу на каждый проект.`,
    );
  }

  const used = new Set<number>();
  const sources: Source[] = [];
  for (const query of queries) {
    if (query.afterProject >= 0) {
      used.add(query.afterProject);
      sources.push({ rql: query.rql, project: f.projects[query.afterProject] });
    } else if (query.project !== undefined) {
      sources.push({ rql: query.rql, project: query.project });
    } else {
      throw new ConfigError(
        `Запрос «${query.rql}» написан раньше первого --project — непонятно, к какому проекту он относится.`,
      );
    }
  }

  const orphan = f.projects.findIndex((_, index) => !used.has(index));
  if (orphan >= 0) {
    throw new ConfigError(
      `Проекту ${f.projects[orphan]} не досталось запроса. Допишите ему --rql или --rql-file.`,
    );
  }
  return sources;
}
