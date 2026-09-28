import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as lockfile from 'proper-lockfile';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AttachmentStore } from '../src/attachmentStore.js';
import type { AppConfig } from '../src/config.js';
import { StorageError } from '../src/errors.js';
import { TestOpsSession } from '../src/testops/session.js';
import type { PortResponse, TestOpsPort } from '../src/testops/port.js';

const NOW = 1_700_000_000_000;
const jwt = `h.${Buffer.from(JSON.stringify({ exp: NOW / 1000 + 3600 })).toString('base64url')}.s`;

const cfg: AppConfig = {
  baseUrl: 'https://сервер.example',
  token: 'учётные-данные',
  projects: {},
  people: {},
  trees: {},
  profileDir: '/tmp/tt-test-profile',
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
});

function client(store: AttachmentStore, port: TestOpsPort, warnings: string[] = []): TestOpsSession {
  return new TestOpsSession(cfg, port, store, (value) => warnings.push(value), () => NOW);
}

describe('замок обмена сессии', () => {
  it('два клиента обменивают токен один раз, третий читает атомарно опубликованный результат', async () => {
    const first = new ExchangePort(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    const second = new ExchangePort();
    await Promise.all([
      client(new AttachmentStore(dir), first).getJwt(),
      client(new AttachmentStore(dir), second).getJwt(),
    ]);
    expect(first.exchanges + second.exchanges).toBe(1);

    const third = new ExchangePort();
    await client(new AttachmentStore(dir), third).getJwt();
    expect(third.exchanges).toBe(0);
  });

  it('занятый замок ожидается с сообщением, после освобождения команда выполняется', async () => {
    const lockDir = join(dir, 'attachments');
    mkdirSync(lockDir, { recursive: true });
    const release = await lockfile.lock(lockDir, { retries: 0 });
    const warnings: string[] = [];
    const port = new ExchangePort();
    const pending = client(new AttachmentStore(dir), port, warnings).getJwt();
    await new Promise((resolve) => setTimeout(resolve, 20));
    await release();
    await pending;
    expect(warnings.join(' ')).toContain('ожидание чужого обмена токена');
    expect(port.exchanges).toBe(1);
  });

  it('устаревший замок снимается с умолчанием proper-lockfile', async () => {
    mkdirSync(join(dir, 'attachments'), { recursive: true });
    const abandoned = `${join(dir, 'attachments')}.lock`;
    mkdirSync(abandoned);
    const stale = new Date(Date.now() - 11_000);
    utimesSync(abandoned, stale, stale);
    const port = new ExchangePort();
    await client(new AttachmentStore(dir), port).getJwt();
    expect(port.exchanges).toBe(1);
  });

  it('ошибка взятия не из-за занятости прекращает команду до обмена', async () => {
    const file = join(dir, 'вместо-каталога');
    writeFileSync(file, 'x');
    const port = new ExchangePort();
    await expect(client(new AttachmentStore(file), port).getJwt()).rejects.toBeInstanceOf(StorageError);
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
    const store = new AttachmentStore(dir);
    const first = client(store, firstPort).getJwt();
    await started;
    const warnings: string[] = [];
    const clearing = new AttachmentStore(dir).clear(() => warnings.push('ожидание очистки'));
    for (let attempt = 0; attempt < 20 && !warnings.length; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    continueExchange();
    await Promise.all([first, clearing]);
    expect(warnings).toEqual(['ожидание очистки']);

    const nextPort = new ExchangePort();
    await client(new AttachmentStore(dir), nextPort).getJwt();
    expect(nextPort.exchanges).toBe(1);
  });
});
