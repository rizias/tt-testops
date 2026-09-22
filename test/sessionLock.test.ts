import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as lockfile from 'proper-lockfile';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CaseCache } from '../src/cache.js';
import type { AppConfig } from '../src/config.js';
import { CacheError } from '../src/errors.js';
import { TestOpsClient } from '../src/testops/client.js';
import type { PortResponse, TestOpsPort } from '../src/testops/port.js';

const NOW = 1_700_000_000_000;
const jwt = `h.${Buffer.from(JSON.stringify({ exp: NOW / 1000 + 3600 })).toString('base64url')}.s`;

const cfg: AppConfig = {
  baseUrl: 'https://сервер.example',
  token: 'учётные-данные',
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
};

const response = (): PortResponse => ({
  status: 200,
  ok: true,
  json: async () => ({ access_token: jwt }),
  text: async () => JSON.stringify({ access_token: jwt }),
});

class ExchangePort implements TestOpsPort {
  exchanges = 0;

  constructor(private readonly pause: () => Promise<void> = async () => {}) {}

  async postForm(): Promise<PortResponse> {
    this.exchanges++;
    await this.pause();
    return response();
  }

  async get(): Promise<PortResponse> {
    return response();
  }
}

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'tt-session-lock-'));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
  rmSync(`${dir}.lock`, { recursive: true, force: true });
});

function client(cache: CaseCache, port: TestOpsPort, warnings: string[] = []): TestOpsClient {
  return new TestOpsClient(
    cfg,
    port,
    async () => {},
    (value) => warnings.push(value),
    cache,
    () => NOW,
  );
}

describe('замок обмена сессии', () => {
  it('два клиента обменивают токен один раз, третий читает атомарно опубликованный результат', async () => {
    const first = new ExchangePort(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    const second = new ExchangePort();
    await Promise.all([
      client(new CaseCache(dir), first).getJwt(),
      client(new CaseCache(dir), second).getJwt(),
    ]);
    expect(first.exchanges + second.exchanges).toBe(1);

    const third = new ExchangePort();
    await client(new CaseCache(dir), third).getJwt();
    expect(third.exchanges).toBe(0);
  });

  it('занятый замок ожидается с сообщением, после освобождения команда выполняется', async () => {
    const release = await lockfile.lock(dir, { retries: 0 });
    const warnings: string[] = [];
    const port = new ExchangePort();
    const pending = client(new CaseCache(dir), port, warnings).getJwt();
    await new Promise((resolve) => setTimeout(resolve, 20));
    await release();
    await pending;
    expect(warnings.join(' ')).toContain('ожидание чужого обмена токена');
    expect(port.exchanges).toBe(1);
  });

  it('устаревший замок снимается с умолчанием proper-lockfile', async () => {
    const abandoned = `${dir}.lock`;
    mkdirSync(abandoned);
    const stale = new Date(Date.now() - 11_000);
    utimesSync(abandoned, stale, stale);
    const port = new ExchangePort();
    await client(new CaseCache(dir), port).getJwt();
    expect(port.exchanges).toBe(1);
  });

  it('ошибка взятия не из-за занятости прекращает команду до обмена', async () => {
    const file = join(dir, 'вместо-каталога');
    writeFileSync(file, 'x');
    const port = new ExchangePort();
    await expect(client(new CaseCache(file), port).getJwt()).rejects.toBeInstanceOf(CacheError);
    expect(port.exchanges).toBe(0);
  });
});

describe('очистка и обмен используют один замок', () => {
  it('очистка дожидается публикации, удаляет её, следующая команда обменивает токен', async () => {
    let continueExchange: () => void = () => {};
    let exchangeStarted: () => void = () => {};
    const started = new Promise<void>((resolve) => {
      exchangeStarted = resolve;
    });
    const gate = new Promise<void>((resolve) => {
      continueExchange = resolve;
    });
    const firstPort = new ExchangePort(async () => {
      exchangeStarted();
      await gate;
    });
    const cache = new CaseCache(dir);
    const first = client(cache, firstPort).getJwt();
    await started;
    const warnings: string[] = [];
    const clearing = new CaseCache(dir).clear(() => warnings.push('ожидание очистки'));
    for (let attempt = 0; attempt < 20 && !warnings.length; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    continueExchange();
    await Promise.all([first, clearing]);
    expect(warnings).toEqual(['ожидание очистки']);

    const nextPort = new ExchangePort();
    await client(new CaseCache(dir), nextPort).getJwt();
    expect(nextPort.exchanges).toBe(1);
  });
});
