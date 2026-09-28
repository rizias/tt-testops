import { describe, expect, it } from 'vitest';
import { parseFlags } from '../src/args.js';
import type { AppConfig } from '../src/config.js';
import { UrlTooLongError } from '../src/errors.js';
import { filterLines } from '../src/filterRows.js';
import { Gateway } from '../src/gateway.js';
import { handleList } from '../src/listCommand.js';
import type { RawCase } from '../src/model.js';
import { sourcesOf } from '../src/querySources.js';
import { TestOpsClient, type SearchQuery } from '../src/testops/client.js';
import { listedIds, listedTitles } from './listedCases.js';

const cfg: AppConfig = {
  baseUrl: 'https://x.test',
  token: 'tok',
  defaultProjectId: 5,
  projects: { '5': 'WEB', '6': 'Mobile' },
  people: {},
  trees: { '5': 'none', '6': 'none' },
  profileDir: '/tmp/tt-test-profile',
};

const raw = (id: number, project: number, name: string): RawCase =>
  ({
    overview: { id, projectId: project, name, lastModifiedDate: 1 },
    steps: null,
    runScenario: { steps: [] },
    comments: [],
  }) as unknown as RawCase;

function client(byProject: Record<number, RawCase[]>, tooLong = false): TestOpsClient {
  const all = Object.values(byProject).flat();
  return {
    searchAll: async (_q: SearchQuery, project: number) => ({
      hits: (byProject[project] ?? []).map((r) => ({ id: Number(r.overview.id), lastModifiedDate: 1 })),
      total: (byProject[project] ?? []).length,
    }),
    fetchBatch: async (ids: number[]) => all.filter((r) => ids.includes(Number(r.overview.id))),
    fetchOverview: async (id: string) => all.find((r) => String(r.overview.id) === id)?.overview ?? null,
    fetchCaseFromOverview: async (ov: { id: number }) => all.find((r) => r.overview.id === ov.id),
    countCases: async () => {
      if (tooLong) throw new UrlTooLongError();
      return 0;
    },
    fetchTrees: async () => [],
    fetchCustomFields: async () => [{ id: 10, name: 'Раздел' }],
  } as unknown as TestOpsClient;
}

const gatewayOf = (c: TestOpsClient) => new Gateway(cfg, c, undefined, null, () => {});

describe('блок «Фильтр» в HTML', () => {
  it('по строке на каждую пару: проект, число кейсов, условия и ссылка', async () => {
    const c = client({ 5: [raw(1, 5, 'А'), raw(2, 5, 'Б')], 6: [raw(3, 6, 'В')] });
    const f = parseFlags(['--project', '5', '--rql', 'tag = "a"', '--project', '6', '--rql', 'tag = "b"']);
    const html = await gatewayOf(c).getTestCasesHtml(sourcesOf(f));
    expect((html.match(/<div class="filterRow">/g) ?? []).length).toBe(2);
    expect(html).toContain('<div class="filterProject">WEB · 2</div>');
    expect(html).toContain('<div class="filterProject">Mobile · 1</div>');
    expect(html).toContain('<span class="filterPart">AQL: tag = &quot;a&quot;</span>');
    expect(html).toContain('href="https://x.test/project/6/test-cases?search=');
    expect(html).toContain('Открыть в TestOps ↗');
  });

  it('условия ссылки TestOps названы по подписям, поле — по имени', async () => {
    const tag = { id: 'tag', value: [11], label: ['<тег>'], type: 'longArray' };
    const field = { id: 'cfv.10', value: [21], label: ['<Значение>'], type: 'longArray' };
    const c = client({ 5: [raw(1, 5, 'А'), raw(2, 5, 'Б')] });
    const html = await gatewayOf(c).getTestCasesHtml([{ rql: '', project: '5', conditions: [tag, field] }]);
    expect(html).toContain('<span class="filterPart">Теги: &lt;тег&gt;</span>');
    expect(html).toContain('<span class="filterPart">Раздел: &lt;Значение&gt;</span>');
  });

  it('номера кейсов из двух проектов — по строке на проект с условием id in', async () => {
    const c = client({ 5: [raw(1, 5, 'А')], 6: [raw(3, 6, 'В')] });
    const g = gatewayOf(c);
    await g.getTestCasesList([{ rql: 'id in [1, 3]' }]);
    expect(g.filterRows().map((r) => ({ project: r.project, url: r.url, parts: r.parts }))).toEqual([
      { project: 5, url: 'https://x.test/project/5/test-cases?search=W3siaWQiOiJhcWwiLCJ2YWx1ZSI6ImlkIGluIFsxXSIsInR5cGUiOiJzdHJpbmcifV0%3D', parts: ['AQL: id in [1]'] },
      { project: 6, url: 'https://x.test/project/6/test-cases?search=W3siaWQiOiJhcWwiLCJ2YWx1ZSI6ImlkIGluIFszXSIsInR5cGUiOiJzdHJpbmcifV0%3D', parts: ['AQL: id in [3]'] },
    ]);
  });

  it('номера кейсов в блоке «Фильтр» показаны запросом AQL, как в TestOps', async () => {
    const c = client({ 5: [raw(1, 5, 'А'), raw(2, 5, 'Б')] });
    const html = await gatewayOf(c).getTestCasesHtml([{ rql: 'id in [1, 2]' }]);
    expect(html).toContain('<span class="filterPart">AQL: id in [1, 2]</span>');
  });

  it('слишком длинный адрес — надпись вместо кнопки и строка без адреса в служебном выводе', async () => {
    const c = client({ 5: [raw(1, 5, 'А'), raw(2, 5, 'Б')] }, true);
    const g = gatewayOf(c);
    const html = await g.getTestCasesHtml([{ rql: 'id in [1, 2]' }]);
    expect(html).toContain('<span class="filterMiss">Ссылку не составить: адрес длиннее, чем принимает сервер TestOps</span>');
    expect(filterLines(g.filterRows())).toEqual([
      'Фильтр в TestOps (WEB): ссылку не составить: адрес длиннее, чем принимает сервер TestOps',
    ]);
  });
});

