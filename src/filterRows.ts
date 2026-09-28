import { type AppConfig, resolveProject } from './config.js';
import { UrlTooLongError } from './errors.js';
import { buildFilterLink, type LinkCondition } from './links.js';
import type { SourceResult } from './caseFetcher.js';
import type { RawCase } from './model.js';
import { directIds, type Source } from './sources.js';
import type { TestOpsClient } from './testops/client.js';

export interface FilterRow {
  project: number;
  projectName: string | null;
  count: number;
  parts: string[];
  url: string | null;
}

export interface FilterDeps {
  cfg: AppConfig;
  client: TestOpsClient;
  onWarn: (message: string) => void;
}

const CONDITION_NAMES: Record<string, string> = {
  tag: 'Теги',
  content: 'Содержимое',
  name: 'Название',
  id: 'Номер кейса',
  layer: 'Слой',
  status: 'Статус',
};

function valueOf(c: LinkCondition & { label?: unknown }): string {
  if (Array.isArray(c.label) && c.label.length) return c.label.join(', ');
  if (Array.isArray(c.value)) return c.value.join(', ');
  return String(c.value ?? '');
}

function conditionName(id: string, fields: Map<number, string>): string {
  const field = /^cfv\.(\d+)$/.exec(id);
  if (field) return fields.get(Number(field[1])) ?? `Поле ${field[1]}`;
  return CONDITION_NAMES[id] ?? id;
}

async function fieldNames(deps: FilterDeps, project: number, source: Source): Promise<Map<number, string>> {
  const needed = (source.conditions ?? []).some((c) => /^cfv\./.test(String(c.id ?? '')));
  if (!needed) return new Map();
  try {
    const fields = await deps.client.fetchCustomFields(project);
    return new Map(fields.map((f) => [f.id, f.name]));
  } catch {
    return new Map();
  }
}

function sourceParts(source: Source, fields: Map<number, string>): string[] {
  const parts: string[] = [];
  if (source.rql) parts.push(`AQL: ${source.rql}`);
  for (const c of source.conditions ?? []) {
    parts.push(`${conditionName(String(c.id ?? '?'), fields)}: ${valueOf(c)}`);
  }
  if (source.text) parts.push(`Содержимое: «${source.text}»`);
  if (source.filterId !== undefined) parts.push(`Сохранённый фильтр: ${source.filterId}`);
  return parts;
}

async function linkIfFits(deps: FilterDeps, project: number, rql: string): Promise<string | null> {
  try {
    await deps.client.countCases({ rql }, project);
  } catch (e) {
    if (e instanceof UrlTooLongError) return null;
    deps.onWarn(`длину ссылки на фильтр проекта ${project} проверить не удалось — ${(e as Error).message}`);
  }
  return buildFilterLink(deps.cfg.baseUrl, project, { rql });
}

async function rowsForIds(deps: FilterDeps, cases: RawCase[]): Promise<FilterRow[]> {
  const byProject = new Map<number, number[]>();
  for (const raw of cases) {
    const id = Number(raw.overview.id);
    const project = Number(raw.overview.projectId);
    if (!Number.isFinite(project)) continue;
    byProject.set(project, [...(byProject.get(project) ?? []), id]);
  }
  const rows: FilterRow[] = [];
  for (const [project, found] of byProject) {
    const rql = `id in [${found.join(', ')}]`;
    rows.push({
      project,
      projectName: deps.cfg.projects[String(project)] ?? null,
      count: found.length,
      parts: [`AQL: ${rql}`],
      url: await linkIfFits(deps, project, rql),
    });
  }
  return rows;
}

async function rowForSource(deps: FilterDeps, source: Source, cases: RawCase[]): Promise<FilterRow> {
  const project = resolveProject(deps.cfg, source.project);
  return {
    project,
    projectName: deps.cfg.projects[String(project)] ?? null,
    count: cases.length,
    parts: sourceParts(source, await fieldNames(deps, project, source)),
    url: buildFilterLink(deps.cfg.baseUrl, project, source),
  };
}

export async function buildFilterRows(
  deps: FilterDeps,
  sources: Source[],
  resultOf: (source: Source) => SourceResult | undefined,
): Promise<FilterRow[]> {
  const rows: FilterRow[] = [];
  for (const asked of sources) {
    const result = resultOf(asked);
    if (!result) continue;
    if (directIds(result.source)) rows.push(...(await rowsForIds(deps, result.cases)));
    else rows.push(await rowForSource(deps, result.source, result.cases));
  }
  return rows;
}

export const LINK_TOO_LONG = 'ссылку не составить: адрес длиннее, чем принимает сервер TestOps';

export function filterLines(rows: FilterRow[]): string[] {
  return rows.map(
    (r) => `Фильтр в TestOps (${r.projectName ?? r.project}): ${r.url ?? LINK_TOO_LONG}`,
  );
}
