import { describe, expect, it } from 'vitest';
import type { AppConfig } from '../src/config.js';
import { TestOpsSession } from '../src/testops/session.js';
import { networkError } from '../src/testops/http.js';
import type { PortResponse, TestOpsPort } from '../src/testops/port.js';

const jwtWithExp = (secondsFromNow: number): string =>
  `h.${Buffer.from(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + secondsFromNow })).toString('base64url')}.s`;

const resp = (status: number, body: unknown): PortResponse => ({
  status,
  ok: status >= 200 && status < 300,
  json: async () => body,
  text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
});

const cfg: AppConfig = {
  baseUrl: 'https://x.test',
  token: 'секрет',
  defaultProjectId: 1,
  projects: {},
  people: {},
  trees: {},
} as unknown as AppConfig;

class RecordingPort implements TestOpsPort {
  urls: string[] = [];
  forms: Array<{ url: string; form: Record<string, string> }> = [];
  tokens = 0;
  constructor(
    private readonly reply: (url: string) => PortResponse,
    private readonly ttlSeconds = 3600,
  ) {}
  async postForm(url: string, form: Record<string, string>): Promise<PortResponse> {
    this.tokens++;
    this.forms.push({ url, form });
    return resp(200, { access_token: jwtWithExp(this.ttlSeconds) });
  }
  async get(url: string): Promise<PortResponse> {
    this.urls.push(url);
    return this.reply(url);
  }
}

const cfgR10: AppConfig = {
  baseUrl: 'https://x.test',
  token: 'tok',
  defaultProjectId: 1,
  projects: {},
} as unknown as AppConfig;

const jwt = `h.${Buffer.from(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 3600 })).toString('base64url')}.s`;

describe('обмен токена на сессию', () => {
  it('форма запроса — та, что ждёт TestOps', async () => {
    const port = new RecordingPort(() => resp(200, {}));
    await new TestOpsSession(cfg, port, null, () => {}, Date.now).getJwt();
    expect(port.forms[0]?.url).toBe('https://x.test/api/uaa/oauth/token');
    expect(port.forms[0]?.form).toEqual({
      grant_type: 'apitoken',
      scope: 'openid',
      token: 'секрет',
    });
  });

  it('живой токен переиспользуется', async () => {
    const alive = new RecordingPort(() => resp(200, {}), 3600);
    const client = new TestOpsSession(cfg, alive, null, () => {}, Date.now);
    await client.getJwt();
    await client.getJwt();
    expect(alive.tokens).toBe(1);
  });

  it('в ошибке обмена назван адрес', async () => {
    const port: TestOpsPort = {
      postForm: async () => resp(500, {}),
      get: async () => resp(200, {}),
    };
    await expect(new TestOpsSession(cfg, port, null, () => {}, Date.now).getJwt()).rejects.toThrow(
      /https:\/\/x\.test\/api\/uaa\/oauth\/token/,
    );
  });
});

describe('обмен токена при одновременных запросах', () => {
  it('выполняется один раз на всех', async () => {
    let exchanges = 0;
    const port: TestOpsPort = {
      postForm: async () => {
        exchanges++;
        await new Promise((r) => setTimeout(r, 5));
        return resp(200, { access_token: jwt });
      },
      get: async () =>
        ({ status: 200, ok: true, json: async () => ({}), text: async () => '' }) as PortResponse,
    };
    const client = new TestOpsSession(cfgR10, port, null, () => {}, Date.now);
    await Promise.all([client.getJwt(), client.getJwt(), client.getJwt(), client.getJwt()]);
    expect(exchanges).toBe(1);
  });
});

describe('сетевая ошибка отличима от ответа сервера', () => {
  it('несостоявшийся запрос даёт вид network без кода ответа', () => {
    const e = networkError('https://x.test/api/y', new Error('ECONNRESET'));
    expect(e.kind).toBe('network');
    expect(e.statusCode).toBeNull();
    expect(e.message).toContain('ECONNRESET');
  });
});
