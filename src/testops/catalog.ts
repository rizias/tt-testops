import type { ProjectTree } from '../tree.js';
import { apiError, type HttpContext } from './http.js';

export interface ServerProject {
  id: number;
  name: string;
}

export interface TestLayer {
  id: number;
  name: string;
}

export async function fetchProjects(ctx: HttpContext): Promise<ServerProject[]> {
  const h = await ctx.authHeaders();
  const out: ServerProject[] = [];
  for (let page = 0; ; page++) {
    const url = ctx.url(`/api/project?page=${page}&size=200`);
    const r = await ctx.port.get(url, h);
    if (!r.ok) throw apiError(r.status, url);
    const data = (await r.json()) as {
      content?: Array<{ id?: number; name?: string }>;
      totalPages?: number;
    };
    const list = data.content ?? [];
    for (const p of list)
      if (typeof p.id === 'number') out.push({ id: p.id, name: (p.name ?? '').trim() });
    if (page + 1 >= (data.totalPages ?? 1) || !list.length) return out;
  }
}

export async function fetchLayers(ctx: HttpContext): Promise<TestLayer[]> {
  const h = await ctx.authHeaders();
  const out: TestLayer[] = [];
  for (let page = 0; ; page++) {
    const url = ctx.url(`/api/testlayer?page=${page}&size=200`);
    const r = await ctx.port.get(url, h);
    if (!r.ok) throw apiError(r.status, url);
    const data = (await r.json()) as {
      content?: Array<{ id?: number; name?: string }>;
      totalPages?: number;
    };
    const list = data.content ?? [];
    for (const l of list)
      if (typeof l.id === 'number' && typeof l.name === 'string')
        out.push({ id: l.id, name: l.name.trim() });
    if (page + 1 >= (data.totalPages ?? 1) || !list.length) return out;
  }
}

export async function fetchTrees(
  ctx: HttpContext,
  projectId: number,
): Promise<ProjectTree[]> {
  const h = await ctx.authHeaders();
  const out: ProjectTree[] = [];
  for (let page = 0; ; page++) {
    const url = ctx.url(`/api/tree?projectId=${projectId}&page=${page}&size=200`);
    const r = await ctx.port.get(url, h);
    if (!r.ok) throw apiError(r.status, url);
    const data = (await r.json()) as {
      content?: Array<{
        id?: number;
        name?: string;
        fields?: Array<{ id?: number; name?: string }>;
      }>;
      totalPages?: number;
    };
    const list = data.content ?? [];
    out.push(...treesOf(list));
    if (page + 1 >= (data.totalPages ?? 1) || !list.length) return out;
  }
}

function treesOf(
  data: Array<{ id?: number; name?: string; fields?: Array<{ id?: number; name?: string }> }>,
): ProjectTree[] {
  return data
    .filter(
      (t): t is { id: number; name?: string; fields?: Array<{ id?: number; name?: string }> } =>
        typeof t.id === 'number',
    )
    .map((t) => ({
      id: t.id,
      name: (t.name ?? '').trim(),
      fields: (t.fields ?? [])
        .filter((f): f is { id: number; name?: string } => typeof f.id === 'number')
        .map((f) => ({ id: f.id, name: (f.name ?? '').trim() })),
    }));
}
