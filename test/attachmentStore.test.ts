import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AttachmentStore, humanSize } from '../src/attachmentStore.js';
import type { AppConfig } from '../src/config.js';
import { Gateway } from '../src/gateway.js';
import type { RawCase } from '../src/model.js';
import type { TestOpsClient } from '../src/testops/client.js';
import { listedIds } from './listedCases.js';

let dir: string;
let store: AttachmentStore;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'tt-store-'));
  store = new AttachmentStore(dir);
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

const rawCase = (id: number): RawCase =>
  ({
    overview: { id, name: `Кейс ${id}` },
    steps: null,
    runScenario: { steps: [] },
    comments: [],
  }) as unknown as RawCase;

describe('attachment files lie in the case directory', () => {
  it('round trips bytes under the given name', async () => {
    const path = await store.putCaseFile('1', '7.png', Buffer.from([1, 2, 3]));
    expect(path).toBe(join(dir, 'attachments', 'case-1', '7.png'));
    expect(store.caseFileNames('1')).toEqual(['7.png']);
    expect([...readFileSync(path)]).toEqual([1, 2, 3]);
  });

  it('lists nothing for a case never stored', () => {
    expect(store.caseFileNames('999')).toEqual([]);
  });

  it('drops the named files only', async () => {
    await store.putCaseFile('1', '7.png', Buffer.from([1]));
    await store.putCaseFile('1', '8.png', Buffer.from([2]));
    await store.dropCaseFiles('1', ['7.png']);
    expect(store.caseFileNames('1')).toEqual(['8.png']);
  });
});

describe('the store can be inspected and emptied', () => {
  it('counts attachment files and bytes', async () => {
    await store.putCaseFile('1', '7.png', Buffer.alloc(2048));
    await store.putCaseFile('2', '9.md', Buffer.alloc(100));
    const s = store.stats();
    expect(s.files).toBe(2);
    expect(s.bytes).toBe(2148);
  });

  it('does not count sessions and trees as attachments', async () => {
    await store.putCaseFile('1', '7.png', Buffer.alloc(100));
    store.putSession('https://x.test', 'tok', { token: 'jwt', expiresAt: null });
    await store.putTrees('https://x.test', 1, []);
    expect(store.stats()).toEqual({ files: 1, bytes: 100, dir });
  });

  it('removes attachments, sessions and trees and keeps the rest of the profile', async () => {
    writeFileSync(join(dir, 'profile.json'), '{}');
    await store.putCaseFile('1', '7.png', Buffer.alloc(2048));
    store.putSession('https://x.test', 'tok', { token: 'jwt', expiresAt: null });
    await store.putTrees('https://x.test', 1, []);
    await store.clear();
    for (const name of ['attachments', 'sessions', 'trees']) expect(existsSync(join(dir, name))).toBe(false);
    expect(existsSync(join(dir, 'profile.json'))).toBe(true);
    expect(store.stats().files).toBe(0);
    expect(store.getSession('https://x.test', 'tok')).toBeNull();
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
  defaultProjectId: 1,
  projects: { '1': 'WEB' },
  people: {},
  trees: {},
  profileDir: '/tmp/tt-test-profile',
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

describe('данные кейса запрашиваются у сервера каждый раз', () => {
  it('второй одинаковый запрос снова обращается к серверу', async () => {
    const fetched: number[][] = [];
    const dates = { 1: 100, 2: 200 };
    const gw = () => new Gateway(cfg, countingClient(dates, fetched), undefined, store);

    await listedIds(gw(), [{ rql: 'tag = "x"' }]);
    expect(fetched[0]?.sort()).toEqual([1, 2]);

    await listedIds(gw(), [{ rql: 'tag = "x"' }]);
    expect(fetched).toHaveLength(2);
    expect(fetched[1]?.sort()).toEqual([1, 2]);
  });

  it('gives the same result on a repeated call', async () => {
    const fetched: number[][] = [];
    const dates = { 1: 100, 2: 200 };
    const md = () => new Gateway(cfg, countingClient(dates, fetched), undefined, store).getTestCasesList([{ rql: 'q' }]);
    const first = await md();
    const second = await md();
    expect(first).toContain('(ID: 1)');
    expect(second).toBe(first);
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
    const r = await listedIds(new Gateway(cfg, client, undefined, store), [{ rql: 'q' }]);
    expect(r).toEqual(['3', '1', '2']);
  });
});
