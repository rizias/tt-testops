import { describe, expect, it } from 'vitest';
import type { AppConfig } from '../src/config.js';
import { Gateway } from '../src/gateway.js';
import type { TestOpsClient } from '../src/testops/client.js';
import { currentFormat, withComments } from './fixtures.js';

const cfg: AppConfig = {
  baseUrl: 'https://x.test',
  token: 'tok',
  defaultProjectId: 14,
  projects: { '14': 'Проект' },
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

const client = (found: unknown): TestOpsClient =>
  ({
    fetchOverview: async () => (found as { overview?: unknown } | null)?.overview ?? null,
    fetchCaseFromOverview: async () => found,
    fetchTrees: async () => [],
  }) as unknown as TestOpsClient;

describe('сырой ответ отдаётся как есть', () => {
  it('содержит обзор в том виде, в каком его вернул сервер', async () => {
    const raw = await new Gateway(cfg, client(currentFormat), undefined, null).getTestCaseRaw('1');
    expect(raw?.overview).toEqual(currentFormat.overview);
  });

  it('содержит дерево шагов', async () => {
    const raw = await new Gateway(cfg, client(currentFormat), undefined, null).getTestCaseRaw('1');
    expect(raw?.steps).toEqual(currentFormat.steps);
  });

  it('содержит комментарии', async () => {
    const raw = await new Gateway(cfg, client(withComments), undefined, null).getTestCaseRaw('1');
    expect(raw?.comments).toHaveLength(2);
  });

  it('ничего не нормализует и не рендерит', async () => {
    const raw = await new Gateway(cfg, client(currentFormat), undefined, null).getTestCaseRaw('1');
    expect(raw).toEqual(currentFormat);
  });

  it('отсутствующий кейс даёт null, а не выдуманный объект', async () => {
    const raw = await new Gateway(cfg, client(null), undefined, null).getTestCaseRaw('404');
    expect(raw).toBeNull();
  });
});
