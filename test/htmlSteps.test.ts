import { describe, expect, it } from 'vitest';
import { groupByPath } from '../src/html.js';
import { scenarioHtml } from '../src/htmlRichSteps.js';
import type { Scenario, TestCase } from '../src/model.js';
import { defaultProfile } from '../src/profile.js';
import { step, stepsOf } from './scenarioFixtures.js';

const assets = new Map<number, string>();
const depthOf = (html: string) => (html.match(/<ol class="steps">/g) ?? []).length;
const render = (scenario: Scenario, profile = defaultProfile) => scenarioHtml(scenario, profile, assets);

describe('scenario keeps its nesting', () => {
  it('puts a child step inside the parent item', () => {
    const html = render(stepsOf(step('Родитель', { children: [step('Ребёнок')] })));
    expect(depthOf(html)).toBe(2);
    expect(html).toMatch(/Родитель[\s\S]*<ol class="steps">[\s\S]*Ребёнок/);
  });

  it('reaches the third level', () => {
    const html = render(stepsOf(step('Один', { children: [step('Два', { children: [step('Три')] })] })));
    expect(depthOf(html)).toBe(3);
  });

  it('comes back up a level', () => {
    const html = render(stepsOf(step('Один', { children: [step('Вложен')] }), 'Снова верхний'));
    expect(depthOf(html)).toBe(2);
    expect(html.split('Снова верхний')[0]).toContain('</ol>');
    expect(html).toContain('<li data-n="2.">Снова верхний</li>');
  });

  it('keeps markup inside a text-format step', () => {
    const html = render(stepsOf(step('**жирный** и [ссылка](https://x.test)', { origin: 'text' })));
    expect(html).toContain('<strong>жирный</strong>');
    expect(html).toContain('href="https://x.test"');
  });

  it('shows an editor step without rich text as plain text, line by line like its Markdown', () => {
    const html = render(stepsOf('**первая**\n# вторая'));
    expect(html).toContain('<li data-n="1.">**первая**<br># вторая</li>');
  });

  it('takes the step marker from the profile', () => {
    const bullets = { ...defaultProfile, steps: { ...defaultProfile.steps, numbered: false } };
    expect(render(stepsOf('Один'), bullets)).toContain('<li data-n="-">Один</li>');
  });

  it('shows the empty-scenario notice without a numbered list', () => {
    const html = render({ kind: 'empty', fetchError: false });
    expect(html).toContain('Нет шагов');
    expect(depthOf(html)).toBe(0);
  });
});

const caseWith = (id: string, path: string[]): TestCase =>
  ({
    id,
    name: `Кейс ${id}`,
    projectId: 1,
    path,
    status: 'Manual',
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
  }) as TestCase;

describe('grouping by the section tree', () => {
  const items = [
    { tc: caseWith('1', ['Раздел А', 'Подраздел А1']), state: 'current' as const },
    { tc: caseWith('2', ['Раздел А', 'Подраздел А1']), state: 'current' as const },
    { tc: caseWith('3', ['Раздел А', 'Карточка']), state: 'current' as const },
    { tc: caseWith('4', []), state: 'current' as const },
  ];

  it('nests groups the way the paths nest', () => {
    const tree = groupByPath(items);
    expect(tree.children.map((c) => c.name)).toEqual(['Раздел А', 'Без раздела']);
    const webinars = tree.children[0];
    expect(webinars?.children.map((c) => c.name)).toEqual(['Карточка', 'Подраздел А1']);
  });

  it('counts cases including nested groups', () => {
    const tree = groupByPath(items);
    expect(tree.children[0]?.count).toBe(3);
    expect(tree.children[0]?.children[1]?.count).toBe(2);
  });

  it('keeps cases without a path instead of losing them', () => {
    const tree = groupByPath(items);
    const orphans = tree.children.find((c) => c.name === 'Без раздела');
    expect(orphans?.cases.map((c) => c.tc.id)).toEqual(['4']);
  });
});
