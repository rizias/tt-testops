import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config.js';
import { run } from './cliRunner.js';

let home: string;

afterEach(() => {
  if (home) rmSync(home, { recursive: true, force: true });
});

function makeHome(profileJson: Record<string, unknown>, credentialsJson: Record<string, unknown> = {}): string {
  home = mkdtempSync(join(tmpdir(), 'tt-values-home-'));
  const dir = join(home, '.tt-testops', 'profiles', 'default');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'profile.json'), JSON.stringify(profileJson), 'utf8');
  writeFileSync(join(dir, 'credentials.json'), JSON.stringify(credentialsJson), 'utf8');
  return home;
}

function envFor(h: string, extra: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  return { HOME: h, USERPROFILE: h, ...extra } as NodeJS.ProcessEnv;
}

describe('порядок источника значения', () => {
  it('переменная перекрывает значение из файла', () => {
    const h = makeHome(
      { servers: { testops: { baseUrl: 'https://x.test' } }, limits: { maxCases: 50 } },
      { testops: { token: 'tok' } },
    );
    const cfg = loadConfig({}, envFor(h, { TT_TESTOPS_MAX_CASES: '77' }));
    expect(cfg.maxCases).toBe(77);
  });

  it('файл перекрывает умолчание', () => {
    const h = makeHome(
      { servers: { testops: { baseUrl: 'https://x.test' } }, limits: { maxCases: 250 } },
      { testops: { token: 'tok' } },
    );
    const cfg = loadConfig({}, envFor(h));
    expect(cfg.maxCases).toBe(250);
  });

  it('умолчания — 30 секунд, 100 кейсов, 8 обращений, 3 повтора', () => {
    const h = makeHome(
      { servers: { testops: { baseUrl: 'https://x.test' } } },
      { testops: { token: 'tok' } },
    );
    const cfg = loadConfig({}, envFor(h));
    expect(cfg.timeoutMs).toBe(30_000);
    expect(cfg.maxCases).toBe(100);
    expect(cfg.concurrency).toBe(8);
    expect(cfg.retries).toBe(3);
  });

  it('пустая строка в переменной считается заданным значением', () => {
    const h = makeHome(
      { servers: { testops: { baseUrl: 'https://file.test' } } },
      { testops: { token: 'tok' } },
    );
    const cfg = loadConfig({}, envFor(h, { TT_TESTOPS_SERVER_TESTOPS_BASE_URL: '' }));
    expect(cfg.baseUrl).toBe('');
  });

  it('отсутствие переменной считается отсутствием значения', () => {
    const h = makeHome(
      { servers: { testops: { baseUrl: 'https://file.test' } } },
      { testops: { token: 'tok' } },
    );
    const cfg = loadConfig({}, envFor(h));
    expect(cfg.baseUrl).toBe('https://file.test');
  });
});

describe('числовые переменные', () => {
  it('нечисловое значение переменной приводит к ошибке с её именем', () => {
    const h = makeHome(
      { servers: { testops: { baseUrl: 'https://x.test' } } },
      { testops: { token: 'tok' } },
    );
    expect(() => loadConfig({}, envFor(h, { TT_TESTOPS_TIMEOUT_SEC: 'скоро' }))).toThrow(
      /TT_TESTOPS_TIMEOUT_SEC/,
    );
  });

  it('значение вне диапазона приводит к ошибке с её именем', () => {
    const h = makeHome(
      { servers: { testops: { baseUrl: 'https://x.test' } } },
      { testops: { token: 'tok' } },
    );
    expect(() => loadConfig({}, envFor(h, { TT_TESTOPS_TIMEOUT_SEC: '0' }))).toThrow(
      /TT_TESTOPS_TIMEOUT_SEC/,
    );
  });
});

describe('путь formatFile', () => {
  it('относительный путь разбирается от каталога profile.json', () => {
    const h = makeHome(
      { servers: { testops: { baseUrl: 'https://x.test' } }, formatFile: 'вложенный/формат.json' },
      { testops: { token: 'tok' } },
    );
    const cfg = loadConfig({}, envFor(h));
    expect(cfg.formatFile).toBe(
      join(home, '.tt-testops', 'profiles', 'default', 'вложенный', 'формат.json'),
    );
  });

  it('начальное ~ разворачивается в домашний каталог запущенного процесса', () => {
    home = mkdtempSync(join(tmpdir(), 'tt-values-home-'));
    const dir = join(home, '.tt-testops', 'profiles', 'default');
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, 'profile.json'),
      JSON.stringify({
        servers: { testops: { baseUrl: 'https://ts.example' } },
        formatFile: '~/мой-формат.json',
      }),
      'utf8',
    );
    writeFileSync(join(dir, 'credentials.json'), JSON.stringify({ testops: { token: 'tok' } }), 'utf8');
    const r = run(['config', '--json'], { HOME: home, USERPROFILE: home });
    expect(r.code).toBe(0);
    const view = JSON.parse(r.stdout) as { fields: Array<{ key: string; value: unknown }> };
    const field = view.fields.find((f) => f.key === 'formatFile');
    expect(field?.value).toBe(join(home, 'мой-формат.json'));
  });
});

describe('BOM в начале profile.json', () => {
  it('файл с BOM читается как обычный JSON', () => {
    home = mkdtempSync(join(tmpdir(), 'tt-values-home-'));
    const dir = join(home, '.tt-testops', 'profiles', 'default');
    mkdirSync(dir, { recursive: true });
    const withBom = `﻿${JSON.stringify({ servers: { testops: { baseUrl: 'https://bom.test' } } })}`;
    writeFileSync(join(dir, 'profile.json'), withBom, 'utf8');
    writeFileSync(join(dir, 'credentials.json'), JSON.stringify({ testops: { token: 'tok' } }), 'utf8');
    const cfg = loadConfig({}, envFor(home));
    expect(cfg.baseUrl).toBe('https://bom.test');
  });
});

