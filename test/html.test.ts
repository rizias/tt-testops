import { describe, expect, it } from 'vitest';
import {
  type EmbeddedAssets,
  type HtmlCase,
  renderBatchHtml,
  renderCaseHtml,
  renderMarkdown,
} from '../src/html.js';
import type { TestCase } from '../src/model.js';
import { defaultProfile } from '../src/profile.js';

const ATT = 'https://x.test/api/testcase/attachment/20001/content';
const assets: EmbeddedAssets = new Map([[20001, 'data:image/png;base64,AAAA']]);

const testCase = (over: Partial<TestCase> = {}): TestCase =>
  ({
    id: '10002',
    name: 'Проверка входа',
    projectId: 14,
    path: ['Раздел', 'Подраздел'],
    status: 'Active',
    automated: false,
    layer: 'Web',
    tags: ['Smoke'],
    links: [],
    linkRefs: [],
    issues: [],
    people: [],
    relatedCases: [],
    attributes: [],
    isLegacy: false,
    declaredManual: false,
    description: 'Описание',
    precondition: '',
    expectedResult: 'Готово',
    scenarioSource: 'newSteps',
    scenarioLines: ['1. Шаг один', '2. Шаг два'],
    comments: [],
    ...over,
  }) as TestCase;

const one = (over: Partial<TestCase> = {}, state: HtmlCase['state'] = 'current'): HtmlCase => ({
  tc: testCase(over),
  state,
});

describe('renderMarkdown', () => {
  it('swaps an attachment url for its embedded copy', () => {
    const html = renderMarkdown(`![скрин](${ATT})`, assets);
    expect(html).toContain('src="data:image/png;base64,AAAA"');
    expect(html).not.toContain('/api/testcase/attachment/');
  });

  it('marks an attachment that could not be downloaded', () => {
    const html = renderMarkdown(`![скрин](${ATT})`, new Map());
    expect(html).toContain('data-missing-attachment="20001"');
  });

  it('renders tables and code, which the old prototype could not', () => {
    const html = renderMarkdown('| a | b |\n|---|---|\n| 1 | 2 |\n\n```js\nx=1\n```', assets);
    expect(html).toContain('<table>');
    expect(html).toContain('<code');
  });

  it('removes a script tag coming from case text', () => {
    const html = renderMarkdown('нажми <script>alert(1)</script>', assets);
    expect(html).not.toContain('<script');
    expect(html).not.toContain('alert(1)');
    expect(html).toContain('нажми');
  });

  it('removes inline event handlers', () => {
    expect(renderMarkdown('<img src="x.png" onerror="alert(1)">', assets)).not.toContain('onerror');
  });

  it('defuses a javascript: link', () => {
    expect(renderMarkdown('<a href="javascript:alert(1)">клик</a>', assets)).not.toContain(
      'javascript:',
    );
  });

  it('keeps harmless inline html', () => {
    expect(renderMarkdown('текст <b>жирный</b>', assets)).toContain('<b>жирный</b>');
  });

  it('leaves non-attachment links alone', () => {
    expect(renderMarkdown('[макет](https://figma.com/x)', assets)).toContain(
      'href="https://figma.com/x"',
    );
  });
});

describe('single case page', () => {
  const html = renderCaseHtml(one(), defaultProfile, assets);

  it('is a complete document', () => {
    expect(html.startsWith('<!doctype html>')).toBe(true);
    expect(html).toContain('<title>10002 · Проверка входа</title>');
  });

  it('shows the sections and the steps', () => {
    expect(html).toContain('Сценарий');
    expect(html).toContain('Шаг один');
    expect(html).toContain('Ожидаемый результат');
  });

  it('is expanded — there is nothing to collapse', () => {
    expect(html).not.toContain('<details>');
  });
});

describe('batch page', () => {
  const cases = [one({ id: '1' }), one({ id: '2', name: 'Старый' }, 'oldFormat')];
  const html = renderBatchHtml(cases, defaultProfile, assets);

  it('collapses every case', () => {
    expect(html.match(/<details class="case" id="case-/g)?.length).toBe(2);
  });

  it('wraps the cases in their section group', () => {
    expect(html.match(/<details class="group" data-depth="\d+">/g)?.length).toBe(2);
    expect(html).toContain('Раздел');
    expect(html).toContain('Подраздел');
  });

  it('shows the scenario state in the collapsed header', () => {
    expect(html).toContain('старый формат');
  });

  it('counts the cases needing a rewrite', () => {
    expect(html).toContain('Кейсов: 2');
    expect(html).toContain('переписывания перед автоматизацией: 1');
  });

  it('drops the marks when they are switched off', () => {
    const off = renderBatchHtml(cases, { ...defaultProfile, showMarks: false }, assets);
    expect(off).not.toContain('старый формат');

    expect(off).toContain('Шаг один');
    expect(off.match(/<details class="case" id="case-/g)?.length).toBe(2);
  });

  it('links each case back to TestOps without toggling the block', () => {
    const linked = renderBatchHtml(cases, defaultProfile, assets, 'https://testops.test');
    expect(linked).toContain('href="https://testops.test/project/14/test-cases/1"');
    expect(linked).toContain('target="_blank"');
  });

  it('показывает тип кейса собственным значком, а не системным эмодзи', () => {
    expect(html).toContain('type_manual');
    expect(html).not.toContain('🤖');
    expect(html).not.toContain('✋');
    const auto = renderBatchHtml(
      [{ tc: testCase({ id: '9', automated: true }), state: 'current' }],
      defaultProfile,
      assets,
    );
    expect(auto).toContain('type_auto');
  });
});

describe('comments', () => {
  const withComment = one({
    comments: [
      {
        id: '20002',
        author: 'Автор комментария',
        createdAt: '2026-07-29T00:00:00.000Z',
        body: `![image.png](${ATT})`,
      },
    ],
  });

  it('renders a comment whose whole body is an image', () => {
    const html = renderCaseHtml(withComment, defaultProfile, assets);
    expect(html).toContain('Комментарии (1)');
    expect(html).toContain('Автор комментария');
    expect(html).toContain('src="data:image/png;base64,AAAA"');
  });

  it('omits the section when there are none', () => {
    expect(renderCaseHtml(one(), defaultProfile, assets)).not.toContain('Комментарии');
  });

  it('counts comments in the collapsed header', () => {
    const batch = renderBatchHtml([withComment, one({ id: '2' })], defaultProfile, assets);
    expect(batch).toContain('комментариев: 1');
  });

  it('у кейса без комментариев метки о комментариях нет', () => {
    const batch = renderBatchHtml([one({ id: '2' }), one({ id: '3' })], defaultProfile, assets);
    expect(batch).not.toContain('комментариев:');
  });
});
