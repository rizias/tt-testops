import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as lockfile from 'proper-lockfile';
import { afterEach, describe, expect, it } from 'vitest';
import { resolveProfile } from '../src/settingsPaths.js';
import { withLock } from '../src/stateLock.js';

let home = '';

afterEach(() => {
  if (home) rmSync(home, { recursive: true, force: true });
  home = '';
});

function freshHome(): string {
  home = mkdtempSync(join(tmpdir(), 'tt-outdated-'));
  mkdirSync(join(home, '.tt-testops'), { recursive: true });
  return home;
}

const envFor = (h: string) => ({ HOME: h, USERPROFILE: h }) as NodeJS.ProcessEnv;

describe('config.json', () => {
  it('config.json только с profile — не ошибка', () => {
    const h = freshHome();
    writeFileSync(join(h, '.tt-testops', 'config.json'), JSON.stringify({ profile: 'default' }));
    expect(resolveProfile({}, envFor(h)).profileName).toBe('default');
  });
});

describe('блокировка каталога состояния', () => {
  it('дожидается освобождения занятого замка, а не завершается ошибкой по таймауту', async () => {
    const h = freshHome();
    const dir = join(h, '.tt-testops', 'profiles', 'default');
    mkdirSync(dir, { recursive: true });
    const release = await lockfile.lock(dir, { retries: 0 });
    let waited = false;
    const pending = withLock(dir, () => 'сделано', () => {
      waited = true;
    });
    while (!waited) await new Promise((resolve) => setTimeout(resolve, 10));
    await release();
    expect(await pending).toBe('сделано');
    expect(waited).toBe(true);
  });
});
