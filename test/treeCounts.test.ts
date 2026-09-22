import { describe, expect, it } from 'vitest';
import { type EmbeddedAssets, groupByPath, type HtmlCase, renderBatchHtml } from '../src/html.js';
import type { RawLink, TestCase } from '../src/model.js';
import { normalizeCase } from '../src/normalize.js';
import { defaultProfile } from '../src/profile.js';

const assets: EmbeddedAssets = new Map();

const caseOf = (id: string, automated: boolean, path: string[], status = 'Active'): HtmlCase => ({
  tc: {
    id,
    name: `Кейс ${id}`,
    projectId: 14,
    path,
    status,
    automated,
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
  } as TestCase,
  state: 'current',
});

describe('сколько автоматизировано в разделе', () => {
  it('считает свои и вложенные кейсы', () => {
    const tree = groupByPath([
      caseOf('1', true, ['Клиенты']),
      caseOf('2', false, ['Клиенты']),
      caseOf('3', true, ['Клиенты', 'Сделки']),
    ]);
    const clients = tree.children[0];

    expect(clients?.count).toBe(3);
    expect(clients?.automated).toBe(2);
    expect(clients?.manual).toBe(1);
    expect(clients?.children[0]?.automated).toBe(1);
    expect(clients?.children[0]?.manual).toBe(0);
  });

  it('ноль не показывается', () => {
    const html = renderBatchHtml(
      [caseOf('1', true, ['Клиенты']), caseOf('2', true, ['Клиенты'])],
      defaultProfile,
      assets,
    );
    expect(html).toContain('type_auto');
    expect(html).not.toContain('tally type_manual');
  });

  it('оба значка с числами при смешанном разделе', () => {
    const html = renderBatchHtml(
      [caseOf('1', true, ['Клиенты']), caseOf('2', false, ['Клиенты'])],
      defaultProfile,
      assets,
    );
    expect(html).toContain('tally type_auto');
    expect(html).toContain('tally type_manual');
  });
});

const rawWith = (links: RawLink[]) =>
  ({
    overview: { id: 1, name: 'Кейс', hasManualScenario: false, links },
    steps: null,
    comments: [],
  }) as never;

describe('адрес ссылки не теряется', () => {
  it('название и адрес доходят до кейса', () => {
    const tc = normalizeCase(
      rawWith([{ name: 'Задача', url: 'https://example.test/browse/A-1' }]),
      defaultProfile,
    );
    expect(tc.linkRefs).toEqual([{ name: 'Задача', url: 'https://example.test/browse/A-1' }]);
  });

  it('без названия названием служит адрес', () => {
    const tc = normalizeCase(
      rawWith([{ name: null, url: 'https://example.test/browse/A-2' }]),
      defaultProfile,
    );
    expect(tc.linkRefs[0]).toEqual({
      name: 'https://example.test/browse/A-2',
      url: 'https://example.test/browse/A-2',
    });
  });

  it('ссылка показывается кликабельной', () => {
    const one = caseOf('1', false, ['Клиенты']);
    one.tc.linkRefs = [{ name: 'https://example.test/x', url: 'https://example.test/x' }];
    const html = renderBatchHtml([one, caseOf('2', false, ['Клиенты'])], defaultProfile, assets);
    expect(html).toContain('<a href="https://example.test/x"');
  });
});

describe('состояние кейса в строке', () => {
  it('выведенный из работы отличим от рабочего', () => {
    const html = renderBatchHtml(
      [caseOf('1', false, ['Клиенты'], 'Inactive'), caseOf('2', false, ['Клиенты'], 'Active')],
      defaultProfile,
      assets,
    );
    expect(html).toContain('tag_retired');
    expect(html).toContain('Inactive');
    expect(html).toContain('Active');
  });
});

describe('отметка текущего раздела', () => {
  const page = renderBatchHtml(
    [caseOf('1', true, ['Клиенты', 'Сделки']), caseOf('2', false, ['Клиенты', 'Фиксации'])],
    defaultProfile,
    assets,
  );

  it('слежение идёт наблюдателем пересечений, а не обработчиком прокрутки', () => {
    expect(page).toContain('IntersectionObserver');
    expect(page).not.toContain("addEventListener('scroll'");
  });

  it('отмечается строка оглавления, а переход её не закрывает', () => {
    expect(page).toContain('tocRow_here');
    expect(page).toContain('updateHere');
  });

  it('выбирается самый глубокий миновавший раздел', () => {
    expect(page).toContain('data-depth');
    expect(page).toContain('bestDepth');
  });
});

describe('вид двумя колонками и уровни оглавления', () => {
  const page = renderBatchHtml(
    [caseOf('1', true, ['Клиенты', 'Сделки']), caseOf('2', false, ['Клиенты', 'Фиксации'])],
    defaultProfile,
    assets,
    'https://testops.test',
  );

  it('в панели есть переключатель вида, и выбор запоминается', () => {
    expect(page).toContain('data-act="view"');
    expect(page).toContain("localStorage.setItem('tt-view'");
  });

  it('оглавление перечисляет только разделы', () => {
    expect(page).not.toContain('data-case-target=');
    expect((page.match(/data-section-target="section-/g) ?? []).length).toBe(3);
  });

  it('у кейса есть якорь для перехода', () => {
    expect(page).toContain('<details class="case" id="case-1"');
  });

  it('уровни оглавления связаны направляющей', () => {
    expect(page).toContain('.tocTree ul{list-style:none; margin:0; padding-left:14px; border-left');
  });
});

describe('постраничная выборка', () => {
  it('размер страницы одинаков во всех запросах, дубли отброшены', async () => {
    const pages: Array<{ size: number; page: number }> = [];
    const all = Array.from({ length: 250 }, (_, i) => 30000 + i);
    const client = {
      search: async () => [],
      fetchBatch: async (ids: number[]) =>
        ids.map(
          (id) =>
            ({ overview: { id, projectId: 14 }, steps: null, comments: [] }) as unknown as never,
        ),
      fetchAttachmentContent: async () => '',
      fetchCustomFields: async () => [],
    } as never as {
      searchPage?: unknown;
    };
    const { TestOpsClient } = await import('../src/testops/client.js');
    const real = new TestOpsClient(
      {
        baseUrl: 'https://x.test',
        token: 't',
        projects: {},
        people: {},
        timeoutMs: 1,
        maxCases: 1000,
        pageSize: 20,
        sort: 'id,DESC',
      } as never,
      {
        get: async (url: string) => {
          const q = new URL(url).searchParams;
          const size = Number(q.get('size'));
          const page = Number(q.get('page'));
          pages.push({ size, page });
          const slice = all.slice(page * size, page * size + size);
          const body = {
            content: slice.map((id) => ({ id, lastModifiedDate: 1 })),
            totalElements: all.length,
          };
          return {
            ok: true,
            status: 200,
            json: async () => body,
            text: async () => JSON.stringify(body),
          } as never;
        },
        postForm: async () =>
          ({
            ok: true,
            status: 200,
            json: async () => ({ access_token: 'a.b.c' }),
            text: async () => JSON.stringify({ access_token: 'a.b.c' }),
          }) as never,
      } as never,
    );
    void client;

    const got = await real.searchAll('q', 14, 250, 100);
    expect(got.total).toBe(250);
    expect(got.hits).toHaveLength(250);
    expect(new Set(got.hits.map((h) => h.id)).size).toBe(250);
    expect(new Set(pages.map((p) => p.size)).size).toBe(1);
  });
});