describe('ссылка после выгрузки в служебном выводе', () => {
  it('list печатает строку «Фильтр в TestOps (<проект>): <адрес>» на каждый проект', async () => {
    const c = client({ 5: [raw(1, 5, 'А')], 6: [raw(3, 6, 'В')] });
    const written: string[] = [];
    const write = process.stderr.write.bind(process.stderr);
    process.stderr.write = ((chunk: string) => {
      written.push(String(chunk));
      return true;
    }) as typeof process.stderr.write;
    try {
      await handleList(gatewayOf(c), parseFlags(['--project', '5', '--rql', 'tag = "a"', '--project', '6', '--rql', 'tag = "b"']));
    } finally {
      process.stderr.write = write;
    }
    const lines = written.join('').split('\n').filter((l) => l.startsWith('Фильтр в TestOps'));
    expect(lines).toHaveLength(2);
    expect(lines[0]?.startsWith('Фильтр в TestOps (WEB): https://x.test/project/5/test-cases?search=')).toBe(true);
    expect(lines[1]?.startsWith('Фильтр в TestOps (Mobile): https://x.test/project/6/test-cases?search=')).toBe(true);
  });
});

describe('порядок кейсов, взятых по номерам', () => {
  it('по названию от А до Я, как найденные поиском', async () => {
    const c = client({ 5: [raw(1, 5, 'Вход'), raw(2, 5, 'Авторизация'), raw(3, 5, 'Бронь')] });
    const titles = await listedTitles(gatewayOf(c), [{ rql: 'id in [1, 2, 3]' }]);
    expect(titles).toEqual(['Авторизация', 'Бронь', 'Вход']);
  });
});

describe('строки блока «Фильтр» считают свои кейсы', () => {
  it('две пары в одном проекте — у каждой своё число кейсов', async () => {
    const byQuery: Record<string, RawCase[]> = {
      'tag = "a"': [raw(1, 5, 'А'), raw(2, 5, 'Б')],
      'tag = "b"': [raw(3, 5, 'В')],
    };
    const all = Object.values(byQuery).flat();
    const c = {
      searchAll: async (q: SearchQuery) => ({
        hits: (byQuery[q.rql] ?? []).map((r) => ({ id: Number(r.overview.id), lastModifiedDate: 1 })),
        total: (byQuery[q.rql] ?? []).length,
      }),
      fetchBatch: async (ids: number[]) => all.filter((r) => ids.includes(Number(r.overview.id))),
      fetchTrees: async () => [],
    } as unknown as TestOpsClient;
    const json = await gatewayOf(c).getTestCasesHtml([
      { rql: 'tag = "a"', project: '5' },
      { rql: 'tag = "b"', project: '5' },
    ]);
    expect(json).toContain('<div class="filterProject">WEB · 2</div>');
    expect(json).toContain('<div class="filterProject">WEB · 1</div>');
  });

  it('сбой проверки длины ссылки не обрывает выгрузку: ссылка есть, предупреждение названо', async () => {
    const c = client({ 5: [raw(1, 5, 'А'), raw(2, 5, 'Б')] });
    (c as unknown as { countCases: () => Promise<number> }).countCases = async () => {
      throw new Error('HTTP 503');
    };
    const notes: string[] = [];
    const g = new Gateway(cfg, c, undefined, null, (m) => notes.push(m));
    const ids = await listedIds(g, [{ rql: 'id in [1, 2]' }]);
    expect(ids).toHaveLength(2);
    expect(g.filterRows()[0]?.url?.startsWith('https://x.test/project/5/test-cases?search=')).toBe(true);
    expect(notes.join(' ')).toContain('длину ссылки на фильтр проекта 5 проверить не удалось — HTTP 503');
  });
});
