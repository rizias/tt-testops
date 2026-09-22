import { describe, expect, it } from 'vitest';
import { groupByPath, renderScenario } from '../src/html.js';
import type { TestCase } from '../src/model.js';
import { defaultProfile } from '../src/profile.js';

const assets = new Map<number, string>();
const depthOf = (html: string) => (html.match(/<ol>/g) ?? []).length;

describe('scenario keeps its nesting', () => {
  it('puts a 2-space step inside the parent item', () => {
    const html = renderScenario(['1. Родитель', '  1. Ребёнок'], defaultProfile, assets);
    expect(depthOf(html)).toBe(2);
    expect(html).toMatch(/Родитель[\s\S]*<ol>[\s\S]*Ребёнок/);
  });

  it('reaches the third level at 4 spaces', () => {
    const html = renderScenario(['1. Один', '  1. Два', '    1. Три'], defaultProfile, assets);
    expect(depthOf(html)).toBe(3);
  });

  it('comes back up a level', () => {
    const html = renderScenario(
      ['1. Один', '  1. Вложен', '2. Снова верхний'],
      defaultProfile,
      assets,
    );
    expect(depthOf(html)).toBe(2);
    expect(html.split('Снова верхний')[0]).toContain('</ol>');
  });

  it('keeps markup inside a step', () => {
    const html = renderScenario(
      ['1. **жирный** и [ссылка](https://x.test)'],
      defaultProfile,
      assets,
    );
    expect(html).toContain('<strong>жирный</strong>');
    expect(html).toContain('href="https://x.test"');
  });

  it('reads the indent from the profile instead of a hard-coded number', () => {
    const wide = { ...defaultProfile, steps: { ...defaultProfile.steps, indent: '    ' } };

    expect(depthOf(renderScenario(['1. Один', '  1. Не уровень'], wide, assets))).toBe(1);
    expect(depthOf(renderScenario(['1. Один', '    1. Уровень'], wide, assets))).toBe(2);
  });

  it('refuses to turn the empty-scenario notice into a numbered step', () => {
    expect(renderScenario([defaultProfile.warnings.emptyScenario], defaultProfile, assets)).toBe(
      '',
    );
  });

  it('refuses to number a raw-markdown scenario that has no step markers', () => {
    expect(renderScenario(['Просто текст сценария', 'вторая строка'], defaultProfile, assets)).toBe(
      '',
    );
  });
});

const caseWith = (id: string, path: string[]): TestCase =>
  ({
    id,
    name: `Кейс ${id}`,
    projectId: 14,
    path,
    status: 'Manual',
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
    expect(webinars?.children.map((c) => c.name)).toEqual(['Подраздел А1', 'Карточка']);
  });

  it('counts cases including nested groups', () => {
    const tree = groupByPath(items);
    expect(tree.children[0]?.count).toBe(3);
    expect(tree.children[0]?.children[0]?.count).toBe(2);
  });

  it('keeps cases without a path instead of losing them', () => {
    const tree = groupByPath(items);
    const orphans = tree.children.find((c) => c.name === 'Без раздела');
    expect(orphans?.cases.map((c) => c.tc.id)).toEqual(['4']);
  });
});
