import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { AssetDeps } from './assets.js';
import type { EmbeddedAssets } from './html.js';

export interface SavedAttachment {
  id: number;
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

export function extensionFor(contentType: string): string {
  const clean = contentType.split(';')[0]?.trim().toLowerCase() ?? '';
  return EXTENSIONS[clean] ?? '.bin';
}

export function saveEmbedded(assets: EmbeddedAssets, dir: string): SavedAttachment[] {
  const saved: SavedAttachment[] = [];
  if (assets.size === 0) return saved;
  mkdirSync(dir, { recursive: true });
  for (const [id, dataUrl] of assets) {
    const match = /^data:([^;]+);base64,(.*)$/s.exec(dataUrl);
    if (match === null) continue;
    const path = join(dir, `${id}${extensionFor(match[1] ?? '')}`);
    writeFileSync(path, Buffer.from(match[2] ?? '', 'base64'));
    saved.push({ id, path });
  }
  return saved.sort((a, b) => a.id - b.id);
}

export function attachmentsDirOf(deps: AssetDeps, caseId: string): string | null {
  const root = deps.cache?.filesRoot();
  return root === undefined ? null : join(root, `case-${caseId}`);
}
