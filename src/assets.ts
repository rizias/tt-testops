import type { CaseCache } from './cache.js';
import type { EmbeddedAssets, HtmlCase } from './html.js';
import type { RichNode } from './model.js';
import type { AttachmentResult, TestOpsClient } from './testops/client.js';

export interface AssetDeps {
  client: TestOpsClient;
  cache: CaseCache | null;
  onWarn: (message: string) => void;
  onLost?: (attachmentId: number) => void;
}

function richSources(nodes: (RichNode | null)[] | undefined): string[] {
  const out: string[] = [];
  const walk = (n: RichNode | null | undefined): void => {
    if (!n) return;
    const src = n.attrs?.src ?? n.attrs?.url;
    if (src) out.push(src);
    for (const child of n.content ?? []) walk(child);
  };
  for (const node of nodes ?? []) walk(node);
  return out;
}

export async function embedAssets(
  deps: AssetDeps,
  items: HtmlCase[],
  shared: Set<number> = new Set(),
): Promise<EmbeddedAssets> {
  const owner = new Map<number, string>();
  for (const { tc } of items) {
    const text = [
      tc.description,
      tc.precondition,
      tc.expectedResult,
      ...tc.scenarioLines,
      ...tc.comments.map((c) => c.body),
      ...richSources(tc.scenarioRich),
    ].join('\n');
    for (const m of text.matchAll(
      /\/api\/(?:rs\/)?(?:testcase|sharedstep)\/attachment\/(\d+)\/content/g,
    )) {
      const id = Number(m[1]);
      if (!owner.has(id)) owner.set(id, tc.id);
    }
  }
  const out: EmbeddedAssets = new Map();
  const list = [...owner.keys()];
  const got = await Promise.all(list.map((id) => attachment(deps, id, shared.has(id))));
  list.forEach((id, k) => {
    const a = got[k];
    if (a?.ok) {
      out.set(id, `data:${a.contentType};base64,${a.bytes.toString('base64')}`);
      return;
    }
    deps.onLost?.(id);
    deps.onWarn(
      `кейс ${owner.get(id) ?? '?'}: вложение ${id} не скачалось — ${a?.reason ?? 'причина неизвестна'}`,
    );
  });
  return out;
}

export async function attachment(
  deps: AssetDeps,
  id: number,
  shared = false,
): Promise<AttachmentResult> {
  const key = shared ? -id : id;
  const stored = deps.cache?.getAttachment(key);
  if (stored) return { ok: true, bytes: stored.bytes, contentType: stored.contentType };
  const got = await deps.client.fetchAttachment(id, shared);
  if (got.ok) deps.cache?.putAttachment(key, got.bytes, got.contentType);
  return got;
}

export async function attachmentText(deps: AssetDeps, id: number, shared = false): Promise<string> {
  const got = await attachment(deps, id, shared);
  if (!got.ok) throw new Error(got.reason);
  return got.bytes.toString('utf8');
}
