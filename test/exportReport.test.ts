import { describe, expect, it } from 'vitest';
import type { AppConfig } from '../src/config.js';
import { exportReport, stampFor } from '../src/report.js';
import { TestOpsClient } from '../src/testops/client.js';
import type { PortResponse, TestOpsPort } from '../src/testops/port.js';

const cfg = {
  baseUrl: 'https://x.test',
  token: 't',
  projects: {},
  people: {},
  timeoutMs: 100,
  maxCases: 10,
  pageSize: 10,
  sort: 'id,DESC',
} as unknown as AppConfig;

const auth = {
  postForm: async () =>
    ({
      ok: true,
      status: 200,
      json: async () => ({ access_token: 'a.b.c' }),
      text: async () => JSON.stringify({ access_token: 'a.b.c' }),
    }) as PortResponse,
};

const clientWith = (get: TestOpsPort['get']) => {
  const pauses: number[] = [];
  const client = new TestOpsClient(cfg, { get, ...auth } as TestOpsPort, async (ms) => {
    pauses.push(ms);
  });
  return { client, pauses };
};

const bytes = () =>
  ({
    ok: true,
    status: 200,
    json: async () => ({}),
    text: async () => '',
    arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
    headers: { get: () => 'image/png' },
  }) as unknown as PortResponse;

const failure = (status: number) =>
  ({ ok: false, status, json: async () => ({}), text: async () => '' }) as unknown as PortResponse;

describe('вложение, которое не скачалось', () => {
  it('обрыв связи проходит со второй попытки, пауза 400 мс', async () => {
    let calls = 0;
    const { client, pauses } = clientWith(async () => {
      calls++;
      if (calls === 1) throw new Error('связь оборвалась');
      return bytes();
    });

    const got = await client.fetchAttachment(7);

    expect(got.ok).toBe(true);
    expect(calls).toBe(2);
    expect(pauses).toEqual([400]);
  });

  it('перегруженный сервер повторяется трижды, потом сдаётся с причиной', async () => {
    let calls = 0;
    const { client, pauses } = clientWith(async () => {
      calls++;
      return failure(503);
    });

    const got = await client.fetchAttachment(8);

    expect(got.ok).toBe(false);
    expect(calls).toBe(4);
    expect(pauses).toEqual([400, 1200, 3600]);
    if (!got.ok) expect(got.reason).toContain('503');
  });

  it('перегрузка 429 тоже повторяется', async () => {
    let calls = 0;
    const { client } = clientWith(async () => {
      calls++;
      return calls < 4 ? failure(429) : bytes();
    });

    const got = await client.fetchAttachment(10);

    expect(got.ok).toBe(true);
    expect(calls).toBe(4);
  });

  it('404 не повторяется: вложения на сервере нет', async () => {
    let calls = 0;
    const { client, pauses } = clientWith(async () => {
      calls++;
      return failure(404);
    });

    const got = await client.fetchAttachment(9);

    expect(got.ok).toBe(false);
    expect(calls).toBe(1);
    expect(pauses).toEqual([]);
    if (!got.ok) expect(got.reason).toContain('404');
  });
});

describe('отметка времени в имени файла', () => {
  it('склеивается в вид ГГГГ-ММ-ДД-ЧЧММСС', () => {
    expect(stampFor(new Date(2026, 7, 30, 2, 45, 12))).toBe('2026-08-30-024512');
    expect(stampFor(new Date(2026, 11, 1, 23, 5, 9))).toBe('2026-12-01-230509');
  });

  it('два вызова подряд дают разные имена в разные секунды', () => {
    const a = stampFor(new Date(2026, 7, 30, 2, 45, 12));
    const b = stampFor(new Date(2026, 7, 30, 2, 45, 13));
    expect(a).not.toBe(b);
  });
});

describe('строка отчёта', () => {
  it('называет путь, размер и время в секундах с одним знаком', () => {
    expect(exportReport('C:\\dir\\cases-2026-08-30-024512.html', 35519050, 92400)).toBe(
      'Записан файл: C:\\dir\\cases-2026-08-30-024512.html — 33.9 МБ, 92.4 с',
    );
  });

  it('маленький файл и доли секунды', () => {
    expect(exportReport('/tmp/case-1.html', 2048, 2500)).toBe(
      'Записан файл: /tmp/case-1.html — 2 КБ, 2.5 с',
    );
  });
});
