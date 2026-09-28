import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as lockfile from 'proper-lockfile';
import { afterEach, describe, expect, it } from 'vitest';
import { withLock } from '../src/stateLock.js';

const dirs: string[] = [];

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'tt-lock-test-'));
  dirs.push(dir);
  return dir;
}

afterEach(() => {
  while (dirs.length) rmSync(dirs.pop() as string, { recursive: true, force: true });
});

describe('замок хранилища занят другим держателем', () => {
  it('второй запуск печатает про ожидание и получает результат после освобождения', async () => {
    const dir = tempDir();
    const release = await lockfile.lock(dir, { retries: 0 });
    let waited = false;

    const pending = withLock(
      dir,
      () => 'готово',
      () => {
        waited = true;
      },
    );
    await new Promise((resolve) => setTimeout(resolve, 120));
    expect(waited).toBe(true);

    await release();
    await expect(pending).resolves.toBe('готово');
  });
});

describe('замок хранилища недоступен не из-за занятости', () => {
  it('родитель цели — обычный файл: ошибка хранилища с путём, без ожидания', async () => {
    const base = tempDir();
    const filePath = join(base, 'not-a-directory');
    writeFileSync(filePath, 'x');
    const target = join(filePath, 'sub');
    let waited = false;

    await expect(
      withLock(
        target,
        () => 'готово',
        () => {
          waited = true;
        },
      ),
    ).rejects.toThrow(target);
    expect(waited).toBe(false);
  });
});
