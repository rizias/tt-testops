import { describe, expect, it } from 'vitest';
import type { AppConfig } from '../src/config.js';
import { Gateway } from '../src/gateway.js';
import type { RawCase, RawOverview } from '../src/model.js';
import { TestOpsClient } from '../src/testops/client.js';
import type { PortResponse, TestOpsPort } from '../src/testops/port.js';
import { listedIds } from './listedCases.js';

const resp = (status: number, body: unknown): PortResponse => ({
  status,
  ok: status >= 200 && status < 300,
  json: async () => body,
  text: async () => JSON.stringify(body),
});

const FAKE_JWT = `h.${Buffer.from(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 3600 })).toString('base64url')}.s`;

const cfg: AppConfig = {
  baseUrl: 'https://x.test',
  token: 'tok',
  defaultProjectId: 1,
  projects: { '1': 'WEB', '2': 'проект1' },
  people: {},
  trees: {},
  profileDir: '/tmp/tt-test-profile',
};

const WORLD: Record<number, number> = {
  10003: 1,
  10004: 1,
  10001: 2,
  10002: 2,
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
    searchAll: async (query: { rql: string }, projectId: number, size: number) => {
      log.searches.push({ rql: query.rql, projectId, size });
      const all = byProject[projectId] ?? [];
      return {
        hits: all.slice(0, size).map((id) => ({ id, lastModifiedDate: 1000 + id })),
        total: all.length,
      };
    },
    fetchBatch: async (ids: number[]) => ids.map(rawOf),
    countCases: async () => 0,
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
  return new Gateway(cfg, fakeClient(byProject, log), undefined, null, (m) =>
    warnings.push(m),
  );
}

