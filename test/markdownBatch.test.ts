import { describe, expect, it } from 'vitest';
import type { AppConfig } from '../src/config.js';
import { Gateway } from '../src/gateway.js';
import { type EmbeddedAssets, type HtmlCase, renderBatchHtml } from '../src/html.js';
import { toJson } from '../src/json.js';
import type { RawCase, RawOverview, TestCase } from '../src/model.js';
import { defaultProfile } from '../src/profile.js';
import type { TestOpsClient } from '../src/testops/client.js';
import type { ProjectTree } from '../src/tree.js';

const cfg: AppConfig = {
  baseUrl: 'https://ts.example',
  token: 'tok',
  defaultProjectId: 14,
  projects: { '14': 'WEB' },
  people: {},
  trees: {},
  timeoutMs: 30000,
  maxCases: 100,
  pageSize: 20,
  sort: 'id,DESC',
} as unknown as AppConfig;

const TREE: ProjectTree = {
  id: 41,
  name: 'Разделы',
  fields: [
    { id: 1, name: 'Уровень 1' },
    { id: 2, name: 'Уровень 2' },
  ],
};

const overview = (id: number): RawOverview =>
  ({
    id,
    projectId: 14,
    name: `Кейс ${id}`,
    lastModifiedDate: 1,
    customFields: [
      { name: 'Раздел А', customField: { id: 1 } },
      { name: 'Раздел Б', customField: { id: 2 } },
    ],
  }) as unknown as RawOverview;

const raw = (id: number): RawCase =>
  ({ overview: overview(id), steps: null, comments: [] }) as unknown as RawCase;

function client(): TestOpsClient {
  return {
    searchAll: async () => ({
      hits: [
        { id: 1, lastModifiedDate: 1 },
        { id: 2, lastModifiedDate: 1 },
      ],
      total: 2,
    }),
    fetchBatch: async (ids: number[]) => ids.map(raw),
    fetchTrees: async () => [TREE],
    fetchCustomFields: async () => [],
  } as unknown as TestOpsClient;
}

const assets: EmbeddedAssets = new Map();

const caseOf = (over: Partial<TestCase> = {}): HtmlCase => ({
  tc: {
    id: '10001',
    name: 'Кейс',
    projectId: 14,
    path: [],
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
    scenarioLines: ['1. Шаг'],
    comments: [],
    ...over,
  } as TestCase,
  state: 'current',
});

describe('пометки в одиночном Markdown', () => {
  const withTestRail = {
    overview: {
      id: 1,
      projectId: 14,
      name: 'Кейс',
      hasManualScenario: false,
      scenario: { steps: [{ name: 'Шаг' }] },
      links: [{ name: 'TestRail', url: 'https://testrail.example/case/1' }],
    },
    steps: null,
    comments: [],
  } as unknown as RawCase;

  const client = {
    fetchOverview: async () => withTestRail.overview,
    fetchCaseFromOverview: async () => withTestRail,
    fetchTrees: async () => [],
  } as unknown as TestOpsClient;

  it('ссылка на постороннюю систему выведена ссылкой, без пометки', async () => {
    const gw = new Gateway(cfg, client, undefined, null, false, () => {});
    const out = await gw.getTestCase('1');
    expect(out).toContain('- **Ссылки:** [TestRail](https://testrail.example/case/1)');
    expect(out).not.toContain('Ссылка на TestRail');
  });

  it('с выключенными пометками её нет', async () => {
    const gw = new Gateway(
      cfg,
      client,
      { ...defaultProfile, showMarks: false },
      null,
      false,
      () => {},
    );
    const out = await gw.getTestCase('1');
    expect(out).not.toContain('⚠️');
  });
});

describe('пометки выключены', () => {
  it('состояния сценария в структурном выводе нет', () => {
    const tc = {
      id: '1',
      name: 'Кейс',
      projectId: 14,
      path: [],
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
      description: '',
      precondition: '',
      expectedResult: '',
      scenarioSource: 'newSteps',
      scenarioLines: [],
      comments: [],
    } as never;
    expect(
      toJson(tc, 'current', 'WEB', { ...defaultProfile, showMarks: false }),
    ).not.toHaveProperty('scenarioState');
    expect(toJson(tc, 'current', 'WEB', defaultProfile)).toHaveProperty('scenarioState', 'current');
  });
});

describe('путь кейса в пакетном Markdown', () => {
  it('берётся из рабочего дерева, а не пропадает', async () => {
    const gw = new Gateway(cfg, client(), undefined, null, false, () => {});
    const out = await gw.getTestCasesList([{ project: '14', rql: 'automation = false' }]);
    expect(out).toContain('- **Путь:** `Раздел А` → `Раздел Б`');
  });
});

describe('сводка над списком', () => {
  it('с выключенными пометками её нет', () => {
    const html = renderBatchHtml(
      [caseOf(), caseOf({ id: '10002' })],
      { ...defaultProfile, showMarks: false },
      assets,
      '',
    );
    expect(html).not.toContain('class="summary"');
  });

  it('с включёнными — есть', () => {
    const html = renderBatchHtml([caseOf(), caseOf({ id: '10002' })], defaultProfile, assets, '');
    expect(html).toContain('class="summary"');
  });
});

describe('кейс по идентификатору', () => {
  it('берётся из хранилища, когда дата не менялась', async () => {
    let bodies = 0;
    const overview = {
      id: 1,
      projectId: 14,
      name: 'Кейс',
      lastModifiedDate: 7,
    } as unknown as RawOverview;
    const client = {
      fetchOverview: async () => overview,
      fetchCaseFromOverview: async () => {
        bodies++;
        return { overview, steps: null, comments: [] } as unknown as RawCase;
      },
      fetchTrees: async () => [],
    } as unknown as TestOpsClient;

    const store = new (await import('../src/cache.js')).CaseCache(
      (await import('node:fs')).mkdtempSync(
        (await import('node:path')).join((await import('node:os')).tmpdir(), 'tt-one-'),
      ),
    );
    const gw = new Gateway(cfg, client, undefined, store, false, () => {});
    await gw.getTestCase('1');
    await gw.getTestCase('1');
    expect(bodies).toBe(1);
  });
});

describe('сводка пачки для кейса без проекта', () => {
  it('обходится без ссылки, а не строит адрес с дыркой', async () => {
    const { renderBatchResolved } = await import('../src/contentResolver.js');
    const out = await renderBatchResolved(
      [
        {
          overview: { id: 10001, name: 'Кейс', hasManualScenario: false, scenario: { steps: [] } },
          steps: null,
          comments: [],
        } as unknown as RawCase,
      ],
      defaultProfile,
      { fetchAttachment: async () => '', baseUrl: 'https://ts.example' },
    );
    expect(out).not.toContain('/project//');
  });
});
