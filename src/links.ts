import { QueryError } from './errors.js';

interface LinkCondition {
  id?: unknown;
  value?: unknown;
  type?: unknown;
}

export interface ParsedFilterLink {
  rql: string;

  projectId: number | null;

  treeId: number | null;

  warnings: string[];
}

const AQL_CONDITION_ID = 'aql';

export function isFilterLink(value: string): boolean {
  return /^https?:\/\//i.test(value.trim());
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

export function parseFilterLink(link: string): ParsedFilterLink {
  let url: URL;
  try {
    url = new URL(link.trim());
  } catch {
    throw new QueryError(`Это не ссылка на фильтр TestOps: ${link}`);
  }
  if (!/^https?:$/i.test(url.protocol)) {
    throw new QueryError(`Это не ссылка на фильтр TestOps: ${link}`);
  }

  const raw = url.searchParams.get('search');
  if (!raw) {
    const found = [...url.searchParams.keys()];
    throw new QueryError(
      `В ссылке нет запроса: параметра search нет. ${
        found.length ? `В ней есть: ${found.join(', ')}.` : 'Других параметров тоже нет.'
      } Скопируйте адрес после того, как применили фильтр в TestOps.`,
    );
  }

  const conditions = decodeSearch(raw);
  const aql = conditions.find((c) => c.id === AQL_CONDITION_ID);
  const otherIds = conditions
    .filter((c) => c.id !== AQL_CONDITION_ID)
    .map((c) => String(c.id ?? '?'));

  if (!aql || typeof aql.value !== 'string') {
    const params = [...url.searchParams.keys()].filter((k) => k !== 'search');
    const found = [...otherIds, ...params];
    throw new QueryError(
      `В ссылке нет запроса (условия aql). Найдено в ссылке: ${found.length ? found.join(', ') : 'ничего'}.`,
    );
  }

  const warnings: string[] = [];
  const treeId = url.searchParams.get('treeId');
  if (treeId) {
    warnings.push(
      `Фильтр по дереву кейсов (treeId=${treeId}) не перенесён: AQL такого условия не выражает.`,
    );
  }
  if (otherIds.length) {
    warnings.push(`Условия из ссылки не перенесены: ${otherIds.join(', ')}.`);
  }
  const spare = [...url.searchParams.keys()].filter((k) => k !== 'search' && k !== 'treeId');
  if (spare.length) {
    warnings.push(`Параметры ссылки не перенесены: ${spare.join(', ')} — AQL их не выражает.`);
  }

  return {
    rql: aql.value,
    projectId: projectIdFrom(url.pathname),
    treeId: treeId ? Number(treeId) : null,
    warnings,
  };
}

export function buildFilterLink(baseUrl: string, projectId: number, rql: string): string {
  const base = baseUrl.replace(/\/+$/, '');
  const conditions: LinkCondition[] = [{ id: AQL_CONDITION_ID, value: rql, type: 'string' }];
  const search = Buffer.from(JSON.stringify(conditions), 'utf8').toString('base64');
  return `${base}/project/${projectId}/test-cases?search=${encodeURIComponent(search)}`;
}
