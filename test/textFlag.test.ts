import { describe, expect, it } from 'vitest';
import { parseFlags, validateFlags } from '../src/args.js';
import { sourcesOf } from '../src/querySources.js';
import type { AppConfig } from '../src/config.js';
import { Gateway } from '../src/gateway.js';
import { buildFilterLink, parseFilterLink } from '../src/links.js';
import type { RawCase, RawOverview } from '../src/model.js';
import type { TestOpsClient } from '../src/testops/client.js';
import { listedIds } from './listedCases.js';

describe('--text: разбор флага', () => {
  it('требует значение', () => {
    expect(() => parseFlags(['--text'])).toThrow(/--text.*нужно значение/);
  });

  it.each(['case', 'fields'])('на команде %s — ошибка с именем флага и команды', (cmd) => {
    const f = parseFlags(['--text', 'фраза']);
    expect(() => validateFlags(cmd, f)).toThrow(`Флаг --text у команды ${cmd} не используется.`);
  });

  it.each(['list', 'count', 'link'])('на команде %s принимается', (cmd) => {
    const f = parseFlags(['--text', 'фраза']);
    expect(() => validateFlags(cmd, f)).not.toThrow();
  });
});

describe('--text: сборка источников', () => {
  it('применяется к обеим парам «проект + запрос»', () => {
    const f = parseFlags([
      '--project',
      '2',
      '--rql',
      'A',
      '--project',
      '1',
      '--rql',
      'B',
      '--text',
      'фраза',
    ]);
    const sources = sourcesOf(f);
    expect(sources.map((s) => s.text)).toEqual(['фраза', 'фраза']);
  });

  it('без запроса — фраза остаётся единственным условием источника', () => {
    const f = parseFlags(['--project', '1', '--text', 'фраза']);
    const sources = sourcesOf(f);
    expect(sources).toEqual([{ project: '1', rql: '', text: 'фраза' }]);
  });

  it('сочетается со ссылкой: условия ссылки и фраза оба на месте', () => {
    const link = buildFilterLink('https://x.test', 1, {
      rql: 'tag = "Smoke"',
      conditions: [{ id: 'cfv.1', value: 'Раздел А', type: 'string' }],
    });
    const f = parseFlags([link, '--text', 'фраза']);
    const [source] = sourcesOf(f);
    expect(source?.rql).toBe('tag = "Smoke"');
    expect(source?.conditions).toEqual([{ id: 'cfv.1', value: 'Раздел А', type: 'string' }]);
    expect(source?.text).toBe('фраза');
  });
});

describe('link: ссылка несёт условия и фразу, разбор их возвращает', () => {
  it('печатает адрес с обоими условиями', () => {
    const cfg: AppConfig = {
      baseUrl: 'https://ts.example',
      token: 'tok',
      defaultProjectId: 1,
      projects: {},
      people: {},
      trees: {},
      profileDir: '/tmp/tt-test-profile',
    };
    const gw = new Gateway(cfg, {} as never, undefined, null, () => {});
    const url = gw.linkFor({ rql: 'tag = "Smoke"', project: '1', text: 'фраза' });
    const parsed = parseFilterLink(url);
    expect(parsed.rql).toBe('tag = "Smoke"');
    expect(parsed.conditions).toEqual([{ id: 'content', value: 'фраза', type: 'string' }]);
  });
});

const overviewOf = (id: number, projectId: number): RawOverview =>
  ({ id, projectId, name: `Кейс ${id}`, lastModifiedDate: 1 }) as RawOverview;

const rawOf = (id: number, projectId: number): RawCase =>
  ({ overview: overviewOf(id, projectId), steps: null, comments: [] }) as unknown as RawCase;

function cfgOf(): AppConfig {
  return {
    baseUrl: 'https://x.test',
    token: 'tok',
    defaultProjectId: 1,
    projects: { '1': 'WEB' },
    people: {},
    trees: {},
    profileDir: '/tmp/tt-test-profile',
  };
}

describe('пустой результат по фразе или по условиям ссылки — не ошибка', () => {
  it('пустой AQL с фразой без результата — обычное «кейсов не найдено»', async () => {
    const client = {
      searchAll: async () => ({ hits: [], total: 0 }),
      fetchTrees: async () => [],
    } as unknown as TestOpsClient;
    const gw = new Gateway(cfgOf(), client, undefined, null, () => {});
    const out = await gw.getTestCasesList([{ project: '1', rql: '', text: 'нетакойфразы' }]);
    expect(out).toBe('По данному запросу кейсов не найдено.');
  });

  it('пустой AQL с условием ссылки без результата — тот же ответ, без ошибки', async () => {
    const client = {
      searchAll: async () => ({ hits: [], total: 0 }),
      fetchTrees: async () => [],
    } as unknown as TestOpsClient;
    const gw = new Gateway(cfgOf(), client, undefined, null, () => {});
    const out = await gw.getTestCasesList([
      { project: '1', rql: '', conditions: [{ id: 'tag', value: ['Нет такого'], type: 'array' }] },
    ]);
    expect(out).toBe('По данному запросу кейсов не найдено.');
  });
});

describe('идентификаторы вместе с --text идут поиском, а не напрямую', () => {
  it('запрос из одних id и фразы обращается к searchAll, а не к overview по каждому id', async () => {
    const overviewCalls: string[] = [];
    const searchCalls: unknown[] = [];
    const client = {
      countCases: async () => 0,
      fetchOverview: async (id: string) => {
        overviewCalls.push(id);
        return overviewOf(Number(id), 1);
      },
      fetchCaseFromOverview: async (ov: RawOverview) => rawOf(Number(ov.id), 1),
      searchAll: async (query: unknown) => {
        searchCalls.push(query);
        return { hits: [{ id: 1, lastModifiedDate: 1 }], total: 1 };
      },
      fetchBatch: async (ids: number[]) => ids.map((id) => rawOf(id, 1)),
      fetchTrees: async () => [],
    } as unknown as TestOpsClient;
    const gw = new Gateway(cfgOf(), client, undefined, null, () => {});
    const r = await listedIds(gw, [{ project: '1', rql: 'id in [1, 2]', text: 'фраза' }]);
    expect(searchCalls).toHaveLength(1);
    expect(overviewCalls).toEqual([]);
    expect(r).toEqual(['1']);
  });

  it('без фразы тот же запрос идёт напрямую по идентификаторам', async () => {
    const overviewCalls: string[] = [];
    const searchCalls: unknown[] = [];
    const client = {
      countCases: async () => 0,
      fetchOverview: async (id: string) => {
        overviewCalls.push(id);
        return overviewOf(Number(id), 1);
      },
      fetchCaseFromOverview: async (ov: RawOverview) => rawOf(Number(ov.id), 1),
      searchAll: async (query: unknown) => {
        searchCalls.push(query);
        return { hits: [], total: 0 };
      },
      fetchTrees: async () => [],
    } as unknown as TestOpsClient;
    const gw = new Gateway(cfgOf(), client, undefined, null, () => {});
    const r = await listedIds(gw, [{ project: '1', rql: 'id in [1, 2]' }]);
    expect(searchCalls).toEqual([]);
    expect(overviewCalls).toEqual(['1', '2']);
    expect(r).toEqual(['1', '2']);
  });
});
