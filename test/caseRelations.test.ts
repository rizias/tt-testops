import { describe, expect, it } from 'vitest';
import { type EmbeddedAssets, type HtmlCase, renderCaseHtml } from '../src/html.js';
import type { RawCase, TestCase } from '../src/model.js';
import { normalizeCase } from '../src/normalize.js';
import { defaultProfile } from '../src/profile.js';

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
    people: [],
    relatedCases: [
      { id: '2', name: 'Первый связанный', kind: 'blocks' },
      { id: '3', name: 'Второй связанный', kind: 'relates' },
    ],
    attributes: [],
    isLegacy: false,
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

const assets: EmbeddedAssets = new Map();

const caseOfR8 = (over: Partial<TestCase> = {}): HtmlCase => ({
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

describe('связанные кейсы', () => {
  it('каждый стоит своей строкой', () => {
    const html = renderCaseHtml(
      caseOf(),
      defaultProfile,
      new Map() as EmbeddedAssets,
      'https://ts.example',
    );
    expect((html.match(/<div class="rel">/g) ?? []).length).toBe(2);
  });
});

describe('связанный кейс из другого проекта', () => {
  it('без своего проекта ссылкой не становится', () => {
    const html = renderCaseHtml(
      caseOfR8({ relatedCases: [{ id: '77', name: 'Смежный', kind: 'relates', projectId: null }] }),
      defaultProfile,
      assets,
      'https://ts.example',
    );
    expect(html).toContain('Смежный');
    expect(html).not.toContain('/test-cases/77');
  });

  it('со своим проектом ведёт именно в него', () => {
    const html = renderCaseHtml(
      caseOfR8({ relatedCases: [{ id: '77', name: 'Смежный', kind: 'relates', projectId: 85 }] }),
      defaultProfile,
      assets,
      'https://ts.example',
    );
    expect(html).toContain('https://ts.example/project/85/test-cases/77');
  });
});

describe('нормализация связей', () => {
  it('проект связанного кейса сохраняется, когда он пришёл', () => {
    const tc = normalizeCase(
      {
        overview: { id: 1, projectId: 14 },
        steps: null,
        comments: [],
        relations: [{ type: 'relates', target: { id: 77, name: 'Смежный', projectId: 85 } }],
      } as unknown as RawCase,
      defaultProfile,
    );
    expect(tc.relatedCases[0]?.projectId).toBe(85);
  });
});
