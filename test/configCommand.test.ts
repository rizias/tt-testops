import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { run } from './cliRunner.js';

const TOKEN = 'secret-token-value';

let home: string;

afterEach(() => {
  if (home) rmSync(home, { recursive: true, force: true });
});

function newHome(): string {
  home = mkdtempSync(join(tmpdir(), 'tt-configcmd-home-'));
  return home;
}

function withProfile(h: string, name = 'default'): void {
  const dir = join(h, '.tt-testops', 'profiles', name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, 'profile.json'),
    JSON.stringify({ servers: { testops: { baseUrl: 'https://testops.example' } } }),
    'utf8',
  );
  writeFileSync(join(dir, 'credentials.json'), JSON.stringify({ testops: { token: TOKEN } }), 'utf8');
}

function envFor(h: string, extra: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  return { HOME: h, USERPROFILE: h, ...extra } as NodeJS.ProcessEnv;
}

describe('config — текстовый вид', () => {
  it('печатает общий файл, профиль, источник выбора, оба пути и поля с источником', () => {
    const h = newHome();
    withProfile(h);
    const r = run(['config'], envFor(h));
    expect(r.code).toBe(0);
    expect(r.stdout).toContain(join(h, '.tt-testops', 'config.json'));
    expect(r.stdout).toContain('default');
    expect(r.stdout).toContain('default)');
    expect(r.stdout).toContain(join(h, '.tt-testops', 'profiles', 'default', 'profile.json'));
    expect(r.stdout).toContain(join(h, '.tt-testops', 'profiles', 'default', 'credentials.json'));
    expect(r.stdout).toContain('servers.testops.baseUrl');
    expect(r.stdout).toContain('(file)');
  });
});

describe('config: источник и секрет', () => {
  it('у поля, заданного переменной, источник env, а секрет назван заданным без значения', () => {
    const h = newHome();
    withProfile(h);
    const r = run(['config'], envFor(h, { TT_TESTOPS_DEFAULT_PROJECT: '55' }));
    expect(r.code).toBe(0);
    expect(r.stdout).toContain('defaultProject: 55 (env)');
    expect(r.stdout).toMatch(/^testops\.token: задан \(/m);
  });

  it('секрет без значения отмечен как не задан', () => {
    const h = newHome();
    const dir = join(h, '.tt-testops', 'profiles', 'default');
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, 'profile.json'),
      JSON.stringify({ servers: { testops: { baseUrl: 'https://testops.example' } } }),
      'utf8',
    );
    writeFileSync(join(dir, 'credentials.json'), '{}', 'utf8');
    const r = run(['config'], envFor(h));
    expect(r.stdout).toMatch(/^testops\.token: не задан \(/m);
  });
});

describe('секрет не встречается в выводе', () => {
  it('значение токена не встречается ни в stdout, ни в stderr ни у одной команды', () => {
    const h = newHome();
    withProfile(h);
    const attempts: Array<[string[], NodeJS.ProcessEnv]> = [
      [['config'], envFor(h)],
      [['attachments'], envFor(h)],
      [['config', 'use', 'нет-такого'], envFor(h)],
      [['case', '1'], envFor(h)],
    ];
    for (const [args, env] of attempts) {
      const r = run(args, env);
      expect(r.stdout).not.toContain(TOKEN);
      expect(r.stderr).not.toContain(TOKEN);
    }
  }, 20_000);
});

