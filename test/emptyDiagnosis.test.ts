import { describe, expect, it } from 'vitest';
import type { AppConfig } from '../src/config.js';
import { Gateway } from '../src/gateway.js';
import type { TestOpsClient } from '../src/testops/client.js';

const cfg: AppConfig = {
  baseUrl: 'https://x.test',
  token: 'tok',
  defaultProjectId: 1,
  projects: {},
  people: {},
  trees: {},
  profileDir: '/tmp/tt-test-profile',
};

const FIELDS = [
  { id: -1, name: 'Поле0' },
  { id: 10, name: 'Поле1' },
];
const VALUES = [
  { name: 'Раздел А', testCasesCount: 81 },

  { name: 'Знaчение  Б (B)', testCasesCount: 42 },
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
  new Gateway(cfg, fakeClient(ids, calls, dirFails), undefined, null, (m) =>
    notes.push(m),
  ).getTestCasesList([{ rql }]);

describe('an empty result is diagnosed, not shrugged off', () => {
  it('unknown field name is an error, not an empty list', async () => {
    const calls = { fields: 0, values: 0 };
    await expect(run('cf["Раздела нет"] = "x"', [], calls)).rejects.toThrowError(
      /поля «Раздела нет»/i,
    );
  });

  it('unknown value with no look-alike lists what exists', async () => {
    const calls = { fields: 0, values: 0 };
    await expect(run('cf["Поле1"] = "Раздел Аы"', [], calls)).rejects.toThrowError(
      /Доступно: Раздел А/,
    );
  });

  it('a genuinely empty section stays an empty result', async () => {
    const calls = { fields: 0, values: 0 };
    await expect(run('cf["Поле1"] = "Раздел А"', [], calls)).resolves.toContain(
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
    await run('cf["Поле1"] = "Раздел А"', [5], calls);
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
