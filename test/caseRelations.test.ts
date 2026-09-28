import { describe, expect, it } from 'vitest';
import { type EmbeddedAssets, type HtmlCase, renderCaseHtml } from '../src/html.js';
import type { RawCase, TestCase } from '../src/model.js';
import { normalizeCase } from '../src/normalize.js';
import { defaultProfile } from '../src/profile.js';
import { stepsOf } from './scenarioFixtures.js';

const caseOf = (over: Partial<TestCase> = {}): HtmlCase => ({
  tc: {
    id: '1',
    name: 'Кейс',
    projectId: 1,
    path: [],
    status: 'Active',
    automated: false,
    layer: 'Web',
    tags: [],
    attachments: [],
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
    scenario: stepsOf('Шаг'),
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
    projectId: 1,
    path: [],
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
    scenario: stepsOf('Шаг'),
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
    expect((html.match(/<div class="rel rel_case">/g) ?? []).length).toBe(2);
  });
});

describe('связанный кейс из другого проекта', () => {
  it('без своего проекта ведёт в проект текущего кейса, вид связи стоит перед ссылкой', () => {
    const html = renderCaseHtml(
      caseOfR8({ relatedCases: [{ id: '77', name: 'Смежный', kind: 'clones', projectId: null }] }),
      defaultProfile,
      assets,
      'https://ts.example',
    );
    expect(html).toContain(
      '<div class="rel rel_case"><span class="pill">clones</span><a href="https://ts.example/project/1/test-cases/77" target="_blank" rel="noopener">77 Смежный</a></div>',
    );
  });

  it('со своим проектом ведёт именно в него', () => {
    const html = renderCaseHtml(
      caseOfR8({ relatedCases: [{ id: '77', name: 'Смежный', kind: 'relates', projectId: 2 }] }),
      defaultProfile,
      assets,
      'https://ts.example',
    );
    expect(html).toContain('https://ts.example/project/2/test-cases/77');
  });
});

describe('нормализация связей', () => {
  it('проект связанного кейса сохраняется, когда он пришёл', () => {
    const tc = normalizeCase(
      {
        overview: { id: 1, projectId: 1 },
        steps: null,
        comments: [],
        relations: [{ type: 'relates', target: { id: 77, name: 'Смежный', projectId: 2 } }],
      } as unknown as RawCase,
      defaultProfile,
    );
    expect(tc.relatedCases[0]?.projectId).toBe(2);
  });
});
