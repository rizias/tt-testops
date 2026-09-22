import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CaseCache } from '../src/cache.js';
import type { AppConfig } from '../src/config.js';
import { Gateway } from '../src/gateway.js';
import { TestOpsClient } from '../src/testops/client.js';
import type { PortResponse, TestOpsPort } from '../src/testops/port.js';

const NOW = 1_700_000_000_000;

const jwtAt = (expiresAt: number): string =>
  `h.${Buffer.from(JSON.stringify({ exp: expiresAt / 1000 })).toString('base64url')}.s`;

const response = (status: number, body: unknown): PortResponse => ({
  status,
  ok: status >= 200 && status < 300,
  json: async () => body,
  text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
});

const config = (baseUrl = 'https://первый.example', token = 'токен-а'): AppConfig => ({
  baseUrl,
  token,
  defaultProjectId: 14,
  projects: {},
  people: {},
  trees: {},
  timeoutMs: 30_000,
  maxCases: 100,
  concurrency: 8,
  retries: 0,
  pageSize: 20,
  sort: 'id,DESC',
  cacheDir: '/tmp/tt-test-cache',
});

class SessionPort implements TestOpsPort {
  exchanges = 0;

  constructor(
    private readonly issued: string,
    private readonly reply: (
      url: string,
      headers: Record<string, string>,
    ) => Promise<PortResponse> | PortResponse = () => response(200, {}),
  ) {}

  async postForm(): Promise<PortResponse> {
    this.exchanges++;
    return response(200, { access_token: this.issued });
  }

  get(url: string, headers: Record<string, string>): Promise<PortResponse> {
    return Promise.resolve(this.reply(url, headers));
  }
}

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'tt-session-'));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
  rmSync(`${dir}.lock`, { recursive: true, force: true });
});

function client(cfg: AppConfig, port: TestOpsPort, cache = new CaseCache(dir)): TestOpsClient {
  return new TestOpsClient(
    cfg,
    port,
    async () => {},
    () => {},
    cache,
    () => NOW,
  );
}

describe('сессия между клиентами', () => {
  it('переиспользуется только для той же пары сервера и учётных данных', async () => {
    const jwt = jwtAt(NOW + 3_600_000);
    const first = new SessionPort(jwt);
    await client(config(), first).getJwt();
    await client(config(), first).getJwt();
    expect(first.exchanges).toBe(1);

    const otherServer = new SessionPort(jwt);
    await client(config('https://второй.example'), otherServer).getJwt();
    expect(otherServer.exchanges).toBe(1);

    const otherToken = new SessionPort(jwt);
    await client(config('https://первый.example', 'токен-б'), otherToken).getJwt();
    expect(otherToken.exchanges).toBe(1);
  });

  it('ровно 60 секунд ещё допускают сессию, меньше 60 требуют обмена', async () => {
    const cfg = config();
    const cache = new CaseCache(dir);
    cache.putSession(cfg.baseUrl, cfg.token, {
      token: jwtAt(NOW + 60_000),
      expiresAt: NOW + 60_000,
    });
    const boundary = new SessionPort(jwtAt(NOW + 3_600_000));
    await client(cfg, boundary, cache).getJwt();
    expect(boundary.exchanges).toBe(0);

    cache.putSession(cfg.baseUrl, cfg.token, {
      token: jwtAt(NOW + 59_000),
      expiresAt: NOW + 59_000,
    });
    const expiring = new SessionPort(jwtAt(NOW + 3_600_000));
    await client(cfg, expiring, cache).getJwt();
    expect(expiring.exchanges).toBe(1);
  });

  it('повреждённая запись не ломает команду и заменяется обменом', async () => {
    const cfg = config();
    const cache = new CaseCache(dir);
    const server = createHash('sha1').update(cfg.baseUrl).digest('hex').slice(0, 12);
    const credentials = createHash('sha256').update(cfg.token).digest('hex').slice(0, 24);
    const sessions = join(dir, 'sessions');
    mkdirSync(sessions, { recursive: true });
    writeFileSync(join(sessions, `${server}-${credentials}.json`), '{', 'utf8');
    const port = new SessionPort(jwtAt(NOW + 3_600_000));
    await expect(client(cfg, port, cache).getJwt()).resolves.toBeTruthy();
    expect(port.exchanges).toBe(1);
  });
});

