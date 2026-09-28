import { copyFileSync, mkdirSync, readFileSync } from 'node:fs';
import { basename, extname, join } from 'node:path';
import { type AssetDeps, type AttachmentContent, attachment, attachmentRefs } from './assets.js';
import type { CaseAttachment, TestCase } from './model.js';

export interface SavedAttachment {
  key: number;
  path: string;
}

const EXTENSIONS: Record<string, string> = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/gif': '.gif',
  'image/webp': '.webp',
  'image/svg+xml': '.svg',
  'image/bmp': '.bmp',
  'application/pdf': '.pdf',
  'application/json': '.json',
  'text/markdown': '.md',
  'text/plain': '.txt',
  'text/html': '.html',
  'text/csv': '.csv',
};

const TYPES = new Map(Object.entries(EXTENSIONS).map(([type, ext]) => [ext, type]));

export function extensionFor(contentType: string): string {
  const clean = contentType.split(';')[0]?.trim().toLowerCase() ?? '';
  return EXTENSIONS[clean] ?? '.bin';
}

const contentTypeOf = (path: string): string =>
  TYPES.get(extname(path).toLowerCase()) ?? 'application/octet-stream';

const keyOf = (id: number, shared: boolean): number => (shared ? -id : id);

const keyOfName = (name: string): number | null => {
  const m = /^(shared-)?(\d+)\./.exec(name);
  return m ? keyOf(Number(m[2]), m[1] !== undefined) : null;
};

const fileName = (key: number, contentType: string): string =>
  `${key < 0 ? 'shared-' : ''}${Math.abs(key)}${extensionFor(contentType)}`;

export class CaseFiles {
  private readonly existing: string[];
  private readonly paths = new Map<number, string | null>();
  private readonly fresh = new Map<number, AttachmentContent>();
  private readonly failures = new Map<number, string>();

  constructor(
    private readonly deps: AssetDeps,
    private readonly caseId: string,
  ) {
    this.existing = deps.store?.caseFileNames(caseId) ?? [];
  }

  private async load(key: number): Promise<void> {
    if (this.paths.has(key) || this.failures.has(key)) return;
    const store = this.deps.store;
    const stored = this.existing.find((name) => keyOfName(name) === key);
    if (store && stored !== undefined) {
      this.paths.set(key, join(store.caseDir(this.caseId), stored));
      return;
    }
    const got = await attachment(this.deps.client, Math.abs(key), key < 0);
    if (!got.ok) {
      this.failures.set(key, got.reason);
      return;
    }
    this.fresh.set(key, { bytes: got.bytes, contentType: got.contentType });
    const name = fileName(key, got.contentType);
    this.paths.set(key, store ? await store.putCaseFile(this.caseId, name, got.bytes) : null);
  }

  private content(key: number): AttachmentContent | null {
    const fresh = this.fresh.get(key);
    if (fresh) return fresh;
    const path = this.paths.get(key);
    return path ? { bytes: readFileSync(path), contentType: contentTypeOf(path) } : null;
  }

  async text(id: number, shared = false): Promise<string> {
    const key = keyOf(id, shared);
    await this.load(key);
    const got = this.content(key);
    if (!got) throw new Error(this.failures.get(key) ?? 'причина неизвестна');
    return got.bytes.toString('utf8');
  }

  async sync(tc: TestCase): Promise<CaseAttachment[]> {
    const refs = attachmentRefs(tc);
    const reported = new Set(this.failures.keys());
    await Promise.all([...refs].map((key) => this.load(key)));
    for (const key of refs) {
      const reason = this.failures.get(key);
      if (reason === undefined || reported.has(key)) continue;
      this.deps.onWarn(`кейс ${this.caseId}: вложение ${Math.abs(key)} не скачалось — ${reason}`);
    }
    const kept = new Set([...this.paths.values()].flatMap((p) => (p ? [basename(p)] : [])));
    await this.deps.store?.dropCaseFiles(
      this.caseId,
      this.existing.filter((name) => !kept.has(name)),
    );
    return [...refs].map((key) => ({ key, path: this.paths.get(key) ?? null }));
  }

  contents(attachments: CaseAttachment[]): Map<number, AttachmentContent> {
    const out = new Map<number, AttachmentContent>();
    for (const { key } of attachments) {
      const got = this.content(key);
      if (got) out.set(key, got);
    }
    return out;
  }
}

export function copyAttachments(attachments: CaseAttachment[], dir?: string): SavedAttachment[] {
  const saved = attachments
    .flatMap((a) => (a.path ? [{ key: a.key, path: a.path }] : []))
    .sort((a, b) => a.key - b.key);
  if (dir === undefined || !saved.length) return saved;
  mkdirSync(dir, { recursive: true });
  return saved.map((s) => {
    const path = join(dir, basename(s.path));
    copyFileSync(s.path, path);
    return { key: s.key, path };
  });
}
