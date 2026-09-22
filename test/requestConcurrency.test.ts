import { describe, expect, it } from 'vitest';
import type { AppConfig } from '../src/config.js';
import { TestOpsClient } from '../src/testops/client.js';
import { type PortResponse, ResilientPort, type TestOpsPort } from '../src/testops/port.js';

const reply = (body: unknown, done?: Promise<void>): PortResponse => ({
  status: 200,
  ok: true,
  json: async () => body,
  text: async () => {
    await done;
    return typeof body === 'string' ? body : JSON.stringify(body);
  },
});

const deferred = () => {
  let resolve = () => {};
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
};

describe('единое ограничение одновременности', () => {
  it('не открывает больше трёх из двадцати обращений', async () => {
    let active = 0;
    let maximum = 0;
    const inner: TestOpsPort = {
      postForm: async () => reply({}),
      get: async () => {
        active++;
        maximum = Math.max(maximum, active);
        const done = new Promise<void>((resolve) =>
          setTimeout(() => {
            active--;
            resolve();
          }, 1),
        );
        return reply({}, done);
      },
    };
    const port = new ResilientPort(inner, { retries: 0, concurrency: 3 });
    await Promise.all(
      Array.from({ length: 20 }, (_, id) => port.get(`https://x.test/api/${id}`, {})),
    );
    expect(maximum).toBe(3);
  });

  it('освободившийся слот немедленно запускает следующее обращение', async () => {
    const long = deferred();
    const fast = deferred();
    const starts: string[] = [];
    const inner: TestOpsPort = {
      postForm: async () => reply({}),
      get: async (url) => {
        const id = url.at(-1) ?? '';
        starts.push(id);
        return reply({}, id === '1' ? long.promise : id === '2' ? fast.promise : undefined);
      },
    };
    const port = new ResilientPort(inner, { retries: 0, concurrency: 2 });
    const first = port.get('https://x.test/api/1', {});
    const second = port.get('https://x.test/api/2', {});
    const third = port.get('https://x.test/api/3', {});
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(starts).toEqual(['1', '2']);
    fast.resolve();
    await second;
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(starts).toEqual(['1', '2', '3']);
    await third;
    long.resolve();
    await first;
  });

  it('обмен токена, кейс, вложение и справочник делят один лимит', async () => {
    let active = 0;
    let maximum = 0;
    let exchanges = 0;
    const urls: string[] = [];
    const jwt = `h.${Buffer.from(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 3600 })).toString('base64url')}.s`;
    const tracked = async (body: unknown): Promise<PortResponse> => {
      active++;
      maximum = Math.max(maximum, active);
      const done = new Promise<void>((resolve) =>
        setTimeout(() => {
          active--;
          resolve();
        }, 1),
      );
      return reply(body, done);
    };
    const inner: TestOpsPort = {
      postForm: async () => {
        exchanges++;
        return tracked({ access_token: jwt });
      },
      get: async (url) => {
        urls.push(url);
        if (url.includes('/overview')) return tracked({ id: 1, hasManualScenario: false });
        if (url.includes('/relation')) return tracked([]);
        return tracked('вложение');
      },
    };
    const cfg = {
      baseUrl: 'https://x.test',
      token: 'tok',
      projects: {},
      people: {},
      trees: {},
      timeoutMs: 30_000,
      maxCases: 100,
      concurrency: 2,
      retries: 0,
      pageSize: 20,
      sort: 'id,DESC',
    } as AppConfig;
    const client = new TestOpsClient(cfg, inner);
    await Promise.all([
      client.fetchOverview('1'),
      client.fetchAttachment(2),
      client.fetchRelations(1),
    ]);
    expect(exchanges).toBe(1);
    expect(urls).toHaveLength(3);
    expect(maximum).toBe(2);
  });
});
