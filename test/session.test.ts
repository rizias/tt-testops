import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AttachmentStore } from '../src/attachmentStore.js';
import type { AppConfig } from '../src/config.js';
import { Gateway } from '../src/gateway.js';
import { TestOpsClient } from '../src/testops/client.js';
import { TestOpsSession } from '../src/testops/session.js';
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
  defaultProjectId: 1,
  projects: {},
  people: {},
  trees: {},
  profileDir: '/tmp/tt-test-profile',
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
});

function session(cfg: AppConfig, port: TestOpsPort, store = new AttachmentStore(dir)): TestOpsSession {
  return new TestOpsSession(cfg, port, store, () => {}, () => NOW);
}

function client(cfg: AppConfig, port: TestOpsPort, store = new AttachmentStore(dir)): TestOpsClient {
  return new TestOpsClient(
    cfg,
    port,
    () => {},
    store,
    () => NOW,
  );
}

describe('сессия между клиентами', () => {
  it('переиспользуется только для той же пары сервера и учётных данных', async () => {
    const jwt = jwtAt(NOW + 3_600_000);
    const first = new SessionPort(jwt);
    await session(config(), first).getJwt();
    await session(config(), first).getJwt();
    expect(first.exchanges).toBe(1);

    const otherServer = new SessionPort(jwt);
    await session(config('https://второй.example'), otherServer).getJwt();
    expect(otherServer.exchanges).toBe(1);

    const otherToken = new SessionPort(jwt);
    await session(config('https://первый.example', 'токен-б'), otherToken).getJwt();
    expect(otherToken.exchanges).toBe(1);
  });

  it('повреждённая запись не ломает команду и заменяется обменом', async () => {
    const cfg = config();
    const store = new AttachmentStore(dir);
    const server = createHash('sha1').update(cfg.baseUrl).digest('hex').slice(0, 12);
    const credentials = createHash('sha256').update(cfg.token).digest('hex').slice(0, 24);
    const sessions = join(dir, 'sessions');
    mkdirSync(sessions, { recursive: true });
    writeFileSync(join(sessions, `${server}-${credentials}.json`), '{', 'utf8');
    const port = new SessionPort(jwtAt(NOW + 3_600_000));
    await expect(session(cfg, port, store).getJwt()).resolves.toBeTruthy();
    expect(port.exchanges).toBe(1);
  });
});

describe('восстановление после 401', () => {
  it('берёт другой свежий JWT из хранилища без обмена', async () => {
    const cfg = config();
    const store = new AttachmentStore(dir);
    const oldJwt = jwtAt(NOW + 3_500_000);
    const newJwt = jwtAt(NOW + 3_600_000);
    store.putSession(cfg.baseUrl, cfg.token, { token: oldJwt, expiresAt: NOW + 3_500_000 });
    const port = new SessionPort(newJwt, async (_url, headers) => {
      if (headers.Authorization === `Bearer ${oldJwt}`) {
        await new AttachmentStore(dir).withSessionLock(() =>
          new AttachmentStore(dir).putSession(cfg.baseUrl, cfg.token, {
            token: newJwt,
            expiresAt: NOW + 3_600_000,
          }),
        );
        return response(401, {});
      }
      return response(200, { id: 1 });
    });
    await expect(client(cfg, port, store).fetchOverview('1')).resolves.toMatchObject({ id: 1 });
    expect(port.exchanges).toBe(0);
  });

  it('тот же отвергнутый JWT меняет один раз, повторный 401 остаётся ошибкой доступа', async () => {
    const cfg = config();
    const store = new AttachmentStore(dir);
    const oldJwt = jwtAt(NOW + 3_500_000);
    const freshJwt = jwtAt(NOW + 3_600_000);
    store.putSession(cfg.baseUrl, cfg.token, { token: oldJwt, expiresAt: NOW + 3_500_000 });
    const success = new SessionPort(freshJwt, (_url, headers) =>
      response(headers.Authorization === `Bearer ${oldJwt}` ? 401 : 200, { id: 1 }),
    );
    await expect(client(cfg, success, store).fetchOverview('1')).resolves.toMatchObject({ id: 1 });
    expect(success.exchanges).toBe(1);

    store.putSession(cfg.baseUrl, cfg.token, { token: oldJwt, expiresAt: NOW + 3_500_000 });
    const rejected = new SessionPort(freshJwt, () => response(401, {}));
    await expect(client(cfg, rejected, store).fetchOverview('1')).rejects.toMatchObject({
      kind: 'auth',
      statusCode: 401,
    });
    expect(rejected.exchanges).toBe(1);
  });

  it('восемь одновременных 401 приводят к одному обмену', async () => {
    const cfg = config();
    const store = new AttachmentStore(dir);
    const oldJwt = jwtAt(NOW + 3_500_000);
    const freshJwt = jwtAt(NOW + 3_600_000);
    store.putSession(cfg.baseUrl, cfg.token, { token: oldJwt, expiresAt: NOW + 3_500_000 });
    const port = new SessionPort(freshJwt, async (_url, headers) => {
      await new Promise((resolve) => setTimeout(resolve, 5));
      return response(headers.Authorization === `Bearer ${oldJwt}` ? 401 : 200, { id: 1 });
    });
    const current = client(cfg, port, store);
    await Promise.all(Array.from({ length: 8 }, () => current.fetchOverview('1')));
    expect(port.exchanges).toBe(1);
  });
});

