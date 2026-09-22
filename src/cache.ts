import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { RawCase } from './model.js';
import { SessionStore, type StoredSession, serverKey } from './sessionStore.js';
import type { ProjectTree } from './tree.js';

export interface CacheStats {
  cases: number;
  attachments: number;
  bytes: number;
  dir: string;
}

interface CaseRecord {
  lastModifiedDate: number;
  raw: RawCase;
}

interface TreeRecord {
  version: 1;
  fetchedAt: number;
  trees: ProjectTree[];
}

const TREES_FRESH_MS = 24 * 60 * 60 * 1000;

function usableCase(raw: unknown): raw is RawCase {
  if (typeof raw !== 'object' || raw === null) return false;
  const rec = raw as Partial<RawCase>;
  const overview = rec.overview;
  if (typeof overview !== 'object' || overview === null) return false;
  if (overview.id === undefined || overview.id === null) return false;
  if (rec.steps !== null && typeof rec.steps !== 'object') return false;
  if (rec.comments !== null && !Array.isArray(rec.comments)) return false;
  return rec.relations === undefined || rec.relations === null || Array.isArray(rec.relations);
}

export class CaseCache {
  private server = serverKey('');
  private readonly casesDir: string;
  private readonly attachmentsDir: string;
  private readonly treesDir: string;
  private readonly sessions: SessionStore;

  constructor(private readonly root: string) {
    this.casesDir = join(root, 'cases');
    this.attachmentsDir = join(root, 'attachments');
    this.treesDir = join(root, 'trees');
    this.sessions = new SessionStore(root);
  }

  private ensure(dir: string): void {
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  }

  getCase(projectId: number, id: number, lastModifiedDate: number): RawCase | null {
    try {
      const rec = JSON.parse(
        readFileSync(join(this.casesDir, `${this.server}-${projectId}-${id}.json`), 'utf8'),
      ) as CaseRecord;
      if (rec.lastModifiedDate !== lastModifiedDate) return null;
      return usableCase(rec.raw) ? rec.raw : null;
    } catch {
      return null;
    }
  }

  putCase(projectId: number, id: number, lastModifiedDate: number, raw: RawCase): void {
    this.ensure(this.casesDir);
    const rec: CaseRecord = { lastModifiedDate, raw };
    writeFileSync(
      join(this.casesDir, `${this.server}-${projectId}-${id}.json`),
      JSON.stringify(rec),
    );
  }

  useServer(baseUrl: string): void {
    this.server = serverKey(baseUrl);
  }

  private treesFile(baseUrl: string, projectId: number): string {
    return join(this.treesDir, `${serverKey(baseUrl)}-${projectId}.json`);
  }

  getTrees(baseUrl: string, projectId: number, stale = false): ProjectTree[] | null {
    try {
      const rec = JSON.parse(
        readFileSync(this.treesFile(baseUrl, projectId), 'utf8'),
      ) as TreeRecord;
      if (rec.version !== 1) return null;
      if (!stale && Date.now() - rec.fetchedAt > TREES_FRESH_MS) return null;
      return rec.trees;
    } catch {
      return null;
    }
  }

  putTrees(baseUrl: string, projectId: number, trees: ProjectTree[]): void {
    this.ensure(this.treesDir);
    const rec: TreeRecord = { version: 1, fetchedAt: Date.now(), trees };
    writeFileSync(this.treesFile(baseUrl, projectId), JSON.stringify(rec));
  }

  getAttachment(attachmentId: number): { bytes: Buffer; contentType: string } | null {
    try {
      const meta = JSON.parse(
        readFileSync(join(this.attachmentsDir, `${this.server}-${attachmentId}.json`), 'utf8'),
      ) as { contentType: string };
      const bytes = readFileSync(join(this.attachmentsDir, `${this.server}-${attachmentId}.bin`));
      return { bytes, contentType: meta.contentType };
    } catch {
      return null;
    }
  }

  putAttachment(attachmentId: number, bytes: Buffer, contentType: string): void {
    this.ensure(this.attachmentsDir);
    writeFileSync(join(this.attachmentsDir, `${this.server}-${attachmentId}.bin`), bytes);
    writeFileSync(
      join(this.attachmentsDir, `${this.server}-${attachmentId}.json`),
      JSON.stringify({ contentType }),
    );
  }

  filesRoot(): string {
    return join(this.root, 'files');
  }

  stats(): CacheStats {
    const count = (dir: string, ext: string) => {
      try {
        return readdirSync(dir).filter((f) => f.endsWith(ext)).length;
      } catch {
        return 0;
      }
    };
    const size = (dir: string) => {
      try {
        return readdirSync(dir).reduce((s, f) => s + statSync(join(dir, f)).size, 0);
      } catch {
        return 0;
      }
    };
    return {
      cases: count(this.casesDir, '.json'),
      attachments: count(this.attachmentsDir, '.bin'),
      bytes:
        size(this.casesDir) +
        size(this.attachmentsDir) +
        size(this.treesDir) +
        size(join(this.root, 'sessions')),
      dir: this.root,
    };
  }

  getSession(baseUrl: string, apiToken: string): StoredSession | null {
    return this.sessions.read(baseUrl, apiToken);
  }

  putSession(baseUrl: string, apiToken: string, session: StoredSession): void {
    this.sessions.write(baseUrl, apiToken, session);
  }

  withSessionLock<T>(work: () => Promise<T> | T, onWait: () => void = () => {}): Promise<T> {
    return this.sessions.withLock(work, onWait);
  }

  clear(onWait: () => void = () => {}): Promise<void> {
    return this.sessions.clear(onWait);
  }
}

export function humanSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} Б`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} КБ`;
  return `${(bytes / 1024 / 1024).toFixed(1)} МБ`;
}
