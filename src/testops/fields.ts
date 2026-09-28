import { apiError, type HttpContext } from './http.js';

export interface CustomField {
  id: number;
  name: string;
}

export interface CustomFieldValue {
  name: string;
  testCasesCount: number;
}

export async function fetchCustomFields(
  ctx: HttpContext,
  projectId: number,
): Promise<CustomField[]> {
  const h = await ctx.authHeaders();
  const out: CustomField[] = [];
  for (let page = 0; ; page++) {
    const url = ctx.url(`/api/project/${projectId}/cf?page=${page}&size=200`);
    const r = await ctx.port.get(url, h);
    if (!r.ok) throw apiError(r.status, url);
    const data = (await r.json()) as
      | Array<{ id?: number; name?: string }>
      | { content?: Array<{ id?: number; name?: string }>; totalPages?: number };
    const list = Array.isArray(data) ? data : (data.content ?? []);
    for (const f of list)
      if (typeof f.name === 'string') out.push({ id: f.id as number, name: f.name });
    if (Array.isArray(data)) return out;
    const pages = data.totalPages ?? 1;
    if (page + 1 >= pages || !list.length) return out;
  }
}

export async function fetchFieldValueCount(
  ctx: HttpContext,
  projectId: number,
  fieldId: number,
): Promise<number> {
  const h = await ctx.authHeaders();
  const url = ctx.url(`/api/cfv?projectId=${projectId}&customFieldId=${fieldId}&page=0&size=1`);
  const r = await ctx.port.get(url, h);
  if (!r.ok) throw apiError(r.status, url);
  const data = (await r.json()) as { totalElements?: number };
  return data.totalElements ?? 0;
}

export async function searchFieldValues(
  ctx: HttpContext,
  projectId: number,
  fieldId: number,
  query: string,
): Promise<CustomFieldValue[]> {
  const h = await ctx.authHeaders();
  const out: CustomFieldValue[] = [];
  for (let page = 0; ; page++) {
    const url = ctx.url(
      `/api/cfv?projectId=${projectId}&customFieldId=${fieldId}&query=${encodeURIComponent(
        query,
      )}&page=${page}&size=200`,
    );
    const r = await ctx.port.get(url, h);
    if (!r.ok) throw apiError(r.status, url);
    const data = (await r.json()) as {
      content?: Array<{ name?: string; testCasesCount?: number }>;
      totalPages?: number;
    };
    const list = data.content ?? [];
    for (const v of list)
      if (typeof v.name === 'string')
        out.push({ name: v.name, testCasesCount: v.testCasesCount ?? 0 });
    if (page + 1 >= (data.totalPages ?? 1) || !list.length) break;
  }
  return out.sort((a, b) => b.testCasesCount - a.testCasesCount);
}

export async function fetchFieldValues(
  ctx: HttpContext,
  projectId: number,
  fieldId: number,
): Promise<CustomFieldValue[]> {
  const h = await ctx.authHeaders();
  const out: CustomFieldValue[] = [];
  for (let page = 0; ; page++) {
    const url = ctx.url(
      `/api/cfv?projectId=${projectId}&customFieldId=${fieldId}&page=${page}&size=200`,
    );
    const r = await ctx.port.get(url, h);
    if (!r.ok) throw apiError(r.status, url);
    const data = (await r.json()) as {
      content?: Array<{ name?: string; testCasesCount?: number }>;
      totalPages?: number;
    };
    const list = data.content ?? [];
    for (const v of list)
      if (typeof v.name === 'string')
        out.push({ name: v.name, testCasesCount: v.testCasesCount ?? 0 });
    const pages = data.totalPages ?? 1;
    if (page + 1 >= pages || !list.length) break;
  }
  return out.sort((a, b) => b.testCasesCount - a.testCasesCount);
}