describe('границы сессии', () => {
  it('действующая сохранённая сессия не вызывает обмен', async () => {
    const cfg = config();
    const store = new AttachmentStore(dir);
    store.putSession(cfg.baseUrl, cfg.token, {
      token: jwtAt(NOW + 3_600_000),
      expiresAt: NOW + 3_600_000,
    });
    const port = new SessionPort(jwtAt(NOW + 3_600_000), (url) => {
      if (url.includes('/overview'))
        return response(200, { id: 1, projectId: 1, hasManualScenario: false });
      if (url.includes('/relation')) return response(200, []);
      return response(200, { content: [] });
    });
    const api = client(cfg, port, store);
    await new Gateway(cfg, api, undefined, store, () => {}).getTestCaseRaw('1');
    expect(port.exchanges).toBe(0);
  });

  it('JWT без срока переиспользуется следующим запуском и меняется только после 401', async () => {
    const cfg = config();
    const noExp = 'h.e30.s';
    const store = new AttachmentStore(dir);
    const first = client(cfg, new SessionPort(noExp), store);
    await first.fetchProjects();
    expect(store.getSession(cfg.baseUrl, cfg.token)).toEqual({ token: noExp, expiresAt: null });

    let rejected = 0;
    const port = new SessionPort(jwtAt(NOW + 3_600_000), (_url, headers) => {
      if (headers.Authorization === `Bearer ${noExp}`) {
        rejected++;
        return response(401, {});
      }
      return response(200, { content: [] });
    });
    const second = client(cfg, port, new AttachmentStore(dir));
    await second.fetchProjects();
    expect(rejected).toBe(1);
    expect(port.exchanges).toBe(1);
  });

  it('JWT и API-токен не попадают в предупреждения и ошибку доступа', async () => {
    const cfg = config('https://первый.example', 'API-СЕКРЕТ');
    const store = new AttachmentStore(dir);
    const oldJwt = jwtAt(NOW + 3_500_000);
    const freshJwt = jwtAt(NOW + 3_600_000);
    store.putSession(cfg.baseUrl, cfg.token, { token: oldJwt, expiresAt: NOW + 3_500_000 });
    const warnings: string[] = [];
    const port = new SessionPort(freshJwt, () => response(401, {}));
    let message = '';
    try {
      await new TestOpsClient(
        cfg,
        port,
        (value) => warnings.push(value),
        store,
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
