import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CaseCache, humanSize } from '../src/cache.js';
import type { AppConfig } from '../src/config.js';
import { Gateway } from '../src/gateway.js';
import type { RawCase } from '../src/model.js';
import type { TestOpsClient } from '../src/testops/client.js';

let dir: string;
let cache: CaseCache;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'tt-cache-'));
  cache = new CaseCache(dir);
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

const rawCase = (id: number): RawCase =>
  ({ overview: { id, name: `Кейс ${id}` }, steps: null, comments: [] }) as unknown as RawCase;

describe('cases are kept only while their date matches', () => {
  it('returns nothing for a case never stored', () => {
    expect(cache.getCase(14, 1, 100)).toBeNull();
  });

  it('returns the stored case when the date is the same', () => {
    cache.putCase(14, 1, 100, rawCase(1));
    expect(cache.getCase(14, 1, 100)?.overview.id).toBe(1);
  });

  it('misses when TestOps reports a newer date', () => {
    cache.putCase(14, 1, 100, rawCase(1));
    expect(cache.getCase(14, 1, 101)).toBeNull();
  });

  it('keeps projects apart', () => {
    cache.putCase(14, 1, 100, rawCase(1));
    expect(cache.getCase(85, 1, 100)).toBeNull();
  });

  it('treats an unreadable record as a miss, not a failure', () => {
    cache.putCase(14, 1, 100, rawCase(1));
    for (const file of readdirSync(join(dir, 'cases'))) {
      writeFileSync(join(dir, 'cases', file), 'не json');
    }
    expect(() => cache.getCase(14, 1, 100)).not.toThrow();
    expect(cache.getCase(14, 1, 100)).toBeNull();
  });

  it('записи разных серверов не смешиваются', () => {
    cache.useServer('https://первый.example');
    cache.putCase(14, 1, 100, rawCase(1));
    cache.useServer('https://второй.example');
    expect(cache.getCase(14, 1, 100)).toBeNull();
    cache.useServer('https://первый.example');
    expect(cache.getCase(14, 1, 100)).not.toBeNull();
  });
});

describe('attachments are stored by id and never rechecked', () => {
  it('round trips bytes and content type', () => {
    cache.putAttachment(7, Buffer.from([1, 2, 3]), 'image/png');
    const got = cache.getAttachment(7);
    expect(got?.contentType).toBe('image/png');
    expect([...(got?.bytes ?? [])]).toEqual([1, 2, 3]);
  });

  it('returns nothing for an attachment never stored', () => {
    expect(cache.getAttachment(999)).toBeNull();
  });
});

describe('the store can be inspected and emptied', () => {
  it('counts cases, attachments and bytes', () => {
    cache.putCase(14, 1, 100, rawCase(1));
    cache.putCase(14, 2, 100, rawCase(2));
    cache.putAttachment(7, Buffer.alloc(2048), 'image/png');
    const s = cache.stats();
    expect(s.cases).toBe(2);
    expect(s.attachments).toBe(1);
    expect(s.bytes).toBeGreaterThan(2048);
  });

  it('is empty after clearing', async () => {
    cache.putCase(14, 1, 100, rawCase(1));
    await cache.clear();
    expect(existsSync(dir)).toBe(false);
    expect(cache.stats().cases).toBe(0);
  });

  it('reports size in units a person reads', () => {
    expect(humanSize(512)).toBe('512 Б');
    expect(humanSize(2048)).toBe('2 КБ');
    expect(humanSize(3 * 1024 * 1024)).toBe('3.0 МБ');
  });
});

const cfg: AppConfig = {
  baseUrl: 'https://x.test',
  token: 'tok',
  defaultProjectId: 14,
  projects: { '14': 'WEB' },
  people: {},
  trees: {},
  timeoutMs: 30000,
  maxCases: 100,
  concurrency: 8,
  retries: 3,
  pageSize: 20,
  sort: 'id,DESC',
  cacheDir: '/tmp/tt-test-cache',
};

function countingClient(dates: Record<number, number>, fetched: number[][]): TestOpsClient {
  return {
    searchAll: async () => ({
      hits: Object.entries(dates).map(([id, d]) => ({ id: Number(id), lastModifiedDate: d })),
      total: Object.keys(dates).length,
    }),
    fetchBatch: async (ids: number[]) => {
      fetched.push([...ids]);
      return ids.map((id) => rawCase(id));
    },
    fetchAttachmentContent: async () => '',
  } as unknown as TestOpsClient;
}

describe('a repeated selection does not go back to the network', () => {
  it('fetches everything the first time and nothing the second', async () => {
    const fetched: number[][] = [];
    const dates = { 1: 100, 2: 200 };
    const gw = () => new Gateway(cfg, countingClient(dates, fetched), undefined, cache);

    await gw().searchCasesJson([{ rql: 'tag = "x"' }]);
    expect(fetched[0]?.sort()).toEqual([1, 2]);

    await gw().searchCasesJson([{ rql: 'tag = "x"' }]);
    expect(fetched).toHaveLength(1);
  });

  it('fetches only the case whose date moved', async () => {
    const fetched: number[][] = [];
    await new Gateway(
      cfg,
      countingClient({ 1: 100, 2: 200 }, fetched),
      undefined,
      cache,
    ).searchCasesJson([{ rql: 'q' }]);
    await new Gateway(
      cfg,
      countingClient({ 1: 100, 2: 999 }, fetched),
      undefined,
      cache,
    ).searchCasesJson([{ rql: 'q' }]);
    expect(fetched[1]).toEqual([2]);
  });

  it('re-reads everything when asked to refresh', async () => {
    const fetched: number[][] = [];
    const dates = { 1: 100, 2: 200 };
    await new Gateway(cfg, countingClient(dates, fetched), undefined, cache).searchCasesJson([
      { rql: 'q' },
    ]);
    await new Gateway(cfg, countingClient(dates, fetched), undefined, cache, true).searchCasesJson([
      { rql: 'q' },
    ]);
    expect(fetched[1]?.sort()).toEqual([1, 2]);
  });

  it('gives the same result from the store as from the network', async () => {
    const fetched: number[][] = [];
    const dates = { 1: 100, 2: 200 };
    const first = await new Gateway(
      cfg,
      countingClient(dates, fetched),
      undefined,
      cache,
    ).searchCasesJson([{ rql: 'q' }]);
    const second = await new Gateway(
      cfg,
      countingClient(dates, fetched),
      undefined,
      cache,
    ).searchCasesJson([{ rql: 'q' }]);
    expect(JSON.stringify(second)).toBe(JSON.stringify(first));
  });

  it('keeps the order the search returned', async () => {
    const hits = [
      { id: 3, lastModifiedDate: 1 },
      { id: 1, lastModifiedDate: 2 },
      { id: 2, lastModifiedDate: 3 },
    ];
    const client = {
      searchAll: async () => ({ hits, total: hits.length }),
      fetchBatch: async (ids: number[]) => ids.map((id) => rawCase(id)),
      fetchAttachmentContent: async () => '',
    } as unknown as TestOpsClient;
    const r = await new Gateway(cfg, client, undefined, cache).searchCasesJson([{ rql: 'q' }]);
    expect(r.cases.map((c) => c.id)).toEqual(['3', '1', '2']);
  });
});
