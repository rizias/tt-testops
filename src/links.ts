import { QueryError } from './errors.js';

export interface LinkCondition {
  id?: unknown;
  value?: unknown;
  type?: unknown;
}

export interface ConditionQuery {
  rql: string;

  conditions?: LinkCondition[];

  text?: string;
}

export interface ParsedFilterLink {
  rql: string;

  conditions: LinkCondition[];

  filterId: number | null;

  sortBy: string | null;

  sortDirection: string | null;

  projectId: number | null;

  treeId: number | null;

  warnings: string[];
}

const AQL_CONDITION_ID = 'aql';
const CONTENT_CONDITION_ID = 'content';
const KNOWN_PARAMS = new Set(['search', 'treeId', 'filterId', 'sortBy', 'sortDirection']);

export function isFilterLink(value: string): boolean {
  return /^https?:\/\//i.test(value.trim());
}

export function conditionList(query: ConditionQuery): LinkCondition[] {
  const list: LinkCondition[] = [];
  if (query.rql) list.push({ id: AQL_CONDITION_ID, value: query.rql, type: 'string' });
  list.push(...(query.conditions ?? []));
  if (query.text) list.push({ id: CONTENT_CONDITION_ID, value: query.text, type: 'string' });
  return list;
}

export function encodeConditions(list: LinkCondition[]): string {
  return Buffer.from(JSON.stringify(list), 'utf8').toString('base64');
}

function decodeSearch(raw: string): LinkCondition[] {
  let json: string;
  try {
    json = Buffer.from(raw, 'base64').toString('utf8');
  } catch {
    throw new QueryError('В ссылке нет запроса: параметр search не читается как base64.');
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new QueryError('В ссылке нет запроса: содержимое search не является JSON.');
  }
  if (!Array.isArray(parsed)) {
    throw new QueryError('В ссылке нет запроса: содержимое search не является списком условий.');
  }
  return parsed as LinkCondition[];
}

function projectIdFrom(pathname: string): number | null {
  const m = /\/project\/(\d+)(?:\/|$)/.exec(pathname);
  return m ? Number(m[1]) : null;
}

function hasValue(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  if (typeof value === 'string') return value.trim() !== '';
  if (Array.isArray(value)) return value.length > 0;
  return true;
}

function noQuery(url: URL, reason: string): QueryError {
  const found = [...url.searchParams.keys()];
  return new QueryError(
    `В ссылке нет запроса: ${reason}. ${
      found.length ? `В ней есть: ${found.join(', ')}.` : 'Других параметров тоже нет.'
    } Скопируйте адрес после того, как применили фильтр в TestOps.`,
  );
}

function filterIdOf(raw: string | null): number | null {
  if (raw === null) return null;
  if (!/^\d+$/.test(raw)) {
    throw new QueryError(`Параметр ссылки filterId должен быть числом, а в ссылке «${raw}».`);
  }
  return Number(raw);
}

function splitAql(conditions: LinkCondition[]): { rql: string; others: LinkCondition[] } {
  const index = conditions.findIndex(
    (c) => c.id === AQL_CONDITION_ID && typeof c.value === 'string',
  );
  if (index < 0) return { rql: '', others: conditions };
  return {
    rql: String(conditions[index]?.value),
    others: conditions.filter((_, i) => i !== index),
  };
}

function linkWarnings(url: URL): string[] {
  const warnings: string[] = [];
  const treeId = url.searchParams.get('treeId');
  if (treeId) {
    warnings.push(
      `Фильтр по дереву кейсов (treeId=${treeId}) не перенесён: дерево задаёт только путь кейсов.`,
    );
  }
  const spare = [...url.searchParams.keys()].filter((k) => !KNOWN_PARAMS.has(k));
  if (spare.length) {
    warnings.push(`Параметры ссылки не перенесены: ${spare.join(', ')} — сервер их не получит.`);
  }
  return warnings;
}

function urlOf(link: string): URL {
  let url: URL;
  try {
    url = new URL(link.trim());
  } catch {
    throw new QueryError(`Это не ссылка на фильтр TestOps: ${link}`);
  }
  if (!/^https?:$/i.test(url.protocol)) {
    throw new QueryError(`Это не ссылка на фильтр TestOps: ${link}`);
  }
  return url;
}

export function parseFilterLink(link: string): ParsedFilterLink {
  const url = urlOf(link);
  const raw = url.searchParams.get('search');
  const filterId = filterIdOf(url.searchParams.get('filterId'));
  if (!raw && filterId === null) throw noQuery(url, 'нет ни search, ни filterId');

  const decoded = raw ? decodeSearch(raw) : [];
  if (filterId === null && !decoded.some((c) => hasValue(c.value))) {
    throw noQuery(url, 'в search нет ни одного условия со значением, filterId тоже нет');
  }
  const { rql, others } = splitAql(decoded);
  const treeId = url.searchParams.get('treeId');

  return {
    rql,
    conditions: others,
    filterId,
    sortBy: url.searchParams.get('sortBy'),
    sortDirection: url.searchParams.get('sortDirection'),
    projectId: projectIdFrom(url.pathname),
    treeId: treeId ? Number(treeId) : null,
    warnings: linkWarnings(url),
  };
}

export function buildFilterLink(
  baseUrl: string,
  projectId: number,
  query: ConditionQuery & { filterId?: number; sortBy?: string; sortDirection?: string },
): string {
  const base = baseUrl.replace(/\/+$/, '');
  const list = conditionList(query);
  const params = new URLSearchParams();
  if (list.length) params.set('search', encodeConditions(list));
  if (query.filterId !== undefined) params.set('filterId', String(query.filterId));
  if (query.sortBy) params.set('sortBy', query.sortBy);
  if (query.sortDirection) params.set('sortDirection', query.sortDirection);
  return `${base}/project/${projectId}/test-cases?${params.toString()}`;
}