describe('восстановление после 401', () => {
  it('берёт другой свежий JWT из хранилища без обмена', async () => {
    const cfg = config();
    const cache = new CaseCache(dir);
    const oldJwt = jwtAt(NOW + 3_500_000);
    const newJwt = jwtAt(NOW + 3_600_000);
    cache.putSession(cfg.baseUrl, cfg.token, { token: oldJwt, expiresAt: NOW + 3_500_000 });
    const port = new SessionPort(newJwt, async (_url, headers) => {
      if (headers.Authorization === `Bearer ${oldJwt}`) {
        await new CaseCache(dir).withSessionLock(() =>
          new CaseCache(dir).putSession(cfg.baseUrl, cfg.token, {
            token: newJwt,
            expiresAt: NOW + 3_600_000,
          }),
        );
        return response(401, {});
      }
      return response(200, { id: 1 });
    });
    await expect(client(cfg, port, cache).fetchOverview('1')).resolves.toMatchObject({ id: 1 });
    expect(port.exchanges).toBe(0);
  });

  it('тот же отвергнутый JWT меняет один раз, повторный 401 остаётся ошибкой доступа', async () => {
    const cfg = config();
    const cache = new CaseCache(dir);
    const oldJwt = jwtAt(NOW + 3_500_000);
    const freshJwt = jwtAt(NOW + 3_600_000);
    cache.putSession(cfg.baseUrl, cfg.token, { token: oldJwt, expiresAt: NOW + 3_500_000 });
    const success = new SessionPort(freshJwt, (_url, headers) =>
      response(headers.Authorization === `Bearer ${oldJwt}` ? 401 : 200, { id: 1 }),
    );
    await expect(client(cfg, success, cache).fetchOverview('1')).resolves.toMatchObject({ id: 1 });
    expect(success.exchanges).toBe(1);

    cache.putSession(cfg.baseUrl, cfg.token, { token: oldJwt, expiresAt: NOW + 3_500_000 });
    const rejected = new SessionPort(freshJwt, () => response(401, {}));
    await expect(client(cfg, rejected, cache).fetchOverview('1')).rejects.toMatchObject({
      kind: 'auth',
      statusCode: 401,
    });
    expect(rejected.exchanges).toBe(1);
  });

  it('восемь одновременных 401 приводят к одному обмену', async () => {
    const cfg = config();
    const cache = new CaseCache(dir);
    const oldJwt = jwtAt(NOW + 3_500_000);
    const freshJwt = jwtAt(NOW + 3_600_000);
    cache.putSession(cfg.baseUrl, cfg.token, { token: oldJwt, expiresAt: NOW + 3_500_000 });
    const port = new SessionPort(freshJwt, async (_url, headers) => {
      await new Promise((resolve) => setTimeout(resolve, 5));
      return response(headers.Authorization === `Bearer ${oldJwt}` ? 401 : 200, { id: 1 });
    });
    const current = client(cfg, port, cache);
    await Promise.all(Array.from({ length: 8 }, () => current.fetchOverview('1')));
    expect(port.exchanges).toBe(1);
  });
});

describe('границы сессии', () => {
  it('принудительное обновление выгрузки не вызывает обмен', async () => {
    const cfg = config();
    const cache = new CaseCache(dir);
    cache.putSession(cfg.baseUrl, cfg.token, {
      token: jwtAt(NOW + 3_600_000),
      expiresAt: NOW + 3_600_000,
    });
    const port = new SessionPort(jwtAt(NOW + 3_600_000), (url) => {
      if (url.includes('/overview'))
        return response(200, { id: 1, projectId: 14, hasManualScenario: false });
      if (url.includes('/relation')) return response(200, []);
      return response(200, { content: [] });
    });
    const api = client(cfg, port, cache);
    await new Gateway(cfg, api, undefined, cache, true, () => {}).getTestCaseRaw('1');
    expect(port.exchanges).toBe(0);
  });

  it('JWT и API-токен не попадают в предупреждения и ошибку доступа', async () => {
    const cfg = config('https://первый.example', 'API-СЕКРЕТ');
    const cache = new CaseCache(dir);
    const oldJwt = jwtAt(NOW + 3_500_000);
    const freshJwt = jwtAt(NOW + 3_600_000);
    cache.putSession(cfg.baseUrl, cfg.token, { token: oldJwt, expiresAt: NOW + 3_500_000 });
    const warnings: string[] = [];
    const port = new SessionPort(freshJwt, () => response(401, {}));
    let message = '';
    try {
      await new TestOpsClient(
        cfg,
        port,
        async () => {},
        (value) => warnings.push(value),
        cache,
        () => NOW,
      ).fetchOverview('1');
    } catch (error) {
      message = (error as Error).message;
    }
    const visible = `${warnings.join('\n')}\n${message}`;
    expect(visible).not.toContain(cfg.token);
    expect(visible).not.toContain(oldJwt);
    expect(visible).not.toContain(freshJwt);
  });
});
