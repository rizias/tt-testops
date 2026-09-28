import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { localCommand } from '../src/localCommands.js';

const blocked = vi.hoisted(() => ({ name: '' }));

vi.mock('node:fs', async (importOriginal) => {
  const real = await importOriginal<typeof import('node:fs')>();
  return {
    ...real,
    rmSync: (path: string, options?: Parameters<typeof real.rmSync>[1]) => {
      if (blocked.name && basename(String(path)) === blocked.name) throw new Error('EBUSY: занято');
      real.rmSync(path, options);
    },
  };
});

afterEach(() => {
  blocked.name = '';
  vi.unstubAllEnvs();
});

function profileWithStore(): string {
  const home = mkdtempSync(join(tmpdir(), 'tt-clear-'));
  vi.stubEnv('HOME', home);
  vi.stubEnv('USERPROFILE', home);
  vi.stubEnv('TT_TESTOPS_PROFILE', '');
  const dir = join(home, '.tt-testops', 'profiles', 'чистка');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'profile.json'), '{}');
  for (const [sub, file] of [['attachments/case-1', '7.png'], ['sessions', 's.json'], ['trees', 't.json']] as const) {
    mkdirSync(join(dir, sub), { recursive: true });
    writeFileSync(join(dir, sub, file), 'x');
  }
  return dir;
}

const flags = { _: ['clear'], projects: [], queries: [], used: [], profile: 'чистка' };

describe('attachments clear при частичной неудаче', () => {
  it('называет оставшееся и не объявляет очистку состоявшейся', async () => {
    const dir = profileWithStore();
    blocked.name = 'sessions';
    const left = join(dir, 'sessions', 's.json');
    const run = localCommand('attachments', flags, '0.0.0', dir);
    await expect(run).rejects.toThrow(`Хранилище очищено не полностью. Осталось: ${left}`);
    expect(existsSync(left)).toBe(true);
    expect(existsSync(join(dir, 'attachments'))).toBe(false);
    expect(existsSync(join(dir, 'trees'))).toBe(false);
  });

  it('без помех сообщает об очистке', async () => {
    const dir = profileWithStore();
    const result = await localCommand('attachments', flags, '0.0.0', dir);
    expect(result).toEqual({
      output: 'Очищено: файлов вложений 1, 1 Б; сессии и списки деревьев удалены.',
      code: 0,
    });
  });
});
