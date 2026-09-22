import { describe, expect, it } from 'vitest';
import type { AppConfig } from '../src/config.js';
import { TestOpsClient } from '../src/testops/client.js';
import { type PortResponse, ResilientPort, type TestOpsPort } from '../src/testops/port.js';

const URL = 'https://x.test/api/test';

const response = (status: number, retryAfter?: string, body = '{}'): PortResponse => ({
  status,
  ok: status >= 200 && status < 300,
  text: async () => body,
  json: async () => JSON.parse(body),
  headers: {
    get: (name) => (name.toLowerCase() === 'retry-after' ? (retryAfter ?? null) : null),
  },
});

class SequencePort implements TestOpsPort {
  calls = 0;

  constructor(private readonly values: Array<PortResponse | Error>) {}

  get(): Promise<PortResponse> {
    return this.take();
  }

  postForm(): Promise<PortResponse> {
    return this.take();
  }

  private take(): Promise<PortResponse> {
    const value = this.values[Math.min(this.calls, this.values.length - 1)];
    this.calls++;
    return value instanceof Error ? Promise.reject(value) : Promise.resolve(value as PortResponse);
  }
}

const resilient = (
  inner: TestOpsPort,
  retries: number,
  pauses: number[],
  warnings: string[] = [],
  now?: () => number,
) =>
  new ResilientPort(inner, {
    retries,
    concurrency: 8,
    sleep: async (ms) => {
      pauses.push(ms);
    },
    onWarn: (message) => warnings.push(message),
    now,
  });

describe('единое правило повтора запросов', () => {
  it('повторяет обрыв при чтении тела и отдаёт прочитанный ответ', async () => {
    let calls = 0;
    const inner: TestOpsPort = {
      postForm: async () => response(200),
      get: async () => {
        calls++;
        if (calls === 1) {
          return {
            ...response(200),
            arrayBuffer: async () => {
              throw new Error('оборвалось');
            },
          };
        }
        return response(200, undefined, 'готово');
      },
    };
    const pauses: number[] = [];
    const got = await resilient(inner, 3, pauses).get(URL, {});
    expect(await got.text()).toBe('готово');
    expect(calls).toBe(2);
    expect(pauses).toEqual([400]);
  });

  it('не повторяет обрыв тела после 404', async () => {
    const inner = new SequencePort([
      {
        ...response(404),
        arrayBuffer: async () => {
          throw new Error('оборвалось');
        },
      },
    ]);
    await expect(resilient(inner, 3, []).get(URL, {})).rejects.toThrow(/HTTP 404/);
    expect(inner.calls).toBe(1);
  });

  it('два ответа 503 сменяются успешным на третьем обращении', async () => {
    const inner = new SequencePort([response(503), response(503), response(200)]);
    const pauses: number[] = [];
    expect((await resilient(inner, 3, pauses).get(URL, {})).status).toBe(200);
    expect(inner.calls).toBe(3);
    expect(pauses).toEqual([400, 1200]);
  });

  it.each([
    ['обрыв до ответа', new Error('ECONNRESET'), 'связь оборвалась'],
    [
      'истёкшее ожидание',
      Object.assign(new Error('The operation was aborted due to timeout'), {
        name: 'TimeoutError',
      }),
      'истекло ожидание ответа',
    ],
  ])('повторяет %s', async (_name, error, reason) => {
    const inner = new SequencePort([error, response(200)]);
    const warnings: string[] = [];
    expect((await resilient(inner, 3, [], warnings).get(URL, {})).status).toBe(200);
    expect(inner.calls).toBe(2);
    expect(warnings[0]).toContain(reason);
  });

  it('при нуле повторов обращается один раз', async () => {
    const inner = new SequencePort([response(503)]);
    expect((await resilient(inner, 0, []).get(URL, {})).status).toBe(503);
    expect(inner.calls).toBe(1);
  });

  it('собственная пауза никогда не превышает 30 секунд', async () => {
    const inner = new SequencePort([response(503)]);
    const pauses: number[] = [];
    await resilient(inner, 10, pauses).get(URL, {});
    expect(Math.max(...pauses)).toBe(30_000);
    expect(pauses.every((pause) => pause <= 30_000)).toBe(true);
  });

  it('для четырёх повторов продолжает геометрическую последовательность', async () => {
    const pauses: number[] = [];
    await resilient(new SequencePort([response(503)]), 4, pauses).get(URL, {});
    expect(pauses).toEqual([400, 1200, 3600, 10_800]);
  });

  it('не повторяет 400', async () => {
    const inner = new SequencePort([response(400)]);
    expect((await resilient(inner, 3, []).get(URL, {})).status).toBe(400);
    expect(inner.calls).toBe(1);
  });
});

