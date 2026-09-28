import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { resolveProfile } from '../src/settingsPaths.js';

let home: string;

afterEach(() => {
  if (home) rmSync(home, { recursive: true, force: true });
});

function newHome(): string {
  home = mkdtempSync(join(tmpdir(), 'tt-profile-home-'));
  return home;
}

function envFor(h: string, extra: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  return { HOME: h, USERPROFILE: h, ...extra } as NodeJS.ProcessEnv;
}

function writeProfile(h: string, name: string): string {
  const dir = join(h, '.tt-testops', 'profiles', name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'profile.json'), '{}', 'utf8');
  return dir;
}

function writeCommon(h: string, profile: string): void {
  mkdirSync(join(h, '.tt-testops'), { recursive: true });
  writeFileSync(join(h, '.tt-testops', 'config.json'), JSON.stringify({ profile }), 'utf8');
}

describe('выбор профиля — источники', () => {
  it('--profile выбирает существующий профиль', () => {
    const h = newHome();
    const dir = writeProfile(h, 'ci');
    const selection = resolveProfile({ profile: 'ci' }, envFor(h));
    expect(selection.source).toBe('flag');
    expect(selection.profileName).toBe('ci');
    expect(selection.profileDir).toBe(dir);
  });

  it('TT_TESTOPS_PROFILE выбирает существующий профиль', () => {
    const h = newHome();
    writeProfile(h, 'stage');
    const selection = resolveProfile({}, envFor(h, { TT_TESTOPS_PROFILE: 'stage' }));
    expect(selection.source).toBe('env');
    expect(selection.profileName).toBe('stage');
  });

  it('поле profile общего файла выбирает существующий профиль', () => {
    const h = newHome();
    writeProfile(h, 'prod');
    writeCommon(h, 'prod');
    const selection = resolveProfile({}, envFor(h));
    expect(selection.source).toBe('config');
    expect(selection.profileName).toBe('prod');
  });

  it('при отсутствии остальных источников выбирается default', () => {
    const h = newHome();
    writeProfile(h, 'default');
    const selection = resolveProfile({}, envFor(h));
    expect(selection.source).toBe('default');
    expect(selection.profileName).toBe('default');
  });
});

describe('выбор профиля — приоритеты', () => {
  it('--profile сильнее TT_TESTOPS_PROFILE и общего файла', () => {
    const h = newHome();
    writeProfile(h, 'flag-profile');
    writeProfile(h, 'env-profile');
    writeProfile(h, 'common-profile');
    writeCommon(h, 'common-profile');
    const selection = resolveProfile(
      { profile: 'flag-profile' },
      envFor(h, { TT_TESTOPS_PROFILE: 'env-profile' }),
    );
    expect(selection.profileName).toBe('flag-profile');
  });

  it('TT_TESTOPS_PROFILE сильнее поля profile общего файла', () => {
    const h = newHome();
    writeProfile(h, 'env-profile');
    writeProfile(h, 'common-profile');
    writeCommon(h, 'common-profile');
    const selection = resolveProfile({}, envFor(h, { TT_TESTOPS_PROFILE: 'env-profile' }));
    expect(selection.profileName).toBe('env-profile');
  });
});

describe('выбор профиля — ошибки с полным путём', () => {
  it('--profile на несуществующий профиль', () => {
    const h = newHome();
    const expectedDir = join(h, '.tt-testops', 'profiles', 'призрак');
    expect(() => resolveProfile({ profile: 'призрак' }, envFor(h))).toThrow(expectedDir);
  });

  it('TT_TESTOPS_PROFILE на несуществующий профиль', () => {
    const h = newHome();
    const expectedDir = join(h, '.tt-testops', 'profiles', 'призрак');
    expect(() =>
      resolveProfile({}, envFor(h, { TT_TESTOPS_PROFILE: 'призрак' })),
    ).toThrow(expectedDir);
  });

  it('поле profile общего файла ссылается на несуществующий профиль', () => {
    const h = newHome();
    writeCommon(h, 'призрак');
    const expectedDir = join(h, '.tt-testops', 'profiles', 'призрак');
    expect(() => resolveProfile({}, envFor(h))).toThrow(expectedDir);
  });
});

describe('выбор профиля — отсутствие файлов не ошибка', () => {
  it('нет общего файла и каталога default — resolveProfile не бросает', () => {
    const h = newHome();
    const selection = resolveProfile(
      {},
      envFor(h, {
        TT_TESTOPS_SERVER_TESTOPS_BASE_URL: 'https://testops.example',
        TT_TESTOPS_SERVER_TESTOPS_TOKEN: 'secret-token-value',
      }),
    );
    expect(selection.source).toBe('default');
    expect(selection.profileName).toBe('default');
  });
});
