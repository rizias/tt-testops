import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CaseCache } from '../src/cache.js';
import type { AppConfig } from '../src/config.js';
import { Gateway } from '../src/gateway.js';
import { groupByPath, type HtmlCase } from '../src/html.js';
import type { RawCase, RawOverview, TestCase } from '../src/model.js';
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

describe('проект в структурном выводе', () => {
  it('называет проект именем из карты', async () => {
    const r = await gateway(emptyLog(), [], { 85: [10001] }).searchCasesJson([
      { project: '85', rql: 'a' },
    ]);
    expect(r.cases[0]?.project).toEqual({ id: 85, name: 'проект1' });
  });

  it('проект вне карты остаётся без имени, но с номером', async () => {
    const local: AppConfig = { ...cfg, projects: {} };
    const gw = new Gateway(local, fakeClient({ 85: [10001] }, emptyLog()), undefined, null);
    const r = await gw.searchCasesJson([{ project: '85', rql: 'a' }]);
    expect(r.cases[0]?.project).toEqual({ id: 85, name: null });
  });
});

const htmlCase = (id: string, projectId: number | null, path: string[]): HtmlCase => ({
  tc: {
    id,
    name: `Кейс ${id}`,
    projectId,
    path,
    status: 'Active',
    automated: false,
    layer: 'Web',
    tags: [],
    links: [],
    linkRefs: [],
    issues: [],
    people: [],
    relatedCases: [],
    attributes: [],
    isLegacy: false,
    declaredManual: false,
    description: '',
    precondition: '',
    expectedResult: '',
    scenarioSource: 'newSteps',
    scenarioLines: [],
    comments: [],
  } as TestCase,
  state: 'current',
});

describe('дерево HTML', () => {
  const names = { '14': 'WEB', '85': 'проект1' };

  it('при двух проектах верхний уровень — проект', () => {
    const tree = groupByPath(
      [htmlCase('1', 85, ['Авторизация']), htmlCase('2', 14, ['Авторизация'])],
      names,
    );
    expect(tree.children.map((c) => c.name)).toEqual(['проект1', 'WEB']);
  });

  it('одноимённые разделы разных проектов остаются разными ветками', () => {
    const tree = groupByPath(
      [htmlCase('1', 85, ['Авторизация']), htmlCase('2', 14, ['Авторизация'])],
      names,
    );
    for (const project of tree.children) {
      expect(project.children.map((c) => c.name)).toEqual(['Авторизация']);
      expect(project.count).toBe(1);
    }
  });

  it('проекты с одинаковой подписью остаются разными ветками', () => {
    const sameNames = { '14': 'Одинаковое имя', '85': 'Одинаковое имя' };
    const tree = groupByPath([htmlCase('1', 85, ['А']), htmlCase('2', 14, ['Б'])], sameNames);
    expect(tree.children).toHaveLength(2);
    expect(tree.children.map((project) => project.name)).toEqual([
      'Одинаковое имя',
      'Одинаковое имя',
    ]);
    expect(tree.children.map((project) => project.count)).toEqual([1, 1]);
  });

  it('при одном проекте уровня проекта нет', () => {
    const tree = groupByPath(
      [htmlCase('1', 14, ['Авторизация']), htmlCase('2', 14, ['Авторизация', 'Вход'])],
      names,
    );
    expect(tree.children.map((c) => c.name)).toEqual(['Авторизация']);
  });

  it('проект вне карты назван номером', () => {
    const tree = groupByPath([htmlCase('1', 777, ['А']), htmlCase('2', 14, ['Б'])], names);
    expect(tree.children.map((c) => c.name)).toEqual(['Проект 777', 'WEB']);
  });

  it('кейс без раздела не теряется под своим проектом', () => {
    const tree = groupByPath([htmlCase('1', 85, []), htmlCase('2', 14, ['Б'])], names);
    const shared = tree.children.find((c) => c.name === 'проект1');
    expect(shared?.children.map((c) => c.name)).toEqual(['Без раздела']);
  });
});

describe('хранилище при нескольких источниках', () => {
  let dir: string;
  let cache: CaseCache;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'tt-multi-'));
    cache = new CaseCache(dir);
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  const withCache = (log: Log, byProject: Record<number, number[]>, refresh = false) =>
    new Gateway(cfg, fakeClient(byProject, log), undefined, cache, refresh, () => {});

  it('повторная выгрузка по двум проектам не идёт в сеть за неизменившимися кейсами', async () => {
    const byProject = { 85: [10001], 14: [10003] };
    const sources = [
      { project: '85', rql: 'a' },
      { project: '14', rql: 'b' },
    ];
    const first = emptyLog();
    await withCache(first, byProject).searchCasesJson(sources);
    const second = emptyLog();
    await withCache(second, byProject).searchCasesJson(sources);
    expect(first.searches).toHaveLength(2);
    expect(second.searches).toHaveLength(2);
    expect(second.bodies).toEqual([]);
  });

  it('запрос по идентификаторам берёт шапку всегда, а тело — только при новой дате', async () => {
    const first = emptyLog();
    await withCache(first, {}).searchCasesJson([{ rql: 'id in [10001, 10003]' }]);
    expect(first.overviews).toEqual([10001, 10003]);
    expect(first.bodies).toEqual([10001, 10003]);

    const second = emptyLog();
    await withCache(second, {}).searchCasesJson([{ rql: 'id in [10001, 10003]' }]);
    expect(second.overviews).toEqual([10001, 10003]);
    expect(second.bodies).toEqual([]);
  });

  it('принудительное обновление перечитывает тело и при совпавшей дате', async () => {
    await withCache(emptyLog(), {}).searchCasesJson([{ rql: 'id in [10001]' }]);
    const again = emptyLog();
    await withCache(again, {}, true).searchCasesJson([{ rql: 'id in [10001]' }]);
    expect(again.bodies).toEqual([10001]);
  });
});
