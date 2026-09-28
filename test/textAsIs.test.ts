import { describe, expect, it } from 'vitest';
import { type ResolveDeps, resolveToTestCase } from '../src/contentResolver.js';
import { renderCaseHtml } from '../src/html.js';
import { renderRich } from '../src/htmlRich.js';
import type { RawCase, RichNode } from '../src/model.js';
import { defaultProfile } from '../src/profile.js';
import { renderCase } from '../src/render.js';

const deps: ResolveDeps = { baseUrl: 'https://ts.example', fetchAttachment: async () => '' };

const text =
  'В поле «Оплата» указано значение «рассрочка».  Или несколько  способов  оплаты\nКарточки без рассрочки не отображаются.';

const editorCase = (): RawCase =>
  ({
    overview: { id: 1, name: 'Кейс  с двумя пробелами', hasManualScenario: true, scenario: { steps: [] } },
    steps: {
      root: { children: [1] },
      scenarioSteps: {
        1: {
          body: text,
          bodyJson: {
            type: 'doc',
            content: [
              { type: 'paragraph' },
              {
                type: 'paragraph',
                content: [{ type: 'text', text: 'В поле «Оплата» указано значение «рассрочка».  Или несколько  способов  оплаты' }],
              },
              { type: 'paragraph', content: [{ type: 'text', text: 'Карточки без рассрочки не отображаются.' }] },
            ],
          },
        },
      },
      attachments: {},
    },
  }) as unknown as RawCase;

describe('текст кейса выводится как пришёл из TestOps', () => {
  it('Markdown: два пробела подряд сохранены, каждый абзац — своей строкой', async () => {
    const tc = await resolveToTestCase(editorCase(), defaultProfile, deps);
    expect(tc.scenarioLines).toEqual([
      '1. В поле «Оплата» указано значение «рассрочка».  Или несколько  способов  оплаты',
      '   Карточки без рассрочки не отображаются.',
    ]);
  });

  it('Markdown: к строкам не добавляются пробелы и обратная косая черта', async () => {
    const tc = await resolveToTestCase(editorCase(), defaultProfile, deps);
    const md = renderCase(tc, defaultProfile);
    expect(md).toContain('# **Кейс  с двумя пробелами** (ID: 1)');
    expect(md.split('\n').filter((line) => line.endsWith('  '))).toEqual([]);
  });

  it('HTML: текст показывается с сохранением пробелов, каждый абзац — своей строкой', async () => {
    const tc = await resolveToTestCase(editorCase(), defaultProfile, deps);
    const page = renderCaseHtml({ tc, state: 'current' }, defaultProfile, new Map());
    expect(page).toContain('«рассрочка».  Или несколько  способов  оплаты</p><p class="para">Карточки без рассрочки не отображаются.</p>');
    expect(page).toMatch(/\.blockBody\{[^}]*white-space:pre-wrap/);
  });

  it('HTML: пустой абзац из bodyJson, в том числе первый, показывается пустой строкой', async () => {
    const tc = await resolveToTestCase(editorCase(), defaultProfile, deps);
    const page = renderCaseHtml({ tc, state: 'current' }, defaultProfile, new Map());
    expect(page).toContain('<li data-n="1."><p class="para"><br></p><p class="para">В поле «Оплата»');
  });

  it('HTML: параметр шага показывается своим именем в фигурных скобках, как в body', () => {
    const doc: RichNode = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: '"justification": "' },
            { type: 'parameter', attrs: { name: 'значение' } },
            { type: 'text', text: '"' },
          ],
        },
      ],
    };
    expect(renderRich(doc)).toBe('<p class="para">&quot;justification&quot;: &quot;{{значение}}&quot;</p>');
  });

  it('HTML: цвет текста из TestOps сохраняется, цвет по умолчанию не добавляет разметки', () => {
    const doc: RichNode = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'жёлтый', marks: [{ type: 'text_color', attrs: { kind: 'yellow' } }] },
            { type: 'text', text: ' обычный', marks: [{ type: 'text_color', attrs: { kind: 'default' } }] },
          ],
        },
      ],
    };
    expect(renderRich(doc)).toBe('<p class="para"><span class="tc tc-yellow">жёлтый</span> обычный</p>');
  });

  it('Markdown: две пустые строки подряд в тексте вложения остаются двумя', async () => {
    const legacy = {
      overview: {
        id: 2,
        name: 'Кейс',
        hasManualScenario: false,
        scenario: {
          steps: [{ name: 'Меню', attachments: [{ id: 5, name: 'description_0.md', contentType: 'text/markdown' }] }],
        },
      },
      steps: null,
    } as unknown as RawCase;
    const tc = await resolveToTestCase(legacy, defaultProfile, {
      baseUrl: 'https://ts.example',
      fetchAttachment: async () => 'Меню анонсов \n___\n\n\n   картинка \n',
    });
    expect(tc.scenarioLines).toEqual(['1. Меню', '   Меню анонсов ', '   ___', '', '', '      картинка ']);
  });

});
