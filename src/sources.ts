import { ConfigError } from './errors.js';
import type { LinkCondition } from './links.js';
import { idsOnly } from './queryCheck.js';

export interface Source {
  project?: string;
  rql: string;
  conditions?: LinkCondition[];
  filterId?: number;
  text?: string;
  sortBy?: string;
  sortDirection?: string;
}

export function directIds(source: Source): number[] | null {
  if (source.text || source.conditions?.length || source.filterId !== undefined) return null;
  return idsOnly(source.rql);
}

export type SourceExtra = Pick<Source, 'conditions' | 'filterId' | 'sortBy' | 'sortDirection'>;

export function extrasOf(q: SourceExtra | undefined): SourceExtra {
  return {
    conditions: q?.conditions,
    filterId: q?.filterId,
    sortBy: q?.sortBy,
    sortDirection: q?.sortDirection,
  };
}

export interface QueryToken extends SourceExtra {
  text: string;

  afterProject: number;
}

export function buildSources(projects: string[], queries: QueryToken[]): Source[] {
  if (!queries.length && projects.length > 1) {
    throw new ConfigError(
      `Проектов ${projects.length}, а запросов 0. Один проект можно выгрузить целиком, для нескольких нужен запрос на каждый.`,
    );
  }

  if (queries.length <= 1) {
    const q = queries[0];
    const rql = q?.text ?? '';
    if (!projects.length) return [{ project: undefined, rql, ...extrasOf(q) }];
    return projects.map((project) => ({ project, rql, ...extrasOf(q) }));
  }

  if (queries.length !== projects.length) {
    throw new ConfigError(
      `Проектов ${projects.length}, а запросов ${queries.length}. Либо один запрос на все проекты, либо по запросу на каждый проект.`,
    );
  }

  const used = new Set<number>();
  const sources: Source[] = [];
  for (const q of queries) {
    if (q.afterProject < 0) {
      throw new ConfigError(
        `Запрос «${q.text}» написан раньше первого --project — непонятно, к какому проекту он относится.`,
      );
    }
    used.add(q.afterProject);
    sources.push({
      project: projects[q.afterProject],
      rql: q.text,
      ...extrasOf(q),
    });
  }

  const orphan = projects.findIndex((_, i) => !used.has(i));
  if (orphan >= 0) {
    throw new ConfigError(
      `Проекту ${projects[orphan]} не досталось запроса. Допишите ему --rql или --rql-file.`,
    );
  }
  return sources;
}
