import type { AttachmentStore } from './attachmentStore.js';
import type { EmbeddedAssets } from './html.js';
import { scenarioSources } from './htmlRichSteps.js';
import type { RichNode, TestCase } from './model.js';
import type { AttachmentResult, TestOpsClient } from './testops/client.js';
import { ATTACHMENT_URL, attachmentKey } from './text.js';

export interface AssetDeps {
  client: TestOpsClient;
  store: AttachmentStore | null;
  baseUrl: string;
  onWarn: (message: string) => void;
}

export interface AttachmentContent {
  bytes: Buffer;
  contentType: string;
}

const RETRIES = 3;

function richSources(nodes: RichNode[]): string[] {
  const out: string[] = [];
  const walk = (n: RichNode): void => {
    const src = n.attrs?.src ?? n.attrs?.url;
    if (src) out.push(src);
    for (const child of n.content ?? []) walk(child);
  };
  for (const node of nodes) walk(node);
  return out;
}

export function attachmentRefs(tc: TestCase): Set<number> {
  const scenario = scenarioSources(tc.scenario);
  const text = [
    tc.description,
    tc.precondition,
    tc.expectedResult,
    ...tc.scenarioLines,
    ...scenario.texts,
    ...tc.comments.map((c) => c.body),
    ...richSources(scenario.rich),
  ].join('\n');
  return new Set([...text.matchAll(ATTACHMENT_URL)].map((m) => attachmentKey(m[0], String(m[1]))));
}

export async function attachment(
  client: TestOpsClient,
  id: number,
  shared: boolean,
): Promise<AttachmentResult> {
  let got = await client.fetchAttachment(id, shared);
  for (let retry = 0; retry < RETRIES && !got.ok && got.transient; retry++) {
    got = await client.fetchAttachment(id, shared);
  }
  return got;
}

export function embedAssets(contents: Array<Map<number, AttachmentContent>>): EmbeddedAssets {
  const out: EmbeddedAssets = new Map();
  for (const byId of contents) {
    for (const [id, c] of byId) out.set(id, `data:${c.contentType};base64,${c.bytes.toString('base64')}`);
  }
  return out;
}
