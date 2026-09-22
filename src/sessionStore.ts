import { createHash } from 'node:crypto';
import { mkdirSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { CacheError } from './errors.js';
import { withLock, writeAtomic } from './stateLock.js';

export interface StoredSession {
  token: string;
  expiresAt: number;
}

interface SessionRecord extends StoredSession {
  version: 1;
}

export function serverKey(baseUrl: string): string {
  return createHash('sha1').update(baseUrl.replace(/\/$/, '')).digest('hex').slice(0, 12);
}

function credentialsKey(token: string): string {
  return createHash('sha256').update(token).digest('hex').slice(0, 24);
}

function usableRecord(value: unknown): value is SessionRecord {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Partial<SessionRecord>;
  return (
    record.version === 1 &&
    typeof record.token === 'string' &&
    record.token.length > 0 &&
    typeof record.expiresAt === 'number' &&
    Number.isFinite(record.expiresAt)
  );
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export class SessionStore {
  private readonly sessionsDir: string;

  constructor(private readonly root: string) {
    this.sessionsDir = join(root, 'sessions');
  }

  private fileName(baseUrl: string, apiToken: string): string {
    return `${serverKey(baseUrl)}-${credentialsKey(apiToken)}.json`;
  }

  read(baseUrl: string, apiToken: string): StoredSession | null {
    try {
      const value: unknown = JSON.parse(
        readFileSync(join(this.sessionsDir, this.fileName(baseUrl, apiToken)), 'utf8'),
      );
      return usableRecord(value) ? { token: value.token, expiresAt: value.expiresAt } : null;
    } catch {
      return null;
    }
  }

  write(baseUrl: string, apiToken: string, session: StoredSession): void {
    mkdirSync(this.sessionsDir, { recursive: true });
    writeAtomic(
      this.sessionsDir,
      this.fileName(baseUrl, apiToken),
      JSON.stringify({ version: 1, token: session.token, expiresAt: session.expiresAt }),
    );
  }

  withLock<T>(work: () => Promise<T> | T, onWait: () => void = () => {}): Promise<T> {
    return withLock(this.root, work, onWait);
  }

  async clear(onWait: () => void = () => {}): Promise<void> {
    await this.withLock(() => {
      try {
        rmSync(this.root, { recursive: true, force: true });
      } catch (error) {
        let remaining = ['содержимое хранилища'];
        try {
          const entries = readdirSync(this.root, { recursive: true });
          if (entries.length) remaining = entries.map(String);
        } catch {}
        throw new CacheError(
          `Хранилище очищено не полностью. Осталось: ${remaining.join(', ')}. Причина: ${errorText(error)}`,
        );
      }
    }, onWait);
  }
}
