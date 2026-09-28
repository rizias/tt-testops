import { QueryError, UrlTooLongError } from '../errors.js';
import { conditionList, encodeConditions, type LinkCondition } from '../links.js';
import { explainRejectedConditions } from './diagnosis.js';
import { apiError, type HttpContext } from './http.js';

export interface SearchHit {
  id: number;
}

export interface SearchQuery {
  rql: string;
  conditions?: LinkCondition[];
  filterId?: number;
  text?: string;
  sortBy?: string;
  sortDirection?: string;
}

const SORT_FIELD: Record<string, string> = {
  name: 'name',
  id: 'test_case_id',
  status_name: 'status_name',
  created_date: 'created_date',
  last_modified_date: 'last_modified_date',
  layer_name: 'layer_name',
  duration: 'duration',
};

const DEFAULT_SORT = 'name,asc';

function sortParams(query: SearchQuery): string[] {
  if (!query.sortBy) return [DEFAULT_SORT];
  const field = SORT_FIELD[query.sortBy] ?? query.sortBy;
  const direction = query.sortDirection ?? (query.sortBy === 'name' ? 'asc' : 'desc');
  const main = `${field},${direction}`;
  return query.sortBy === 'name' ? [main] : [main, DEFAULT_SORT];
}

export interface SearchContext extends HttpContext {
  explainRejectedQuery: (rql: string, projectId: number) => Promise<string>;
}

function searchParam(query: SearchQuery): string | null {
  const list = conditionList(query);
  return list.length ? encodeConditions(list) : null;
}

async function rejectedMessage(
  ctx: SearchContext,
  query: SearchQuery,
  projectId: number,
): Promise<string> {
  const others = conditionList({ ...query, rql: '' }).map((c) => String(c.id ?? '?'));
  if (!query.rql) return explainRejectedConditions(others, query.filterId);
  const aql = await ctx.explainRejectedQuery(query.rql, projectId);
  const mixed = others.length > 0 || query.filterId !== undefined;
  return mixed ? `${aql}\nПричина может быть и в условиях ссылки.` : aql;
}

export async function searchAll(
  ctx: SearchContext,
  query: SearchQuery,
  projectId: number,
  limit: number,
): Promise<{ hits: SearchHit[]; total: number }> {
  const hits: SearchHit[] = [];
  const seen = new Set<number>();
  let total = 0;
  for (let page = 0; hits.length < limit; page++) {
    const got = await searchPage(ctx, query, projectId, 100, page);
    total = got.total;
    if (!got.hits.length) break;
    for (const hit of got.hits) {
      if (seen.has(hit.id)) continue;
      seen.add(hit.id);
      hits.push(hit);
    }
    if (hits.length >= total) break;
  }
  return { hits: hits.slice(0, limit), total };
}

export async function countCases(
  ctx: SearchContext,
  query: SearchQuery,
  projectId: number,
): Promise<number> {
  return (await searchPage(ctx, query, projectId, 1, 0)).total;
}

async function searchPage(
  ctx: SearchContext,
  query: SearchQuery,
  projectId: number,
  size: number,
  page: number,
): Promise<{ hits: SearchHit[]; total: number }> {
  const h = await ctx.authHeaders();
  const q = new URLSearchParams({
    deleted: 'false',
    page: String(page),
    size: String(size),
  });
  for (const sort of sortParams(query)) q.append('sort', sort);
  const search = searchParam(query);
  if (search !== null) q.set('search', search);
  if (query.filterId !== undefined) q.set('filterId', String(query.filterId));
  const url = ctx.url(`/api/v2/project/${projectId}/test-case/flat?${q.toString()}`);
  const r = await ctx.port.get(url, h);
  if (r.status === 400) throw new QueryError(await rejectedMessage(ctx, query, projectId));
  if (r.status === 414) throw new UrlTooLongError();
  if (!r.ok) throw apiError(r.status, url);
  const data = (await r.json()) as {
    content?: Array<{ id: number }>;
    totalElements?: number;
  };
  const hits = (data.content ?? []).map((c) => ({ id: c.id }));
  return { hits, total: data.totalElements ?? hits.length };
}
