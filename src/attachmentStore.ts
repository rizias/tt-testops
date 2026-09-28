import { readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { basename, join } from 'node:path';
import { StorageError, errorText } from './errors.js';
import { SessionStore, type StoredSession, serverKey } from './sessionStore.js';
import { withLock, writeAtomic } from './stateLock.js';
import type { ProjectTree } from './tree.js';

export interface StoreStats {
  files: number;
  bytes: number;
  dir: string;
}

function listFiles(dir: string): string[] {
  try {
    return readdirSync(dir, { recursive: true, withFileTypes: true })
      .filter((entry) => entry.isFile())
      .map((entry) => join(entry.parentPath, entry.name));
  } catch {
    return [];
  }
}

function removeDir(dir: string): string | null {
  try {
    rmSync(dir, { recursive: true, force: true });
    return null;
  } catch (error) {
    const left = listFiles(dir);
    return `${left.length ? left.join(', ') : dir} (${errorText(error)})`;
  }
}

interface TreeRecord {
  trees: ProjectTree[];
}

export class AttachmentStore {
  private readonly filesDir: string;
  private readonly treesDir: string;
  private readonly sessionsDir: string;
  private readonly sessions: SessionStore;

  constructor(private readonly root: string) {
    this.filesDir = join(root, 'attachments');
    this.treesDir = join(root, 'trees');
    this.sessionsDir = join(root, 'sessions');
    this.sessions = new SessionStore(root, this.filesDir);
  }

  private treesFile(baseUrl: string, projectId: number): string {
    return join(this.treesDir, `${serverKey(baseUrl)}-${projectId}.json`);
  }

  getTrees(baseUrl: string, projectId: number): ProjectTree[] | null {
    try {
      const rec = JSON.parse(
        readFileSync(this.treesFile(baseUrl, projectId), 'utf8'),
      ) as TreeRecord;
      return rec.trees;
    } catch {
      return null;
    }
  }

  async putTrees(baseUrl: string, projectId: number, trees: ProjectTree[]): Promise<void> {
    const rec: TreeRecord = { trees };
    const name = basename(this.treesFile(baseUrl, projectId));
    await withLock(this.filesDir, () => writeAtomic(this.treesDir, name, JSON.stringify(rec)));
  }

  caseDir(caseId: string): string {
    return join(this.filesDir, `case-${caseId}`);
  }

  caseFileNames(caseId: string): string[] {
    try {
      return readdirSync(this.caseDir(caseId)).filter((name) => !name.startsWith('.'));
    } catch {
      return [];
    }
  }

  async putCaseFile(caseId: string, name: string, bytes: Buffer): Promise<string> {
    await withLock(this.filesDir, () => writeAtomic(this.caseDir(caseId), name, bytes));
    return join(this.caseDir(caseId), name);
  }

  async dropCaseFiles(caseId: string, names: string[]): Promise<void> {
    if (!names.length) return;
    await withLock(this.filesDir, () => {
      for (const name of names) rmSync(join(this.caseDir(caseId), name), { force: true });
    });
  }

  stats(): StoreStats {
    const files = listFiles(this.filesDir);
    return {
      files: files.length,
      bytes: files.reduce((sum, file) => sum + statSync(file).size, 0),
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

  async clear(onWait: () => void = () => {}): Promise<void> {
    await withLock(this.filesDir, () => {
      const remaining = [this.filesDir, this.sessionsDir, this.treesDir]
        .map(removeDir)
        .filter((left): left is string => left !== null);
      if (remaining.length) {
        throw new StorageError(`Хранилище очищено не полностью. Осталось: ${remaining.join('; ')}`);
      }
    }, onWait);
  }
}

export function humanSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} Б`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} КБ`;
  return `${(bytes / 1024 / 1024).toFixed(1)} МБ`;
}