describe('несколько проектов в одном документе', () => {
  it('собирает кейсы обоих проектов в порядке источников', async () => {
    const log = emptyLog();
    const warnings: string[] = [];
    const gw = gateway(log, warnings, { 2: [10001, 10002], 1: [10003, 10004] });

    const r = await listedIds(gw, [
      { project: '2', rql: 'cf["Поле0"] = "Раздел Б"' },
      { project: '1', rql: 'cf["Поле1"] = "Раздел А"' },
    ]);

    expect(r).toEqual(['10001', '10002', '10003', '10004']);
    expect(log.searches.map((s) => s.projectId)).toEqual([2, 1]);
    expect(log.searches.map((s) => s.rql)).toEqual([
      'cf["Поле0"] = "Раздел Б"',
      'cf["Поле1"] = "Раздел А"',
    ]);
  });

  it('повторный вызов даёт тот же результат', async () => {
    const byProject = { 2: [10001, 10002], 1: [10003, 10004] };
    const sources = [
      { project: '2', rql: 'a' },
      { project: '1', rql: 'b' },
    ];
    const first = await listedIds(gateway(emptyLog(), [], byProject), sources);
    const second = await listedIds(gateway(emptyLog(), [], byProject), sources);
    expect(JSON.stringify(second)).toBe(JSON.stringify(first));
  });

  it('один и тот же кейс не удваивается', async () => {
    const log = emptyLog();
    const gw = gateway(log, [], { 2: [10001, 10002] });
    const r = await listedIds(gw, [
      { project: '2', rql: 'a' },
      { project: '2', rql: 'b' },
    ]);
    expect(r).toEqual(['10001', '10002']);
  });

  it('предел считается по каждому проекту отдельно', async () => {
    const log = emptyLog();
    const gw = gateway(log, [], { 2: [10001, 10002], 1: [10003, 10004] });
    const r = await listedIds(gw, 
      [
        { project: '2', rql: 'a' },
        { project: '1', rql: 'b' },
      ],
      1,
    );
    expect(log.searches.map((s) => s.size)).toEqual([1, 1]);
    expect(r).toHaveLength(2);
  });

  it('без --limit выгружает все найденные кейсы, даже когда их больше сотни', async () => {
    const warnings: string[] = [];
    const log = emptyLog();
    const many = Array.from({ length: 150 }, (_, i) => 20000 + i);
    const r = await listedIds(gateway(log, warnings, { 1: many }), [
      { project: '1', rql: 'a' },
    ]);
    expect(r).toHaveLength(150);
    expect(warnings.join('\n')).not.toMatch(/взято/);
  });

  it('называет оба числа, когда взято не всё', async () => {
    const warnings: string[] = [];
    await listedIds(gateway(emptyLog(), warnings, { 1: [10003, 10004, 10001] }), 
      [{ project: '1', rql: 'a' }],
      2,
    );
    expect(warnings.join('\n')).toMatch(/взято 2 кейсов из 3/);
  });

  it('выборка целиком не даёт предупреждения', async () => {
    const warnings: string[] = [];
    await listedIds(gateway(emptyLog(), warnings, { 1: [10003, 10004] }), [
      { project: '1', rql: 'a' },
    ]);
    expect(warnings.join('\n')).not.toMatch(/взято/);
  });

  it('называет кейс, тело которого не удалось получить после поиска', async () => {
    const warnings: string[] = [];
    class OneBodyMissingPort implements TestOpsPort {
      async postForm(): Promise<PortResponse> {
        return resp(200, { access_token: FAKE_JWT });
      }
      async get(url: string): Promise<PortResponse> {
        if (url.includes('test-case/flat')) {
          return resp(200, {
            content: [
              { id: 10003, lastModifiedDate: 1 },
              { id: 10004, lastModifiedDate: 1 },
            ],
            totalElements: 2,
          });
        }
        if (url.includes('/10003/overview')) {
          return resp(200, { id: 10003, projectId: 1, name: 'Кейс 10003', hasManualScenario: false });
        }
        if (url.includes('/api/tree')) return resp(200, { content: [] });
        return resp(404, {});
      }
    }
    const gw = new Gateway(cfg, new TestOpsClient(cfg, new OneBodyMissingPort()), undefined, null, (message) =>
      warnings.push(message),
    );
    const result = await listedIds(gw, [{ project: '1', rql: 'a' }]);
    expect(result).toEqual(['10003']);
    expect(warnings.join('\n')).toMatch(/10004/);
  });

  it('пустой проект назван, а документ собран из остальных', async () => {
    const warnings: string[] = [];
    const gw = gateway(emptyLog(), warnings, { 2: [10001] });
    const r = await listedIds(gw, [
      { project: '2', rql: 'a' },
      { project: '1', rql: 'b' },
    ]);
    expect(r).toEqual(['10001']);
    expect(warnings.join('\n')).toMatch(/в проекте 1 .*кейсов не найдено/);
  });

  it('провал тела у одного проекта не обрывает документ — он собран из остальных', async () => {
    class PartialBodyFailurePort implements TestOpsPort {
      async postForm(): Promise<PortResponse> {
        return resp(200, { access_token: FAKE_JWT });
      }
      async get(url: string): Promise<PortResponse> {
        if (url.includes('/project/2/test-case/flat')) {
          return resp(200, { content: [{ id: 10001, lastModifiedDate: 1 }], totalElements: 1 });
        }
        if (url.includes('/project/1/test-case/flat')) {
          return resp(200, { content: [{ id: 10003, lastModifiedDate: 1 }], totalElements: 1 });
        }
        if (url.includes('/10001/overview')) {
          return resp(200, { id: 10001, projectId: 2, name: 'Кейс 10001', hasManualScenario: false });
        }
        if (url.includes('/10003/overview')) return resp(502, {});
        if (url.includes('/api/tree')) return resp(200, { content: [] });
        return resp(404, {});
      }
    }
    const warnings: string[] = [];
    const warn = (m: string) => warnings.push(m);
    const gw = new Gateway(cfg, new TestOpsClient(cfg, new PartialBodyFailurePort(), warn), undefined, null, warn);
    const r = await listedIds(gw, [
      { project: '2', rql: 'a' },
      { project: '1', rql: 'b' },
    ]);
    expect(r).toEqual(['10001']);
    expect(warnings.some((w) => w.includes('10003') && w.includes('502'))).toBe(true);
  });

  it('когда пусто везде, звучит прежнее сообщение', async () => {
    const gw = gateway(emptyLog(), [], {});
    const out = await gw.getTestCasesList([
      { project: '2', rql: 'a' },
      { project: '1', rql: 'b' },
    ]);
    expect(out).toBe('По данному запросу кейсов не найдено.');
  });

  it('однопроектный вызов ходит в поиск ровно один раз', async () => {
    const requests: string[] = [];
    const port: TestOpsPort = {
      async postForm() {
        return resp(200, { access_token: FAKE_JWT });
      },
      async get(url: string) {
        requests.push(url);
        if (url.includes('test-case/flat')) {
          return resp(200, { content: [{ id: 10003, lastModifiedDate: 1 }], totalElements: 1 });
        }
        if (url.includes('/10003/overview')) {
          return resp(200, { id: 10003, projectId: 1, name: 'Кейс 10003', hasManualScenario: false });
        }
        if (url.includes('/api/tree')) return resp(200, { content: [] });
        return resp(404, {});
      },
    };
    const client = new TestOpsClient(cfg, port);
    const gw = new Gateway(cfg, client, undefined, null, () => {});
    const r = await listedIds(gw, [{ rql: 'tag = "Smoke"' }]);
    expect(r).toEqual(['10003']);
    const searches = requests.filter((u) => u.includes('test-case/flat'));
    expect(searches).toHaveLength(1);
    expect(searches[0]).toContain('/project/1/test-case/flat');
    expect(searches[0]).toContain('page=0');
  });
});

