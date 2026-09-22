import { describe, expect, it } from 'vitest';
import type { AppConfig } from '../src/config.js';
import { Gateway } from '../src/gateway.js';
import type { TestOpsClient } from '../src/testops/client.js';

const cfg: AppConfig = {
  baseUrl: 'https://x.test',
  token: 'tok',
  defaultProjectId: 14,
  projects: {},
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

const FIELDS = [
  { id: -1, name: 'Epic' },
  { id: 10, name: 'Section1' },
];
const VALUES = [
  { name: 'Раздел А', testCasesCount: 81 },

  { name: 'Кaталог  (Catalog)', testCasesCount: 42 },
];

interface Calls {
  fields: number;
  values: number;
}

function fakeClient(ids: number[], calls: Calls, dirFails = false): TestOpsClient {
  return {
    searchAll: async () => ({
      hits: ids.map((id) => ({ id, lastModifiedDate: 0 })),
      total: ids.length,
    }),
    fetchBatch: async () =>
      ids.map((id) => ({ overview: { id, name: `case ${id}` }, steps: null })),
    fetchCustomFields: async () => {
      calls.fields++;
      if (dirFails) throw new Error('directory unavailable');
      return FIELDS;
    },
    fetchFieldValues: async () => {
      calls.values++;
      return VALUES;
    },
    fetchAttachmentContent: async () => '',
  } as unknown as TestOpsClient;
}

const run = (rql: string, ids: number[], calls: Calls, dirFails = false, notes: string[] = []) =>
  new Gateway(cfg, fakeClient(ids, calls, dirFails), undefined, null, false, (m) =>
    notes.push(m),
  ).getTestCasesList([{ rql }]);

describe('an empty result is diagnosed, not shrugged off', () => {
  it('unknown field name is an error, not an empty list', async () => {
    const calls = { fields: 0, values: 0 };
    await expect(run('cf["Раздела нет"] = "x"', [], calls)).rejects.toThrowError(
      /поля «Раздела нет»/i,
    );
  });

  it('a field name differing only in case is repaired and the query repeated', async () => {
    const calls = { fields: 0, values: 0 };
    const notes: string[] = [];
    await expect(run('cf["section1"] = "Раздел А"', [], calls, false, notes)).resolves.toContain(
      'кейсов не найдено',
    );
    expect(notes.join(' ')).toMatch(/запрос исправлен: «section1» → «Section1»/);
  });

  it('a value differing only in spelling is repaired and the query repeated', async () => {
    const calls = { fields: 0, values: 0 };
    const notes: string[] = [];
    await run('cf["Section1"] = "Каталог (Catalog)"', [], calls, false, notes);
    expect(notes.join(' ')).toMatch(/«Каталог \(Catalog\)» → «Кaталог {2}\(Catalog\)»/);
  });

  it('unknown value with no look-alike lists what exists', async () => {
    const calls = { fields: 0, values: 0 };
    await expect(run('cf["Section1"] = "Раздел Аы"', [], calls)).rejects.toThrowError(
      /Доступно: Раздел А/,
    );
  });

  it('a genuinely empty section stays an empty result', async () => {
    const calls = { fields: 0, values: 0 };
    await expect(run('cf["Section1"] = "Раздел А"', [], calls)).resolves.toContain(
      'кейсов не найдено',
    );
  });

  it('a query without custom fields is not diagnosed at all', async () => {
    const calls = { fields: 0, values: 0 };
    await expect(run('tag = "Smoke"', [], calls)).resolves.toContain('кейсов не найдено');
    expect(calls.fields).toBe(0);
  });

  it('costs nothing when the search found something', async () => {
    const calls = { fields: 0, values: 0 };
    await run('cf["Section1"] = "Раздел А"', [5], calls);
    expect(calls.fields).toBe(0);
    expect(calls.values).toBe(0);
  });

  it('a broken directory leaves the empty result alone', async () => {
    const calls = { fields: 0, values: 0 };
    await expect(run('cf["Раздела нет"] = "x"', [], calls, true)).resolves.toContain(
      'кейсов не найдено',
    );
  });
});