describe('Retry-After', () => {
  it('принимает число секунд', async () => {
    const pauses: number[] = [];
    await resilient(new SequencePort([response(429, '5'), response(200)]), 3, pauses).get(URL, {});
    expect(pauses).toEqual([5000]);
  });

  it('принимает дату HTTP', async () => {
    const now = 1_000_000;
    const pauses: number[] = [];
    await resilient(
      new SequencePort([response(429, new Date(now + 5000).toUTCString()), response(200)]),
      3,
      pauses,
      [],
      () => now,
    ).get(URL, {});
    expect(pauses).toEqual([5000]);
  });

  it.each(['скоро', new Date(0).toUTCString()])(
    'при значении %s использует собственную паузу',
    async (value) => {
      const pauses: number[] = [];
      await resilient(
        new SequencePort([response(429, value), response(200)]),
        3,
        pauses,
        [],
        () => 1000,
      ).get(URL, {});
      expect(pauses).toEqual([400]);
    },
  );

  it('не ждёт больше 30 секунд и называет запрошенное время', async () => {
    await expect(
      resilient(new SequencePort([response(429, '600')]), 3, []).get(URL, {}),
    ).rejects.toThrow(/600 секунд.*https:\/\/x\.test\/api\/test/);
  });
});

describe('видимость и окончание повторов', () => {
  it('предупреждение называет адрес, код и паузу, а результат не меняется', async () => {
    const warnings: string[] = [];
    const got = await resilient(
      new SequencePort([response(503), response(200, undefined, 'результат')]),
      3,
      [],
      warnings,
    ).get(URL, {});
    expect(await got.text()).toBe('результат');
    expect(warnings).toEqual([`повтор запроса ${URL}: HTTP 503, пауза 400 мс`]);
  });

  it('исчерпанные ответы называют последний код и адрес', async () => {
    const cfg: AppConfig = {
      baseUrl: 'https://x.test',
      token: 'tok',
      projects: {},
      people: {},
      trees: {},
      timeoutMs: 30_000,
      maxCases: 100,
      concurrency: 8,
      retries: 3,
      pageSize: 20,
      sort: 'id,DESC',
      cacheDir: '/tmp/tt-test-cache',
    };
    const inner = new SequencePort([response(503)]);
    await expect(new TestOpsClient(cfg, inner, async () => {}).getJwt()).rejects.toThrow(
      /HTTP 503.*https:\/\/x\.test\/api\/uaa\/oauth\/token/,
    );
    expect(inner.calls).toBe(4);
  });

  it('слишком долгий Retry-After у вложения не прерывает вызывающий код', async () => {
    const jwt = `h.${Buffer.from(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 3600 })).toString('base64url')}.s`;
    let attachmentCalls = 0;
    const inner: TestOpsPort = {
      postForm: async () => response(200, undefined, JSON.stringify({ access_token: jwt })),
      get: async () => {
        attachmentCalls++;
        return response(429, '600');
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
      concurrency: 8,
      retries: 3,
      pageSize: 20,
      sort: 'id,DESC',
      cacheDir: '/tmp/tt-test-cache',
    } as AppConfig;
    const got = await new TestOpsClient(cfg, inner, async () => {}).fetchAttachment(1);
    expect(got.ok).toBe(false);
    expect(attachmentCalls).toBe(1);
  });

  it('вложение использует три повтора общего правила', async () => {
    const jwt = `h.${Buffer.from(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 3600 })).toString('base64url')}.s`;
    let attachmentCalls = 0;
    const inner: TestOpsPort = {
      postForm: async () => response(200, undefined, JSON.stringify({ access_token: jwt })),
      get: async () => {
        attachmentCalls++;
        return response(503);
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
      concurrency: 8,
      retries: 3,
      pageSize: 20,
      sort: 'id,DESC',
      cacheDir: '/tmp/tt-test-cache',
    } as AppConfig;
    const got = await new TestOpsClient(cfg, inner, async () => {}).fetchAttachment(1);
    expect(got.ok).toBe(false);
    expect(attachmentCalls).toBe(4);
  });
});
