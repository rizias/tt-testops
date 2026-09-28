import { readFileSync } from 'node:fs';
import type { Flags, RawQuery } from './args.js';
import { ConfigError } from './errors.js';
import { isFilterLink, parseFilterLink } from './links.js';
import { buildSources, extrasOf, type QueryToken, type Source } from './sources.js';

function resolveQuery(raw: string): Source {
  if (!isFilterLink(raw)) return { rql: raw };
  const parsed = parseFilterLink(raw);
  for (const w of parsed.warnings) process.stderr.write(`Предупреждение: ${w}\n`);
  return {
    rql: parsed.rql,
    project: parsed.projectId === null ? undefined : String(parsed.projectId),
    conditions: parsed.conditions,
    filterId: parsed.filterId ?? undefined,
    sortBy: parsed.sortBy ?? undefined,
    sortDirection: parsed.sortDirection ?? undefined,
  };
}

function withText<T extends Source>(source: T, text?: string): T {
  return text === undefined ? source : { ...source, text };
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

function sourcesOfQueries(f: Flags): Source[] {
  const queries = f.queries.map((q) => {
    const text = q.kind === 'file' ? readFileSync(q.value, 'utf8').trim() : q.value;
    return { ...resolveQuery(text), afterProject: q.afterProject };
  });

  const tokens: QueryToken[] = queries.map((q) => ({
    text: q.rql,
    afterProject: q.afterProject,
    ...extrasOf(q),
  }));
  if (queries.length <= 1) {
    if (f.projects.length || queries[0]?.project === undefined) {
      return buildSources(f.projects, tokens);
    }
    return [
      {
        rql: queries[0].rql,
        project: queries[0].project,
        ...extrasOf(queries[0]),
      },
    ];
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
    const built = { rql: query.rql, ...extrasOf(query) };
    if (query.afterProject >= 0) {
      used.add(query.afterProject);
      sources.push({ ...built, project: f.projects[query.afterProject] });
    } else if (query.project !== undefined) {
      sources.push({ ...built, project: query.project });
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

export function sourcesOf(f: Flags): Source[] {
  return sourcesOfQueries(f).map((source) => withText(source, f.text));
}