describe('config init', () => {
  it('создаёт общий файл, profile.json и credentials.json; повторный запуск не меняет их', () => {
    const h = newHome();
    const r1 = run(['config', 'init'], envFor(h));
    expect(r1.code).toBe(0);
    const common = join(h, '.tt-testops', 'config.json');
    const profileFile = join(h, '.tt-testops', 'profiles', 'default', 'profile.json');
    const credentialsFile = join(h, '.tt-testops', 'profiles', 'default', 'credentials.json');
    expect(existsSync(common)).toBe(true);
    expect(existsSync(profileFile)).toBe(true);
    expect(existsSync(credentialsFile)).toBe(true);
    const before = [common, profileFile, credentialsFile].map((f) => readFileSync(f));

    const r2 = run(['config', 'init'], envFor(h));
    expect(r2.code).toBe(0);
    const after = [common, profileFile, credentialsFile].map((f) => readFileSync(f));
    for (let i = 0; i < before.length; i++) expect(after[i]?.equals(before[i] as Buffer)).toBe(true);
  });

  it('не перезаписывает существующий заполненный profile.json', () => {
    const h = newHome();
    withProfile(h);
    const profileFile = join(h, '.tt-testops', 'profiles', 'default', 'profile.json');
    const before = readFileSync(profileFile, 'utf8');
    const r = run(['config', 'init'], envFor(h));
    expect(r.code).toBe(0);
    expect(readFileSync(profileFile, 'utf8')).toBe(before);
  });

  it('config init --profile <имя> создаёт указанный профиль', () => {
    const h = newHome();
    const r = run(['config', 'init', '--profile', 'stage'], envFor(h));
    expect(r.code).toBe(0);
    expect(existsSync(join(h, '.tt-testops', 'profiles', 'stage', 'profile.json'))).toBe(true);
    expect(existsSync(join(h, '.tt-testops', 'profiles', 'stage', 'credentials.json'))).toBe(true);
  });


  it('права credentials.json равны 0600 на POSIX', () => {
    const h = newHome();
    run(['config', 'init'], envFor(h));
    const credentialsFile = join(h, '.tt-testops', 'profiles', 'default', 'credentials.json');
    if (process.platform !== 'win32') {
      const mode = statSync(credentialsFile).mode & 0o777;
      expect(mode).toBe(0o600);
    } else {
      expect(existsSync(credentialsFile)).toBe(true);
    }
  });
});

describe('config use', () => {
  it('меняет поле profile общего файла на существующий профиль', () => {
    const h = newHome();
    withProfile(h);
    withProfile(h, 'ci');
    const r = run(['config', 'use', 'ci'], envFor(h));
    expect(r.code).toBe(0);
    const common = JSON.parse(readFileSync(join(h, '.tt-testops', 'config.json'), 'utf8')) as {
      profile: string;
    };
    expect(common.profile).toBe('ci');
  });

  it('повреждённый config.json — ошибка с путём, файл не перезаписан', () => {
    const h = newHome();
    withProfile(h);
    withProfile(h, 'ci');
    const common = join(h, '.tt-testops', 'config.json');
    writeFileSync(common, '{ не json', 'utf8');
    const r = run(['config', 'use', 'ci'], envFor(h));
    expect(r.code).not.toBe(0);
    expect(r.stderr).toContain(common);
    expect(readFileSync(common, 'utf8')).toBe('{ не json');
  });

  it('на несуществующий профиль завершается не нулём и называет путь', () => {
    const h = newHome();
    withProfile(h);
    const r = run(['config', 'use', 'призрак'], envFor(h));
    expect(r.code).not.toBe(0);
    expect(r.stderr).toContain(join(h, '.tt-testops', 'profiles', 'призрак'));
  });
});

describe('config profiles', () => {
  it('печатает список профилей с описанием и отмечает текущий', () => {
    const h = newHome();
    withProfile(h);
    const dir = join(h, '.tt-testops', 'profiles', 'ci');
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, 'profile.json'),
      JSON.stringify({
        servers: { testops: { baseUrl: 'https://testops.example' } },
        description: 'контур CI',
      }),
      'utf8',
    );
    writeFileSync(join(dir, 'credentials.json'), JSON.stringify({ testops: { token: TOKEN } }), 'utf8');
    mkdirSync(join(h, '.tt-testops', 'profiles', 'default', 'attachments.lock'), { recursive: true });
    const r = run(['config', 'profiles'], envFor(h));
    expect(r.code).toBe(0);
    expect(r.stdout).toContain('ci');
    expect(r.stdout).toContain('контур CI');
    expect(r.stdout).toMatch(/\*\s+default/);
    expect(r.stdout).not.toContain('.lock');
  });
});

describe('config не обращается к серверу', () => {
  it('с недоступным адресом сервера команда config всё равно успешна', () => {
    const h = newHome();
    withProfile(h);
    const r = run(['config'], envFor(h, { TT_TESTOPS_SERVER_TESTOPS_BASE_URL: 'http://127.0.0.1:9' }));
    expect(r.code).toBe(0);
  });
});