describe('запрос только по идентификаторам', () => {
  it('берёт кейсы из своих проектов и не ходит в поиск', async () => {
    const log = emptyLog();
    const md = await gateway(log, [], {}).getTestCasesList([{ rql: 'id in [10001, 10002, 10003]' }]);
    expect([...md.matchAll(/\(ID: (\d+)\)$/gm)].map((m) => m[1])).toEqual(['10001', '10002', '10003']);
    expect([...md.matchAll(/^- \*\*Проект:\*\* `(.*)`$/gm)].map((m) => m[1])).toEqual(['проект1', 'проект1', 'WEB']);
    expect(log.searches).toEqual([]);
  });

  it('называет ненайденный идентификатор и выгружает остальные', async () => {
    const warnings: string[] = [];
    const r = await listedIds(gateway(emptyLog(), warnings, {}), [
      { rql: 'id in [10001, 999999999]' },
    ]);
    expect(r).toEqual(['10001']);
    expect(warnings.join('\n')).toMatch(/999999999/);
  });

  it('говорит, что переданный проект не применялся', async () => {
    const warnings: string[] = [];
    await listedIds(gateway(emptyLog(), warnings, {}), [
      { project: '1', rql: 'id in [10001]' },
    ]);
    expect(warnings.join('\n')).toMatch(/--project 1 не применялся/);
  });

  it('предел режет список идентификаторов и говорит об этом', async () => {
    const warnings: string[] = [];
    const r = await listedIds(gateway(emptyLog(), warnings, {}), 
      [{ rql: 'id in [10001, 10002, 10003]' }],
      2,
    );
    expect(r).toEqual(['10001', '10002']);
    expect(warnings.join(' ')).toMatch(/предел 2: из 3 идентификаторов взяты первые 2/);
  });

  it('без --limit список идентификаторов не режется', async () => {
    const warnings: string[] = [];
    const log = emptyLog();
    const ids = Array.from({ length: 120 }, (_, i) => 10001 + i);
    await listedIds(gateway(log, warnings, {}), [{ rql: `id in [${ids.join(', ')}]` }]);
    expect(log.overviews).toHaveLength(120);
    expect(warnings.join(' ')).not.toMatch(/предел/);
  });

  it('один запрос по идентификаторам на два проекта выполняется однажды', async () => {
    const log = emptyLog();
    const warnings: string[] = [];
    const r = await listedIds(gateway(log, warnings, {}), [
      { project: '1', rql: 'id in [10001, 10003]' },
      { project: '2', rql: 'id in [10001, 10003]' },
    ]);
    expect(r).toEqual(['10001', '10003']);
    expect(log.overviews).toEqual([10001, 10003]);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(/1, 2/);
  });

  it('не выдаёт ложное предупреждение о пустом проекте для id-only источника', async () => {
    const warnings: string[] = [];
    await listedIds(gateway(emptyLog(), warnings, {}), [
      { project: '1', rql: 'id = 999999998' },
      { project: '2', rql: 'id = 999999999' },
    ]);
    expect(warnings.join('\n')).not.toMatch(/в проекте .* кейсов не найдено/);
    expect(warnings.join('\n')).toMatch(/999999998/);
    expect(warnings.join('\n')).toMatch(/999999999/);
  });

  it('кейс, упавший с ошибкой сервера, не попадает в «не найдены»', async () => {
    const warnings: string[] = [];
    class MixedIdPort implements TestOpsPort {
      async postForm(): Promise<PortResponse> {
        return resp(200, { access_token: FAKE_JWT });
      }
      async get(url: string): Promise<PortResponse> {
        if (url.includes('/10001/overview')) {
          return resp(200, { id: 10001, projectId: 2, name: 'Кейс 10001', hasManualScenario: false });
        }
        if (url.includes('/10005/overview')) return resp(502, {});
        if (url.includes('/api/tree')) return resp(200, { content: [] });
        return resp(404, {});
      }
    }
    const gw = new Gateway(
      cfg,
      new TestOpsClient(cfg, new MixedIdPort()),
      undefined,
      null,
      (m) => warnings.push(m),
    );
    const r = await listedIds(gw, [{ rql: 'id in [10001, 10005, 999999999]' }]);
    expect(r).toEqual(['10001']);
    expect(warnings.join('\n')).toMatch(/кейс 10005: получить не удалось — .*502/);
    expect(warnings.join('\n')).toMatch(/не найдены: 999999999/);
    expect(warnings.join('\n')).not.toMatch(/не найдены:.*10005/);
  });

  it('добавочное условие возвращает запрос в границы проекта', async () => {
    const log = emptyLog();
    await listedIds(gateway(log, [], { 1: [10003] }), [
      { project: '1', rql: 'id in [10001, 10003] and automation = false' },
    ]);
    expect(log.searches.map((s) => s.projectId)).toEqual([1]);
    expect(log.overviews).toEqual([]);
  });
});
