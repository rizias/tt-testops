import { describe, expect, it } from 'vitest';
import {
  type EmbeddedAssets,
  type HtmlCase,
  renderBatchHtml,
  renderCaseHtml,
} from '../src/html.js';
import type { RawCase, RawLink, TestCase } from '../src/model.js';
import { normalizeCase } from '../src/normalize.js';
import { defaultProfile } from '../src/profile.js';
import { cleanText } from '../src/text.js';

const caseOf = (over: Partial<TestCase> = {}): HtmlCase => ({
  tc: {
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
    people: [{ name: 'user01', role: 'owner' }],
    relatedCases: [],
    attributes: [{ name: 'Важность', value: 'P1' }],
    isLegacy: false,
    description: 'Описание',
    precondition: '',
    expectedResult: '',
    scenarioSource: 'newSteps',
    scenarioLines: ['1. Шаг'],
    comments: [{ author: 'user01', body: 'Замечание', createdAt: '2026-01-01' }],
    ...over,
  } as TestCase,
  state: 'current',
});

const assets: EmbeddedAssets = new Map();

const caseOfR9 = (over: Partial<TestCase> = {}): HtmlCase => ({
  tc: {
    id: '10001',
    name: 'Кейс',
    projectId: null,
    path: [],
    status: 'Active',
    automated: false,
    layer: '',
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

describe('карта людей', () => {
  it('меняет имя автора комментария в представлении', async () => {
    const { renderCaseHtml } = await import('../src/html.js');
    const html = renderCaseHtml(
      {
        tc: {
          id: '1',
          name: 'Кейс',
          projectId: 14,
          path: [],
          status: 'Active',
          automated: false,
          layer: '',
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
          comments: [{ id: '1', author: 'user.one', createdAt: '', body: 'текст' }],
        },
        state: 'current',
      } as never,
      defaultProfile,
      new Map(),
      '',
      { 'user.one': 'Первый Человек' },
    );
    expect(html).toContain('Первый Человек');
    expect(html).not.toContain('user.one');
  });
});

describe('несколько корневых разделов', () => {
  it('получают разные идентификаторы, а не повторяют section-0', async () => {
    const { renderBatchHtml } = await import('../src/html.js');
    const base = {
      name: 'Кейс',
      projectId: 14,
      status: 'Active',
      automated: false,
      layer: '',
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
    };
    const html = renderBatchHtml(
      [
        { tc: { ...base, id: '1', path: ['Раздел А'] }, state: 'current' },
        { tc: { ...base, id: '2', path: ['Раздел Б'] }, state: 'current' },
      ] as never[],
      defaultProfile,
      new Map(),
      '',
    );
    const ids = [...html.matchAll(/<summary id="(section-\d+)"/g)].map((m) => m[1]);
    expect(ids.length).toBeGreaterThan(1);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('отбор кейсов в дереве', () => {
  const row = (id: string, name: string) =>
    ({
      tc: {
        id,
        name,
        projectId: 14,
        path: ['Раздел'],
        status: 'Active',
        automated: false,
        layer: '',
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
      },
      state: 'current',
    }) as never;

  it('у каждого кейса есть признак поиска по номеру и имени', async () => {
    const { renderBatchHtml } = await import('../src/html.js');
    const html = renderBatchHtml(
      [row('10001', 'Форма отправки'), row('10002', 'Список клиентов')],
      defaultProfile,
      new Map(),
      '',
    );
    expect(html).toContain('data-find="10001 форма отправки"');
    expect(html).toContain('data-find="10002 список клиентов"');
  });

  it('поле отбора есть над деревом', async () => {
    const { renderBatchHtml } = await import('../src/html.js');
    const html = renderBatchHtml(
      [row('1', 'Кейс'), row('2', 'Другой')],
      defaultProfile,
      new Map(),
      '',
    );
    expect(html).toContain('class="treeFilter"');
    expect(html.indexOf('treeFilter')).toBeLessThan(html.indexOf('details class="group"'));
  });
});

describe('страница одиночного кейса не беднее пачки', () => {
  const html = renderCaseHtml(
    caseOf(),
    defaultProfile,
    new Map() as EmbeddedAssets,
    'https://ts.example',
  );

  it('картинку можно открыть целиком', () => {
    expect(html).toContain('openViewer');
  });

  it('ссылку на кейс можно скопировать', () => {
    expect(html).toContain('data-act="copy"');
  });
});

describe('карта людей действует и в пачке', () => {
  it('владелец показан именем из карты', () => {
    const html = renderBatchHtml(
      [caseOf(), caseOf({ id: '2' })],
      defaultProfile,
      new Map() as EmbeddedAssets,
      'https://ts.example',
      {},
      { user01: 'Иван Иванов' },
    );
    expect(html).toContain('Иван Иванов');
  });
});

describe('ссылки кейса', () => {
  const raw = (links: RawLink[]) =>
    ({ overview: { id: 1, name: 'Кейс', links }, steps: null }) as unknown as RawCase;

  it('две разные ссылки с одной подписью не сливаются', () => {
    const tc = normalizeCase(
      raw([
        { name: 'Задача', url: 'https://tracker.example/A-1' },
        { name: 'Задача', url: 'https://tracker.example/A-2' },
      ]),
      defaultProfile,
    );
    expect(tc.linkRefs.map((l) => l.url)).toEqual([
      'https://tracker.example/A-1',
      'https://tracker.example/A-2',
    ]);
  });

  it('ссылка в тексте сохраняется дословно', () => {
    const text = '[https://x.example/a](https://x.example/a)';
    expect(cleanText(text, false)).toBe(text);
  });
});

describe('кнопка копирования ссылки', () => {
  it('у кейса без проекта её нет', () => {
    const html = renderCaseHtml(caseOfR9(), defaultProfile, assets, 'https://ts.example');
    expect(html).not.toContain('data-act="copy"');
    expect(html).not.toContain('/project//');
  });

  it('у кейса с проектом она есть и несёт настоящий адрес', () => {
    const html = renderCaseHtml(
      caseOfR9({ projectId: 14 }),
      defaultProfile,
      assets,
      'https://ts.example',
    );
    expect(html).toContain('https://ts.example/project/14/test-cases/10001');
  });
});
