import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import * as lockfile from 'proper-lockfile';
import { StorageError, errorText } from './errors.js';

const WAIT_MS = 50;
const BUSY_WITH_LOCK_DIR_CODES = new Set(['EPERM', 'EBUSY']);

function errorCode(error: unknown): string | undefined {
  return typeof error === 'object' && error !== null && 'code' in error
    ? String((error as { code?: unknown }).code)
    : undefined;
}

function canCreateBeside(dir: string): boolean {
  const probe = `${dir}.probe-${process.pid}-${randomUUID()}`;
  try {
    mkdirSync(probe);
    rmSync(probe, { recursive: true, force: true });
    return true;
  } catch {
    return false;
  }
}

function heldByAnotherProcess(dir: string, code: string): boolean {
  if (code === 'ELOCKED') return true;
  if (!BUSY_WITH_LOCK_DIR_CODES.has(code)) return false;
  return existsSync(`${dir}.lock`) || canCreateBeside(dir);
}

async function acquire(dir: string, onWait: () => void): Promise<() => Promise<void>> {
  let warned = false;
  for (;;) {
    try {
      return await lockfile.lock(dir, { retries: 0 });
    } catch (error) {
      const code = errorCode(error) ?? '';
      if (!heldByAnotherProcess(dir, code)) {
        throw new StorageError(`Не удалось взять замок хранилища ${dir}: ${errorText(error)}`);
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
    throw new StorageError(`Хранилище недоступно: ${errorText(error)}`);
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
    throw new StorageError(`Замок хранилища потерян: ${errorText(error)}`);
  }
  if ('error' in outcome) throw outcome.error;
  return outcome.value;
}

export function writeAtomic(
  dir: string,
  filename: string,
  content: string | Buffer,
): void {
  mkdirSync(dir, { recursive: true });
  const target = join(dir, filename);
  const temporary = join(dir, `.${basename(filename)}.${process.pid}.${randomUUID()}.tmp`);
  let failure: StorageError | null = null;
  try {
    writeFileSync(temporary, content);
    renameSync(temporary, target);
  } catch (error) {
    failure = new StorageError(`Не удалось записать файл хранилища: ${errorText(error)}`);
  }
  try {
    rmSync(temporary, { force: true });
  } catch (error) {
    failure ??= new StorageError(`Не удалось удалить временный файл: ${errorText(error)}`);
  }
  if (failure) throw failure;
}
