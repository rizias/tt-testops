import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadConfig, ProjectResolver } from '../src/config.js';

function makeHome(profileJson: Record<string, unknown>, credentialsJson: Record<string, unknown>) {
  const home = mkdtempSync(join(tmpdir(), 'tt-cfg-home-'));
  const profileDir = join(home, '.tt-testops', 'profiles', 'default');
  mkdirSync(profileDir, { recursive: true });
  writeFileSync(join(profileDir, 'profile.json'), JSON.stringify(profileJson), 'utf8');
  writeFileSync(join(profileDir, 'credentials.json'), JSON.stringify(credentialsJson), 'utf8');
  return { home, profileDir };
}

function envFor(home: string, extra: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  return { HOME: home, USERPROFILE: home, ...extra } as NodeJS.ProcessEnv;
}

describe('loadConfig', () => {
  it('читает profile.json и credentials.json выбранного профиля', () => {
    const { home: h } = makeHome(
      {
        servers: { testops: { baseUrl: 'https://x.test' } },
        defaultProject: 14,
        projects: { '14': 'WEB' },
        limits: { maxCases: 1000 },
      },
      { testops: { token: 'tok' } },
    );
    const cfg = loadConfig({}, envFor(h));
    expect(cfg.baseUrl).toBe('https://x.test');
    expect(cfg.token).toBe('tok');
    expect(cfg.projects['14']).toBe('WEB');
    expect(cfg.maxCases).toBe(1000);
    rmSync(h, { recursive: true, force: true });
  });

  it('переменные окружения перекрывают файл', () => {
    const { home: h } = makeHome(
      { servers: { testops: { baseUrl: 'https://file.test' } }, defaultProject: 14 },
      { testops: { token: 'filetok' } },
    );
    const cfg = loadConfig({}, envFor(h, { TT_TESTOPS_SERVER_TESTOPS_TOKEN: 'envtok' }));
    expect(cfg.baseUrl).toBe('https://file.test');
    expect(cfg.token).toBe('envtok');
    rmSync(h, { recursive: true, force: true });
  });

  it('задаёт умолчания устойчивости запросов', () => {
    const { home: h } = makeHome(
      { servers: { testops: { baseUrl: 'https://x.test' } } },
      { testops: { token: 'tok' } },
    );
    const cfg = loadConfig({}, envFor(h));
    expect(cfg.concurrency).toBe(8);
    expect(cfg.retries).toBe(3);
    rmSync(h, { recursive: true, force: true });
  });

  it.each(['0', '-1', 'не число'])('отвергает TT_TESTOPS_CONCURRENCY=%s', (value) => {
    const { home: h } = makeHome(
      { servers: { testops: { baseUrl: 'https://x.test' } } },
      { testops: { token: 'tok' } },
    );
    expect(() =>
      loadConfig({}, envFor(h, { TT_TESTOPS_CONCURRENCY: value })),
    ).toThrow(/TT_TESTOPS_CONCURRENCY/);
    rmSync(h, { recursive: true, force: true });
  });

  it('разрешает отключить повторы', () => {
    const { home: h } = makeHome(
      { servers: { testops: { baseUrl: 'https://x.test' } } },
      { testops: { token: 'tok' } },
    );
    const cfg = loadConfig({}, envFor(h, { TT_TESTOPS_RETRIES: '0' }));
    expect(cfg.retries).toBe(0);
    rmSync(h, { recursive: true, force: true });
  });

  it.each(['-1', 'не число'])('отвергает TT_TESTOPS_RETRIES=%s', (value) => {
    const { home: h } = makeHome(
      { servers: { testops: { baseUrl: 'https://x.test' } } },
      { testops: { token: 'tok' } },
    );
    expect(() => loadConfig({}, envFor(h, { TT_TESTOPS_RETRIES: value }))).toThrow(
      /TT_TESTOPS_RETRIES/,
    );
    rmSync(h, { recursive: true, force: true });
  });

  it('throws ConfigError when required values are missing', () => {
    const { home: h } = makeHome({}, {});
    expect(() => loadConfig({}, envFor(h))).toThrow();
    rmSync(h, { recursive: true, force: true });
  });

  it('загружается без defaultProject и не подставляет зашитый проект', () => {
    const { home: h } = makeHome(
      { servers: { testops: { baseUrl: 'https://x.test' } } },
      { testops: { token: 'tok' } },
    );
    const cfg = loadConfig({}, envFor(h));
    expect(cfg.defaultProjectId).toBeUndefined();
    rmSync(h, { recursive: true, force: true });
  });

  it('без проекта по умолчанию отказ наступает только при разрешении проекта', () => {
    const { home: h } = makeHome(
      {
        servers: { testops: { baseUrl: 'https://x.test' } },
        projects: { '85': 'проект1' },
      },
      { testops: { token: 'tok' } },
    );
    const resolver = new ProjectResolver(loadConfig({}, envFor(h)));

    expect(() => resolver.resolve()).toThrow(/--project.*TT_TESTOPS_DEFAULT_PROJECT/s);
    expect(resolver.resolve('85')).toBe(85);
    expect(resolver.resolve('проект1')).toBe(85);
    rmSync(h, { recursive: true, force: true });
  });
});
