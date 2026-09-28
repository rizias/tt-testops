import { describe, expect, it } from 'vitest';
import type { Flags } from '../src/args.js';
import { catalogOutput } from '../src/catalogCommands.js';
import type { AppConfig } from '../src/config.js';
import { Gateway } from '../src/gateway.js';
import type { CustomFieldValue, TestOpsClient } from '../src/testops/client.js';

const cfg: AppConfig = {
  baseUrl: 'https://x.test',
  token: 'tok',
  defaultProjectId: 1,
  projects: {},
  people: {},
  trees: {},
  profileDir: '/tmp/tt-test-profile',
};

const LAYERS = [
  { id: -1, name: 'Unit Tests' },
  { id: -2, name: 'UI Tests' },
  { id: 1, name: 'E2E' },
];

const FIELDS = [
  { id: -2, name: 'Feature' },
  { id: 10, name: 'Поле1' },
];

const VALUES: Record<number, CustomFieldValue[]> = {
  [-2]: [{ name: 'Раздел А', testCasesCount: 1 }],
  10: [
    { name: 'Раздел А', testCasesCount: 12 },
    { name: 'Знaчение  Б (B)', testCasesCount: 42 },
  ],
};

const COUNTS: Record<string, number> = {
  'layer = "UI Tests"': 42,
  'layer = "E2E"': 13,
  'layer = "Unit Tests"': 0,
};

interface Spy {
  bodies: number;
  searches: string[];
}

function fakeClient(spy: Spy): TestOpsClient {
  return {
    fetchLayers: async () => LAYERS,
    countCases: async (query: { rql: string }) => COUNTS[query.rql] ?? 0,
    fetchCustomFields: async () => FIELDS,
    fetchFieldValues: async (_p: number, id: number) => VALUES[id] ?? [],
    fetchFieldValueCount: async (_p: number, id: number) => (VALUES[id] ?? []).length,
    searchFieldValues: async (_p: number, id: number, query: string) =>
      (VALUES[id] ?? []).filter((v) => v.name.toLowerCase().includes(query.toLowerCase())),
    searchAll: async (query: { rql: string }) => {
      spy.searches.push(query.rql);
      return { hits: [], total: 0 };
    },
    fetchBatch: async (ids: Array<string | number>) => {
      spy.bodies += ids.length;
      return [];
    },
  } as unknown as TestOpsClient;
}

const spy = (): Spy => ({ bodies: 0, searches: [] });

function gateway(s: Spy, notes: string[] = []): Gateway {
  return new Gateway(cfg, fakeClient(s), undefined, null, (m) => notes.push(m));
}

const flags = (extra: Partial<Flags> = {}): Flags => ({
  _: [],
  projects: [],
  queries: [],
  used: [],
  ...extra,
});

describe('число кейсов по запросу', () => {
  it('печатает число и не скачивает кейсы', async () => {
    const s = spy();
    const found = await gateway(s).countSources([{ rql: 'layer = "E2E"' }]);
    expect(found).toEqual([{ project: 1, count: 13 }]);
    expect(s.bodies).toBe(0);
  });

  it('в командной строке остаётся одно число', async () => {
    const s = spy();
    const gw = gateway(s);
    const out = await catalogOutput('count', gw, flags(), () =>
      gw.countSources([{ rql: 'layer = "UI Tests"' }]),
    );
    expect(out).toBe('42');
  });

  it('по паре на каждый проект', async () => {
    const s = spy();
    const gw = gateway(s);
    const out = await catalogOutput('count', gw, flags(), () =>
      gw.countSources([{ rql: 'layer = "E2E"' }, { rql: 'layer = "UI Tests"' }]),
    );
    expect(out).toBe('1\t13\n1\t42');
  });
});

describe('справочник проекта', () => {
  it('обзор даёт поля с числом значений и слои с числом кейсов', async () => {
    const overview = await gateway(spy()).overview();
    expect(overview.fields).toEqual([
      { name: 'Поле1', values: 2 },
      { name: 'Feature', values: 1 },
    ]);
    expect(overview.layers).toEqual([
      { name: 'UI Tests', testCasesCount: 42 },
      { name: 'E2E', testCasesCount: 13 },
      { name: 'Unit Tests', testCasesCount: 0 },
    ]);
  });

  it('обзор не печатает значения полей', async () => {
    const s = spy();
    const gw = gateway(s);
    const out = await catalogOutput('fields', gw, flags(), () => gw.countSources([]));
    expect(out).toContain('cf["Поле1"]');
    expect(out).toContain('layer = "UI Tests"');
    expect(out).not.toContain('Раздел А');
  });

  it('значения слоя запрашиваются как у поля', async () => {
    const values = await gateway(spy()).fieldValues('layer');
    expect(values).toEqual([
      { name: 'UI Tests', testCasesCount: 42 },
      { name: 'E2E', testCasesCount: 13 },
      { name: 'Unit Tests', testCasesCount: 0 },
    ]);
  });
});

describe('где встречается слово', () => {
  it('называет поля и значения готовыми условиями', async () => {
    const found = await gateway(spy()).findValues('раздел');
    expect(found).toEqual([
      { condition: 'cf["Поле1"] = "Раздел А"', cases: 12 },
      { condition: 'cf["Feature"] = "Раздел А"', cases: 1 },
    ]);
  });

  it('находит слой по его названию', async () => {
    const found = await gateway(spy()).findValues('e2e');
    expect(found).toEqual([{ condition: 'layer = "E2E"', cases: 13 }]);
  });

  it('латинская буква внутри кириллического слова находится второй попыткой', async () => {
    const found = await gateway(spy()).findValues('Значение Б (B)');
    expect(found).toEqual([{ condition: 'cf["Поле1"] = "Знaчение  Б (B)"', cases: 42 }]);
  });

  it('ничего не нашлось — так и сказано', async () => {
    const s = spy();
    const gw = gateway(s);
    const out = await catalogOutput('fields', gw, flags({ find: 'дирижабли' }), () =>
      gw.countSources([]),
    );
    expect(out).toMatch(/«дирижабли» не встречается/);
  });
});

describe('пустой результат по слою', () => {
  it('несуществующий слой — ошибка со списком доступных', async () => {
    await expect(
      gateway(spy()).getTestCasesList([{ rql: 'layer = "юниты"' }]),
    ).rejects.toThrowError(/слоя «юниты» на сервере нет[\s\S]*Unit Tests/);
  });

  it('слой существует и пуст — это пустой результат', async () => {
    const s = spy();
    await expect(gateway(s).getTestCasesList([{ rql: 'layer = "Unit Tests"' }])).resolves.toContain(
      'кейсов не найдено',
    );
    expect(s.searches).toEqual(['layer = "Unit Tests"']);
  });
});

describe('отказы справочника и подсчёта', () => {
  it('пустой --find отвергается', async () => {
    const s = spy();
    const gw = gateway(s);
    await expect(
      catalogOutput('fields', gw, flags({ find: '  ' }), () => gw.countSources([])),
    ).rejects.toThrowError(/--find нужно слово/);
  });

  it('count по идентификаторам отказывается считать', async () => {
    const s = spy();
    await expect(gateway(s).countSources([{ rql: 'id in [1, 2]' }])).rejects.toThrowError(
      /count по идентификаторам/,
    );
  });
});
