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
import { step, stepsOf } from './scenarioFixtures.js';
import { scenarioHtml } from '../src/htmlRichSteps.js';

const ATT = 'https://x.test/api/testcase/attachment/20001/content';
const assets: EmbeddedAssets = new Map([[20001, 'data:image/png;base64,AAAA']]);

const testCase = (over: Partial<TestCase> = {}): TestCase =>
  ({
    id: '10002',
    name: 'Проверка входа',
    projectId: 1,
    path: ['Раздел', 'Подраздел'],
    status: 'Active',
    automated: false,
    layer: 'Web',
    tags: ['Smoke'],
    attachments: [],
    linkRefs: [],
    issues: [],
    people: [],
    relatedCases: [],
    attributes: [],
    isLegacy: false,
    description: 'Описание',
    precondition: '',
    expectedResult: 'Готово',
    scenarioSource: 'newSteps',
    scenario: stepsOf('Шаг один', 'Шаг два'),
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
    expect(linked).toContain('href="https://testops.test/project/1/test-cases/1"');
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

describe('раскладка страницы', () => {
  it('вид документом не шире 1200 пикселей и сужается вместе с окном', () => {
    const html = renderCaseHtml(one(), defaultProfile, assets);
    expect(html).toContain('margin:0 auto; padding:32px 24px 64px; max-width:1200px;');
  });

  it('номер шага стоит в строке с текстом, а не приколот сверху', () => {
    const html = renderCaseHtml(one(), defaultProfile, assets);
    expect(html).toContain(
      'content:attr(data-n); float:left; width:26px; margin:0 8px 0 -34px; text-align:right;',
    );
    expect(html).toContain('font:500 13px/21.6px var(--mono)');
    expect(html).toContain('.steps>li>:first-child,.expList>li>:first-child{margin-top:0}');
  });
});

describe('поле отбора и списки внутри шагов', () => {
  it('поле отбора прилипает под панелью, а в двух колонках — к верху дерева', () => {
    const html = renderCaseHtml(one(), defaultProfile, assets);
    expect(html).toContain('.treeFilter{\n  position:sticky; top:var(--toolbar-h); z-index:80;');
    expect(html).toContain('body.split .treeFilter{top:0}');
  });

  it('номера получают только пункты сценария и ожидаемого результата', () => {
    const html = renderCaseHtml(one(), defaultProfile, assets);
    expect(html).toContain('.steps>li,.expList>li{padding:3px 0 3px 34px;');
    expect(html).toContain('content:attr(data-n)');
    expect(html).not.toContain('.block.scenario li{');
  });

  it('маркированный список в ожидаемом результате не сбивает номера шагов', () => {
    const expected = { kind: 'text' as const, text: '* первое\n* второе', rich: null };
    const html = scenarioHtml(stepsOf(step('Открыть', { expected }), 'Закрыть'), defaultProfile, assets);
    expect((html.match(/<ol class="steps">/g) ?? []).length).toBe(1);
    expect(html).toContain('<ul>');
    expect(html).toContain('<li data-n="2.">Закрыть');
  });
});
