import { ConfigError } from './errors.js';

export interface Source {
  project?: string;
  rql: string;
}

export interface QueryToken {
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
    const rql = queries[0]?.text ?? '';
    if (!projects.length) return [{ project: undefined, rql }];
    return projects.map((project) => ({ project, rql }));
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
    sources.push({ project: projects[q.afterProject], rql: q.text });
  }

  const orphan = projects.findIndex((_, i) => !used.has(i));
  if (orphan >= 0) {
    throw new ConfigError(
      `Проекту ${projects[orphan]} не досталось запроса. Допишите ему --rql или --rql-file.`,
    );
  }
  return sources;
}
