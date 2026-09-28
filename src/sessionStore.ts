import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { withLock, writeAtomic } from './stateLock.js';

export interface StoredSession {
  token: string;
  expiresAt: number | null;
}

export function serverKey(baseUrl: string): string {
  return createHash('sha1').update(baseUrl.replace(/\/$/, '')).digest('hex').slice(0, 12);
}

function credentialsKey(token: string): string {
  return createHash('sha256').update(token).digest('hex').slice(0, 24);
}

function usableRecord(value: unknown): value is StoredSession {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Partial<StoredSession>;
  return (
    typeof record.token === 'string' &&
    record.token.length > 0 &&
    (record.expiresAt === null || Number.isFinite(record.expiresAt))
  );
}

export class SessionStore {
  private readonly sessionsDir: string;

  constructor(
    root: string,
    private readonly lockDir: string,
  ) {
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
    writeAtomic(
      this.sessionsDir,
      this.fileName(baseUrl, apiToken),
      JSON.stringify({ token: session.token, expiresAt: session.expiresAt }),
    );
  }

  withLock<T>(work: () => Promise<T> | T, onWait: () => void = () => {}): Promise<T> {
    return withLock(this.lockDir, work, onWait);
  }
}
