import { describe, expect, it } from 'vitest';
import type { AppConfig } from '../src/config.js';
import type { HtmlCase } from '../src/html.js';
import { toJson } from '../src/json.js';
import type { TestCase } from '../src/model.js';
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
    people: [{ name: 'user01', role: 'owner' }],
    relatedCases: [],
    attributes: [{ name: 'Важность', value: 'P1' }],
    isLegacy: false,
    declaredManual: false,
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

const caseOfR4 = (over: Partial<TestCase> = {}): HtmlCase => ({
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

const cfg: AppConfig = {
  baseUrl: 'https://ts.example',
  token: 'tok',
  defaultProjectId: 14,
  projects: { '14': 'WEB' },
  timeoutMs: 30000,
  maxCases: 100,
  pageSize: 20,
  sort: 'id,DESC',
} as unknown as AppConfig;

describe('структурный вывод', () => {
  it('несёт слой, признак автоматизации, кастомные поля и комментарии', () => {
    const json = toJson(caseOf().tc, 'current', 'WEB');
    expect(json.layer).toBe('Web');
    expect(json.automated).toBe(false);
    expect(json.attributes).toEqual([{ name: 'Важность', value: 'P1' }]);
    expect(json.comments).toHaveLength(1);
  });
});

describe('версия контракта доступна вне Markdown', () => {
  it('структурный вывод её называет', () => {
    const json = toJson(caseOfR4().tc, 'current', 'WEB', defaultProfile);
    expect(json.contract).toEqual({ id: 'testops-markdown', version: '1.0' });
  });
});

describe('структурный вывод', () => {
  it('называет, лежит ли сценарий в старом виде', () => {
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
      isLegacy: true,
      declaredManual: false,
      description: '',
      precondition: '',
      expectedResult: '',
      scenarioSource: 'rawMarkdown',
      scenarioLines: [],
      comments: [],
    } as unknown as TestCase;
    expect(toJson(tc, 'oldFormat', 'WEB', defaultProfile).isLegacy).toBe(true);
  });
});

describe('link в структурном виде', () => {
  it('отдаёт JSON, а не голый адрес', async () => {
    const { Gateway } = await import('../src/gateway.js');
    const gw = new Gateway(cfg, {} as never, undefined, null, false, () => {});
    const url = gw.linkFor('tag = "Smoke"', '14');
    expect(() => JSON.parse(JSON.stringify({ url, rql: 'tag = "Smoke"' }))).not.toThrow();
    expect(url).toContain('https://ts.example/project/14/test-cases');
  });
});
