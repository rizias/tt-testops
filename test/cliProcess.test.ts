import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AttachmentStore } from '../src/attachmentStore.js';
import type { AppConfig } from '../src/config.js';
import { TestOpsSession } from '../src/testops/session.js';
import type { PortResponse, TestOpsPort } from '../src/testops/port.js';
import { CLI, makeProfileHome, run } from './cliRunner.js';

const VERSION = JSON.parse(readFileSync(join(process.cwd(), 'package.json'), 'utf8')).version;

describe('команда tt-testops как процесс', () => {
  it('собранный запуск существует', () => {
    expect(existsSync(CLI)).toBe(true);
  });

  it('--version печатает версию пакета и завершается нулём', () => {
    const r = run(['--version']);
    expect(r.code).toBe(0);
    expect(r.stdout.trim()).toBe(VERSION);
  });

  it('без команды показывает справку и завершается единицей', () => {
    const r = run([]);
    expect(r.code).toBe(1);
    expect(r.stdout).toContain('tt-testops — выгрузка и проверка тест-кейсов');
  });

  it('--help показывает ту же справку и завершается нулём', () => {
    const r = run(['--help']);
    expect(r.code).toBe(0);
    expect(r.stdout).toContain('Команды:');
  });

  it('update возвращает код npm', () => {
    const home = mkdtempSync(join(tmpdir(), 'tt-cli-update-'));
    const bin = join(home, 'bin');
    mkdirSync(bin);
    writeFileSync(join(bin, 'npm.cmd'), '@exit /b 7\r\n');
    writeFileSync(join(bin, 'npm'), '#!/bin/sh\nexit 7\n', { mode: 0o755 });
    const pathKey = Object.keys(process.env).find((key) => key.toUpperCase() === 'PATH') ?? 'PATH';
    try {
      const r = run(['update'], {
        HOME: home,
        USERPROFILE: home,
        [pathKey]: `${bin}${delimiter}${process.env[pathKey] ?? ''}`,
      });
      expect(r.code).toBe(7);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  it('локальная команда с выводом в файл не создаёт configstore в HOME', () => {
    const home = mkdtempSync(join(tmpdir(), 'tt-cli-notifier-'));
    const output = join(home, 'setup.txt');
    try {
      const r = run(['setup', '--out', output], {
        HOME: home,
        USERPROFILE: home,
        NODE_ENV: 'production',
        CI: 'false',
        XDG_CONFIG_HOME: join(home, '.config'),
      });
      expect(r.code).toBe(0);
      expect(existsSync(output)).toBe(true);
      expect(existsSync(join(home, '.config', 'configstore'))).toBe(false);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  it.each(['case', 'list', 'fields', 'link', 'attachments', 'projects', 'trees', 'setup'])(
    'команда %s известна разбору',
    (cmd) => {
      const env = { TT_TESTOPS_SERVER_TESTOPS_BASE_URL: 'http://127.0.0.1:9' };
      expect(run([cmd], env).stderr).not.toContain('Unknown command');
    },
  );

  it('неизвестная команда уходит в поток ошибок с кодом 1', () => {
    const r = run(['показать-всё']);
    expect(r.code).toBe(1);
    expect(r.stderr).toContain('Unknown command');
  });

  it('незнакомый флаг — ошибка с его именем, к серверу обращения нет', () => {
    const r = run(['list', 'name ~= "вход"', '--projct', '1'], {
      TT_TESTOPS_SERVER_TESTOPS_BASE_URL: 'http://127.0.0.1:9',
    });
    expect(r.code).toBe(1);
    expect(r.stderr).toContain('Незнакомый флаг: --projct');
  });

  it('на попытку что-то изменить сказано, что продукт только читает', () => {
    const r = run(['изменить-кейс']);
    expect(r.code).toBe(1);
    expect(r.stderr).toContain('Продукт только читает');
    expect(r.stderr).toContain('в интерфейсе TestOps');
  });

  it('неизвестный формат назван вместе с доступными', () => {
    const r = run(['case', '1', '--format', 'xml']);
    expect(r.code).toBe(1);
    expect(r.stderr).toContain('markdown, html, raw');
  });

  it('--text у case — ошибка с именем флага и команды, код 1', () => {
    const r = run(['case', '1', '--text', 'фраза']);
    expect(r.code).toBe(1);
    expect(r.stderr).toContain('Флаг --text у команды case не используется.');
  });

  it('флаг не той команды — ошибка, к серверу обращения нет', () => {
    const r = run(['projects', '--limit', '5'], { TT_TESTOPS_SERVER_TESTOPS_BASE_URL: 'http://127.0.0.1:9' });
    expect(r.code).toBe(1);
    expect(r.stderr).toContain('Флаг --limit у команды projects не используется.');
  });

  it('пустой --text — ошибка разбора и код 1', () => {
    const r = run(['list', '--project', '1', '--text', ' ']);
    expect(r.code).toBe(1);
    expect(r.stderr).toContain('Флагу --text нужна непустая фраза для поиска.');
  });
});

describe('разделение потоков', () => {
  let home: string;

  beforeEach(() => {
    home = makeProfileHome({ baseUrl: 'https://ts.example', token: 'токен', projects: { '1': 'WEB' } });
  });
  afterEach(() => {
    rmSync(home, { recursive: true, force: true });
  });

  it('результат идёт в стандартный вывод, а поток ошибок пуст', () => {
    const r = run(['link', 'tag = "Smoke"', '--project', '1'], { HOME: home, USERPROFILE: home });
    expect(r.code).toBe(0);
    expect(r.stdout).toContain('https://ts.example/project/1/test-cases');
    expect(r.stderr).toBe('');
  });
});

describe('команды состояния и очистки сессии', () => {
  let home: string;
  let profileDir: string;
  const baseUrl = 'https://ts.example';
  const apiToken = 'API-токен';
  const sessionJwt = `h.${Buffer.from(JSON.stringify({ exp: 2_000_000_000 })).toString('base64url')}.s`;
  const expiresAt = 2_000_000_000_000;

  beforeEach(() => {
    home = makeProfileHome({ baseUrl, token: apiToken });
    profileDir = join(home, '.tt-testops', 'profiles', 'default');
  });

  afterEach(() => {
    rmSync(home, { recursive: true, force: true });
  });

  const storeRun = (args: string[], token = apiToken) => {
    writeFileSync(
      join(home, '.tt-testops', 'profiles', 'default', 'credentials.json'),
      JSON.stringify({ testops: { token } }),
      'utf8',
    );
    return run(args, { USERPROFILE: home, HOME: home });
  };

  it('состояние показывает срок текущей пары без содержимого сессии', () => {
    new AttachmentStore(profileDir).putSession(baseUrl, apiToken, { token: sessionJwt, expiresAt });
    const current = storeRun(['attachments']);
    expect(current.code).toBe(0);
    expect(current.stdout).toContain(new Date(expiresAt).toISOString());
    expect(current.stdout).not.toContain(sessionJwt);
    expect(current.stdout).not.toContain(apiToken);

    const other = storeRun(['attachments'], 'другой-токен');
    expect(other.stdout).toContain('Сессия для настроенной пары отсутствует');
  });

  it('очистка удаляет сессию, следующему клиенту нужен обмен', async () => {
    new AttachmentStore(profileDir).putSession(baseUrl, apiToken, { token: sessionJwt, expiresAt });
    const cleared = storeRun(['attachments', 'clear']);
    expect(cleared.code).toBe(0);
    expect(cleared.stdout).toContain('Очищено');

    let exchanges = 0;
    const port: TestOpsPort = {
      postForm: async (): Promise<PortResponse> => {
        exchanges++;
        return {
          status: 200,
          ok: true,
          json: async () => ({ access_token: sessionJwt }),
          text: async () => JSON.stringify({ access_token: sessionJwt }),
        };
      },
      get: async () => ({ status: 200, ok: true, json: async () => ({}), text: async () => '{}' }),
    };
    const cfg = {
      baseUrl,
      token: apiToken,
      projects: {},
      people: {},
      trees: {},
      profileDir,
    } as AppConfig;
    await new TestOpsSession(cfg, port, new AttachmentStore(profileDir), () => {}, Date.now).getJwt();
    expect(exchanges).toBe(1);
  });
  it('состояние считает только файлы вложений и их объём', () => {
    mkdirSync(join(profileDir, 'attachments', 'case-1'), { recursive: true });
    writeFileSync(join(profileDir, 'attachments', 'case-1', '7.png'), Buffer.alloc(300));
    writeFileSync(join(profileDir, 'attachments', 'case-1', '8.png'), Buffer.alloc(200));
    mkdirSync(join(profileDir, 'trees'), { recursive: true });
    writeFileSync(join(profileDir, 'trees', 'x.json'), 'x'.repeat(1000));
    const r = storeRun(['attachments']);
    expect(r.code).toBe(0);
    expect(r.stdout).toContain(`Хранилище: ${profileDir}`);
    expect(r.stdout).toContain('Файлов вложений: 2');
    expect(r.stdout).toContain('Занимает: 500 Б');
  });

  it('очистка удаляет вложения, сессии и деревья, а настройки профиля оставляет', () => {
    new AttachmentStore(profileDir).putSession(baseUrl, apiToken, { token: sessionJwt, expiresAt });
    mkdirSync(join(profileDir, 'attachments', 'case-1'), { recursive: true });
    writeFileSync(join(profileDir, 'attachments', 'case-1', '7.png'), Buffer.alloc(10));
    mkdirSync(join(profileDir, 'trees'), { recursive: true });
    writeFileSync(join(profileDir, 'trees', 'x.json'), '{}');
    const r = storeRun(['attachments', 'clear']);
    expect(r.code).toBe(0);
    expect(r.stdout).toContain('Очищено: файлов вложений 1');
    for (const name of ['attachments', 'sessions', 'trees']) expect(existsSync(join(profileDir, name))).toBe(false);
    expect(existsSync(join(profileDir, 'profile.json'))).toBe(true);
    expect(existsSync(join(profileDir, 'credentials.json'))).toBe(true);
  });
});
