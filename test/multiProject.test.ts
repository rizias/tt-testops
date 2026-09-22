import { describe, expect, it } from 'vitest';
import type { AppConfig } from '../src/config.js';
import { Gateway } from '../src/gateway.js';
import type { RawCase, RawOverview } from '../src/model.js';
import type { TestOpsClient } from '../src/testops/client.js';

const cfg: AppConfig = {
  baseUrl: 'https://x.test',
  token: 'tok',
  defaultProjectId: 14,
  projects: { '14': 'WEB', '85': 'проект1' },
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

const WORLD: Record<number, number> = {
  10003: 14,
  10004: 14,
  10001: 85,
  10002: 85,
};

const overviewOf = (id: number): RawOverview =>
  ({
    id,
    projectId: WORLD[id],
    name: `Кейс ${id}`,
    lastModifiedDate: 1000 + id,
  }) as RawOverview;

const rawOf = (id: number): RawCase =>
  ({ overview: overviewOf(id), steps: null, comments: [] }) as unknown as RawCase;

interface Log {
  searches: Array<{ rql: string; projectId: number; size: number }>;
  overviews: number[];
  bodies: number[];
}

function fakeClient(byProject: Record<number, number[]>, log: Log): TestOpsClient {
  return {
    searchAll: async (rql: string, projectId: number, size: number) => {
      log.searches.push({ rql, projectId, size });
      const all = byProject[projectId] ?? [];
      return {
        hits: all.slice(0, size).map((id) => ({ id, lastModifiedDate: 1000 + id })),
        total: all.length,
      };
    },
    fetchBatch: async (ids: number[]) => ids.map(rawOf),
    fetchOverview: async (id: string) => {
      log.overviews.push(Number(id));
      return WORLD[Number(id)] === undefined ? null : overviewOf(Number(id));
    },
    fetchCaseFromOverview: async (ov: RawOverview) => {
      log.bodies.push(Number(ov.id));
      return rawOf(Number(ov.id));
    },
    fetchCustomFields: async () => [],
    fetchTrees: async () => [],
    fetchAttachmentContent: async () => '',
  } as unknown as TestOpsClient;
}

const emptyLog = (): Log => ({ searches: [], overviews: [], bodies: [] });

function gateway(log: Log, warnings: string[], byProject: Record<number, number[]>): Gateway {
  return new Gateway(cfg, fakeClient(byProject, log), undefined, null, false, (m) =>
    warnings.push(m),
  );
}

describe('несколько проектов в одном документе', () => {
  it('собирает кейсы обоих проектов в порядке источников', async () => {
    const log = emptyLog();
    const warnings: string[] = [];
    const gw = gateway(log, warnings, { 85: [10001, 10002], 14: [10003, 10004] });

    const r = await gw.searchCasesJson([
      { project: '85', rql: 'cf["Epic"] = "Раздел Б"' },
      { project: '14', rql: 'cf["Section1"] = "Раздел А"' },
    ]);

    expect(r.cases.map((c) => c.id)).toEqual(['10001', '10002', '10003', '10004']);
    expect(log.searches.map((s) => s.projectId)).toEqual([85, 14]);
    expect(log.searches.map((s) => s.rql)).toEqual([
      'cf["Epic"] = "Раздел Б"',
      'cf["Section1"] = "Раздел А"',
    ]);
  });

  it('повторный вызов даёт тот же результат', async () => {
    const byProject = { 85: [10001, 10002], 14: [10003, 10004] };
    const sources = [
      { project: '85', rql: 'a' },
      { project: '14', rql: 'b' },
    ];
    const first = await gateway(emptyLog(), [], byProject).searchCasesJson(sources);
    const second = await gateway(emptyLog(), [], byProject).searchCasesJson(sources);
    expect(JSON.stringify(second)).toBe(JSON.stringify(first));
  });

  it('один и тот же кейс не удваивается', async () => {
    const log = emptyLog();
    const gw = gateway(log, [], { 85: [10001, 10002] });
    const r = await gw.searchCasesJson([
      { project: '85', rql: 'a' },
      { project: '85', rql: 'b' },
    ]);
    expect(r.cases.map((c) => c.id)).toEqual(['10001', '10002']);
  });

  it('предел считается по каждому проекту отдельно', async () => {
    const log = emptyLog();
    const gw = gateway(log, [], { 85: [10001, 10002], 14: [10003, 10004] });
    const r = await gw.searchCasesJson(
      [
        { project: '85', rql: 'a' },
        { project: '14', rql: 'b' },
      ],
      1,
    );
    expect(log.searches.map((s) => s.size)).toEqual([1, 1]);
    expect(r.cases).toHaveLength(2);
  });

  it('называет потолок конфигурации, когда взято не всё', async () => {
    const warnings: string[] = [];
    const log = emptyLog();
    const many = Array.from({ length: 150 }, (_, i) => 20000 + i);
    await gateway(log, warnings, { 14: many }).searchCasesJson([{ project: '14', rql: 'a' }], 250);
    expect(log.searches[0]?.size).toBe(100);
    expect(warnings.join('\n')).toMatch(/взято 100 кейсов из 150[\s\S]*TT_TESTOPS_MAX_CASES/);
  });

  it('называет оба числа, когда взято не всё', async () => {
    const warnings: string[] = [];
    await gateway(emptyLog(), warnings, { 14: [10003, 10004, 10001] }).searchCasesJson(
      [{ project: '14', rql: 'a' }],
      2,
    );
    expect(warnings.join('\n')).toMatch(/взято 2 кейсов из 3/);
  });

  it('поиск заполнил предел ровно — сказано, что выборка могла быть шире', async () => {
    const warnings: string[] = [];
    const log = emptyLog();
    await gateway(log, warnings, { 14: [10003, 10004] }).searchCasesJson(
      [{ project: '14', rql: 'a' }],
      2,
    );
    expect(log.searches[0]?.size).toBe(2);
    expect(warnings.join('\n')).toMatch(/взято 2 кейсов — ровно заданный предел/);
  });

  it('выборка целиком не даёт предупреждения', async () => {
    const warnings: string[] = [];
    await gateway(emptyLog(), warnings, { 14: [10003, 10004] }).searchCasesJson([
      { project: '14', rql: 'a' },
    ]);
    expect(warnings.join('\n')).not.toMatch(/взято/);
  });

  it('называет кейс, тело которого не удалось получить после поиска', async () => {
    const warnings: string[] = [];
    const client = {
      ...fakeClient({ 14: [10003, 10004] }, emptyLog()),
      fetchBatch: async () => [rawOf(10003)],
    } as unknown as TestOpsClient;
    const gw = new Gateway(cfg, client, undefined, null, false, (message) =>
      warnings.push(message),
    );
    const result = await gw.searchCasesJson([{ project: '14', rql: 'a' }]);
    expect(result.cases.map((c) => c.id)).toEqual(['10003']);
    expect(warnings.join('\n')).toMatch(/10004/);
  });

  it('пустой проект назван, а документ собран из остальных', async () => {
    const warnings: string[] = [];
    const gw = gateway(emptyLog(), warnings, { 85: [10001] });
    const r = await gw.searchCasesJson([
      { project: '85', rql: 'a' },
      { project: '14', rql: 'b' },
    ]);
    expect(r.cases.map((c) => c.id)).toEqual(['10001']);
    expect(warnings.join('\n')).toMatch(/в проекте 14 .*кейсов не найдено/);
  });

  it('когда пусто везде, звучит прежнее сообщение', async () => {
    const gw = gateway(emptyLog(), [], {});
    const out = await gw.getTestCasesList([
      { project: '85', rql: 'a' },
      { project: '14', rql: 'b' },
    ]);
    expect(out).toBe('По данному запросу кейсов не найдено.');
  });

  it('однопроектный вызов ходит в поиск ровно один раз', async () => {
    const log = emptyLog();
    await gateway(log, [], { 14: [10003] }).searchCasesJson([{ rql: 'tag = "Smoke"' }]);
    expect(log.searches).toEqual([{ rql: 'tag = "Smoke"', projectId: 14, size: 100 }]);
  });
});

describe('запрос только по идентификаторам', () => {
  it('берёт кейсы из своих проектов и не ходит в поиск', async () => {
    const log = emptyLog();
    const r = await gateway(log, [], {}).searchCasesJson([{ rql: 'id in [10001, 10002, 10003]' }]);
    expect(r.cases.map((c) => c.id)).toEqual(['10001', '10002', '10003']);
    expect(r.cases.map((c) => c.project.id)).toEqual([85, 85, 14]);
    expect(log.searches).toEqual([]);
  });

  it('называет ненайденный идентификатор и выгружает остальные', async () => {
    const warnings: string[] = [];
    const r = await gateway(emptyLog(), warnings, {}).searchCasesJson([
      { rql: 'id in [10001, 999999999]' },
    ]);
    expect(r.cases.map((c) => c.id)).toEqual(['10001']);
    expect(warnings.join('\n')).toMatch(/999999999/);
  });

  it('говорит, что переданный проект не применялся', async () => {
    const warnings: string[] = [];
    await gateway(emptyLog(), warnings, {}).searchCasesJson([
      { project: '14', rql: 'id in [10001]' },
    ]);
    expect(warnings.join('\n')).toMatch(/--project 14 не применялся/);
  });

  it('предел режет список идентификаторов и говорит об этом', async () => {
    const warnings: string[] = [];
    const r = await gateway(emptyLog(), warnings, {}).searchCasesJson(
      [{ rql: 'id in [10001, 10002, 10003]' }],
      2,
    );
    expect(r.cases.map((c) => c.id)).toEqual(['10001', '10002']);
    expect(warnings.join(' ')).toMatch(/предел 2: из 3 идентификаторов взяты первые 2/);
  });

  it('без --limit список идентификаторов режется потолком конфигурации', async () => {
    const warnings: string[] = [];
    const log = emptyLog();
    const ids = Array.from({ length: 120 }, (_, i) => 10001 + i);
    await gateway(log, warnings, {}).searchCasesJson([{ rql: `id in [${ids.join(', ')}]` }]);
    expect(log.overviews).toHaveLength(100);
    expect(warnings.join(' ')).toMatch(
      /предел TT_TESTOPS_MAX_CASES равен 100: из 120 идентификаторов взяты первые 100/,
    );
  });

  it('один запрос по идентификаторам на два проекта выполняется однажды', async () => {
    const log = emptyLog();
    const warnings: string[] = [];
    const r = await gateway(log, warnings, {}).searchCasesJson([
      { project: '14', rql: 'id in [10001, 10003]' },
      { project: '85', rql: 'id in [10001, 10003]' },
    ]);
    expect(r.cases.map((c) => c.id)).toEqual(['10001', '10003']);
    expect(log.overviews).toEqual([10001, 10003]);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(/14, 85/);
  });

  it('не выдаёт ложное предупреждение о пустом проекте для id-only источника', async () => {
    const warnings: string[] = [];
    await gateway(emptyLog(), warnings, {}).searchCasesJson([
      { project: '14', rql: 'id = 999999998' },
      { project: '85', rql: 'id = 999999999' },
    ]);
    expect(warnings.join('\n')).not.toMatch(/в проекте .* кейсов не найдено/);
    expect(warnings.join('\n')).toMatch(/999999998/);
    expect(warnings.join('\n')).toMatch(/999999999/);
  });

  it('добавочное условие возвращает запрос в границы проекта', async () => {
    const log = emptyLog();
    await gateway(log, [], { 14: [10003] }).searchCasesJson([
      { project: '14', rql: 'id in [10001, 10003] and automation = false' },
    ]);
    expect(log.searches.map((s) => s.projectId)).toEqual([14]);
    expect(log.overviews).toEqual([]);
  });
});
