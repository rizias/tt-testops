import type { AppConfig } from '../config.js';
import { QueryError } from '../errors.js';
import { apiError } from './http.js';
import type { TestOpsPort } from './port.js';

export interface SearchHit {
  id: number;
  lastModifiedDate: number;
}

export interface SearchContext {
  cfg: AppConfig;
  port: TestOpsPort;
  url: (path: string) => string;
  authHeaders: (accept?: string) => Promise<Record<string, string>>;
  explainRejectedQuery: (rql: string, projectId: number) => Promise<string>;
}

export async function searchAll(
  ctx: SearchContext,
  rql: string,
  projectId: number,
  limit: number,
  pageSize = 100,
): Promise<{ hits: SearchHit[]; total: number }> {
  const hits: SearchHit[] = [];
  const seen = new Set<number>();
  let total = 0;
  for (let page = 0; hits.length < limit; page++) {
    const got = await searchPage(ctx, rql, projectId, pageSize, page);
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

export async function search(
  ctx: SearchContext,
  rql: string,
  projectId: number,
  size: number,
  page = 0,
): Promise<SearchHit[]> {
  return (await searchPage(ctx, rql, projectId, size, page)).hits;
}

export async function countCases(
  ctx: SearchContext,
  rql: string,
  projectId: number,
): Promise<number> {
  return (await searchPage(ctx, rql, projectId, 1, 0)).total;
}

async function searchPage(
  ctx: SearchContext,
  rql: string,
  projectId: number,
  size: number,
  page: number,
): Promise<{ hits: SearchHit[]; total: number }> {
  const h = await ctx.authHeaders();
  const q = new URLSearchParams({
    projectId: String(projectId),
    deleted: 'false',
    page: String(page),
    size: String(size),
    sort: ctx.cfg.sort,
  });
  if (rql) q.set('rql', rql);
  const url = ctx.url(`/api/testcase/__search?${q.toString()}`);
  const r = await ctx.port.get(url, h);
  if (r.status === 400) throw new QueryError(await ctx.explainRejectedQuery(rql, projectId));
  if (!r.ok) throw apiError(r.status, url);
  const data = (await r.json()) as {
    content?: Array<{ id: number; lastModifiedDate?: number }>;
    totalElements?: number;
  };
  const hits = (data.content ?? []).map((c) => ({
    id: c.id,
    lastModifiedDate: c.lastModifiedDate ?? 0,
  }));
  return { hits, total: data.totalElements ?? hits.length };
}
