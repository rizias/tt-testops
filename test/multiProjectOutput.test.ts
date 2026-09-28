import { describe, expect, it } from 'vitest';
import type { AppConfig } from '../src/config.js';
import { Gateway } from '../src/gateway.js';
import { groupByPath, type HtmlCase } from '../src/html.js';
import type { RawCase, RawOverview, TestCase } from '../src/model.js';
import type { TestOpsClient } from '../src/testops/client.js';
import { stepsOf } from './scenarioFixtures.js';
import { listedIds } from './listedCases.js';

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
  ({ overview: overviewOf(id), steps: null, runScenario: { steps: [] }, comments: [] }) as unknown as RawCase;

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
    fetchBatch: async (ids: number[]) => {
      log.bodies.push(...ids);
      return ids.map(rawOf);
    },
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

describe('проект в Markdown', () => {
  it('называет проект именем из карты', async () => {
    const md = await gateway(emptyLog(), [], { 2: [10001] }).getTestCasesList([
      { project: '2', rql: 'a' },
    ]);
    expect(md).toContain('- **Проект:** `проект1`');
  });

  it('проект вне карты остаётся без имени, но с номером', async () => {
    const local: AppConfig = { ...cfg, projects: {} };
    const gw = new Gateway(local, fakeClient({ 2: [10001] }, emptyLog()), undefined, null);
    const md = await gw.getTestCasesList([{ project: '2', rql: 'a' }]);
    expect(md).toContain('- **Проект:** `2`');
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
    attachments: [],
    linkRefs: [],
    issues: [],
    people: [],
    relatedCases: [],
    attributes: [],
    isLegacy: false,
    description: '',
    precondition: '',
    expectedResult: '',
    scenarioSource: 'newSteps',
    scenario: stepsOf(),
    scenarioLines: [],
    comments: [],
  } as TestCase,
  state: 'current',
});

describe('дерево HTML', () => {
  const names = { '1': 'WEB', '2': 'проект1' };

  it('при двух проектах верхний уровень — проект', () => {
    const tree = groupByPath(
      [htmlCase('1', 2, ['Авторизация']), htmlCase('2', 1, ['Авторизация'])],
      names,
    );
    expect(tree.children.map((c) => c.name)).toEqual(['проект1', 'WEB']);
  });

  it('одноимённые разделы разных проектов остаются разными ветками', () => {
    const tree = groupByPath(
      [htmlCase('1', 2, ['Авторизация']), htmlCase('2', 1, ['Авторизация'])],
      names,
    );
    for (const project of tree.children) {
      expect(project.children.map((c) => c.name)).toEqual(['Авторизация']);
      expect(project.count).toBe(1);
    }
  });

  it('проекты с одинаковой подписью остаются разными ветками', () => {
    const sameNames = { '1': 'Одинаковое имя', '2': 'Одинаковое имя' };
    const tree = groupByPath([htmlCase('1', 2, ['А']), htmlCase('2', 1, ['Б'])], sameNames);
    expect(tree.children).toHaveLength(2);
    expect(tree.children.map((project) => project.name)).toEqual([
      'Одинаковое имя',
      'Одинаковое имя',
    ]);
    expect(tree.children.map((project) => project.count)).toEqual([1, 1]);
  });

  it('при одном проекте уровня проекта нет', () => {
    const tree = groupByPath(
      [htmlCase('1', 1, ['Авторизация']), htmlCase('2', 1, ['Авторизация', 'Вход'])],
      names,
    );
    expect(tree.children.map((c) => c.name)).toEqual(['Авторизация']);
  });

  it('проект вне карты назван номером', () => {
    const tree = groupByPath([htmlCase('1', 777, ['А']), htmlCase('2', 1, ['Б'])], names);
    expect(tree.children.map((c) => c.name)).toEqual(['Проект 777', 'WEB']);
  });

  it('кейс без раздела не теряется под своим проектом', () => {
    const tree = groupByPath([htmlCase('1', 2, []), htmlCase('2', 1, ['Б'])], names);
    const shared = tree.children.find((c) => c.name === 'проект1');
    expect(shared?.children.map((c) => c.name)).toEqual(['Без раздела']);
  });
});

describe('данные кейса запрашиваются у сервера при каждой выгрузке', () => {
  it('повторная выгрузка по двум проектам снова получает тела кейсов', async () => {
    const byProject = { 2: [10001], 1: [10003] };
    const sources = [
      { project: '2', rql: 'a' },
      { project: '1', rql: 'b' },
    ];
    const first = emptyLog();
    await listedIds(gateway(first, [], byProject), sources);
    const second = emptyLog();
    await listedIds(gateway(second, [], byProject), sources);
    expect(first.searches).toHaveLength(2);
    expect(second.searches).toHaveLength(2);
    expect(second.bodies.sort()).toEqual([10001, 10003]);
  });

  it('запрос по идентификаторам всегда получает и шапку, и тело', async () => {
    const first = emptyLog();
    await listedIds(gateway(first, [], {}), [{ rql: 'id in [10001, 10003]' }]);
    expect(first.overviews).toEqual([10001, 10003]);
    expect(first.bodies).toEqual([10001, 10003]);

    const second = emptyLog();
    await listedIds(gateway(second, [], {}), [{ rql: 'id in [10001, 10003]' }]);
    expect(second.overviews).toEqual([10001, 10003]);
    expect(second.bodies).toEqual([10001, 10003]);
  });
});
