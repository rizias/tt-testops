import { describe, expect, it } from 'vitest';
import { renderBatchHtml } from '../src/html.js';
import type { TestCase } from '../src/model.js';
import { defaultProfile } from '../src/profile.js';

const assets = new Map<number, string>();

const caseWith = (id: string, path: string[], scenario = ['1. Шаг']): TestCase =>
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
    scenarioLines: scenario,
    comments: [],
  }) as TestCase;

const items = [
  { tc: caseWith('1', ['Раздел А', 'Подраздел А1']), state: 'current' as const },
  { tc: caseWith('2', ['Раздел А', 'Подраздел А1']), state: 'current' as const },
  {
    tc: caseWith('3', ['Раздел А', 'Календарь', 'Фильтр', 'Заголовок']),
    state: 'current' as const,
  },
];
const html = renderBatchHtml(items, defaultProfile, assets, 'https://testops.test');

describe('expand controls', () => {
  it('область действия кнопок названа словами', () => {
    expect(html).toContain('data-act="open-all"');
    expect(html).toContain('data-act="close-all"');
    expect(html).toContain('вся выгрузка:');
  });

  it('у каждого раздела своя кнопка сворачивания', () => {
    const groups = (html.match(/<details class="group"/g) ?? []).length;

    expect(groups).toBe(5);
    expect((html.match(/data-act="collapse-section"/g) ?? []).length).toBe(groups);
  });

  it('оглавление перечисляет все разделы', () => {
    const groups = (html.match(/<details class="group"/g) ?? []).length;
    expect((html.match(/data-section-target="section-/g) ?? []).length).toBe(groups);
    expect(html).toContain('class="tocSearch"');
  });

  it('есть возврат в начало страницы', () => {
    expect(html).toContain('class="toTop"');
    expect(html).toContain('id="top-sentinel"');
  });

  it('ships exactly one handler no matter how many groups there are', () => {
    expect((html.match(/<script>/g) ?? []).length).toBe(1);
  });

  it('the handler opens nested details, including the cases', () => {
    const script = html.slice(html.indexOf('<script>'), html.indexOf('</script>'));
    expect(script).toContain('querySelectorAll');
    expect(script).toContain('details');
    expect(script).toContain('open');
  });

  it('keeps everything collapsed by default', () => {
    expect(html).not.toContain('<details class="case" open>');
    expect(html).not.toContain('<details class="group" open>');
  });
});

describe('nesting does not drift sideways', () => {
  it('gives nested groups no horizontal padding or border of their own', () => {
    const style = html.slice(html.indexOf('<style>'), html.indexOf('</style>'));
    expect(style).toMatch(/details\.group\s*{[^}]*border:\s*0/);
    expect(style).toMatch(/details\.group\s*{[^}]*padding:\s*0/);
  });

  it('indents each level by one fixed step', () => {
    const style = html.slice(html.indexOf('<style>'), html.indexOf('</style>'));
    expect(style).toContain('14px');
  });
});

describe('a single result is not a list', () => {
  const single = renderBatchHtml(
    [{ tc: caseWith('7', ['Раздел А', 'Календарь']), state: 'current' }],
    defaultProfile,
    assets,
    'https://testops.test',
  );

  it('shows the case expanded, with nothing collapsed', () => {
    expect(single).not.toContain('<details');
    expect(single).toContain('Кейс 7');
    expect(single).toContain('Шаг');
  });

  it('carries no expand controls — there is nothing to expand', () => {
    expect(single).not.toContain('class="ctl"');
  });

  it('still links back to TestOps in a new tab', () => {
    expect(single).toContain('href="https://testops.test/project/14/test-cases/7"');
    expect(single).toContain('target="_blank"');
  });
});

describe('page heading', () => {
  it('does not shout "Тест-кейсы" — that is obvious from the content', () => {
    expect(html).not.toContain('<h1>Тест-кейсы</h1>');
  });

  it('keeps the count in the summary line', () => {
    expect(html).toContain('Кейсов: 3');
  });
});

describe('sanitising still runs before our own code is added', () => {
  const nasty = [
    {
      tc: caseWith('9', ['Раздел'], ['1. до <script>alert(1)</script> после']),
      state: 'current' as const,
    },

    { tc: caseWith('10', ['Раздел']), state: 'current' as const },
  ];
  const page = renderBatchHtml(nasty, defaultProfile, assets, 'https://testops.test');

  it('strips the script that came from the case text', () => {
    expect(page).not.toContain('alert(1)');
    expect(page).toContain('до');
    expect(page).toContain('после');
  });

  it('still ships our handler', () => {
    expect((page.match(/<script>/g) ?? []).length).toBe(1);
    expect(page).toContain('data-act="open-all"');
  });
});
