import { randomUUID } from 'node:crypto';
import { mkdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import * as lockfile from 'proper-lockfile';
import { CacheError } from './errors.js';

const WAIT_MS = 50;
const BUSY_CODES = new Set(['ELOCKED', 'EPERM', 'EBUSY', 'ENOENT']);

function errorCode(error: unknown): string | undefined {
  return typeof error === 'object' && error !== null && 'code' in error
    ? String((error as { code?: unknown }).code)
    : undefined;
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function acquire(dir: string, onWait: () => void): Promise<() => Promise<void>> {
  let warned = false;
  for (;;) {
    try {
      return await lockfile.lock(dir, { retries: 0 });
    } catch (error) {
      if (!BUSY_CODES.has(errorCode(error) ?? '')) {
        throw new CacheError(`Не удалось взять замок хранилища: ${errorText(error)}`);
      }
      if (!warned) {
        onWait();
        warned = true;
      }
      await new Promise((resolve) => setTimeout(resolve, WAIT_MS));
    }
  }
}

export async function withLock<T>(
  dir: string,
  work: () => Promise<T> | T,
  onWait: () => void = () => {},
): Promise<T> {
  try {
    mkdirSync(dir, { recursive: true });
  } catch (error) {
    throw new CacheError(`Хранилище недоступно: ${errorText(error)}`);
  }
  const release = await acquire(dir, onWait);
  let outcome: { value: T } | { error: unknown };
  try {
    outcome = { value: await work() };
  } catch (error) {
    outcome = { error };
  }
  try {
    await release();
  } catch (error) {
    throw new CacheError(`Замок хранилища потерян: ${errorText(error)}`);
  }
  if ('error' in outcome) throw outcome.error;
  return outcome.value;
}

export function writeAtomic(dir: string, filename: string, content: string, mode?: number): void {
  mkdirSync(dir, { recursive: true });
  const target = join(dir, filename);
  const temporary = join(dir, `.${basename(filename)}.${process.pid}.${randomUUID()}.tmp`);
  let failure: CacheError | null = null;
  try {
    writeFileSync(temporary, content, mode === undefined ? undefined : { mode });
    renameSync(temporary, target);
  } catch (error) {
    failure = new CacheError(`Не удалось записать файл хранилища: ${errorText(error)}`);
  }
  try {
    rmSync(temporary, { force: true });
  } catch (error) {
    failure ??= new CacheError(`Не удалось удалить временный файл: ${errorText(error)}`);
  }
  if (failure) throw failure;
}
