import { describe, expect, it } from 'vitest';
import { type EmbeddedAssets, renderRich } from '../src/html.js';
import { scenarioHtml } from '../src/htmlRichSteps.js';
import type { RawStepData, RichNode } from '../src/model.js';
import { defaultProfile } from '../src/profile.js';
import { buildEditorSteps } from '../src/stepBuilder.js';
import { editorLines, step, stepsOf } from './scenarioFixtures.js';

const assets: EmbeddedAssets = new Map();
const profile = defaultProfile;

const text = (value: string, ...marks: string[]): RichNode => ({
  type: 'text',
  text: value,
  marks: marks.map((type) => ({ type })),
});
const doc = (...content: RichNode[]): RichNode => ({
  type: 'doc',
  content: [{ type: 'paragraph', content }],
});

describe('размеченный текст шага в представлении', () => {
  it('показывает моноширинный фрагмент', () => {
    const html = renderRich(doc(text('Отправить '), text('GET /v1/ping', 'code')));
    expect(html).toBe('<p class="para">Отправить <code>GET /v1/ping</code></p>');
  });

  it('показывает полужирный фрагмент', () => {
    const html = renderRich(doc(text('Ответ '), text('429 Too Many Requests', 'bold')));
    expect(html).toBe('<p class="para">Ответ <strong>429 Too Many Requests</strong></p>');
  });

  it('показывает подчёркивание, которого в Markdown нет вовсе', () => {
    expect(renderRich(doc(text('важно', 'underline')))).toBe('<p class="para"><u>важно</u></p>');
  });

  it('делает ссылку кликабельной', () => {
    const node: RichNode = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            {
              type: 'text',
              text: 'документация',
              marks: [{ type: 'link', attrs: { href: 'https://example.test/doc' } }],
            },
          ],
        },
      ],
    };
    const html = renderRich(node);
    expect(html).toContain('<a href="https://example.test/doc"');
    expect(html).toContain('rel="noopener"');
  });

  it('неизвестное оформление показывается текстом, а не разметкой', () => {
    expect(renderRich(doc(text('текст', 'highlight')))).toBe('<p class="para">текст</p>');
  });
});

const stepData = (bodyJson?: RichNode): RawStepData => ({
  root: { children: [1] },
  scenarioSteps: { 1: { body: 'Отправить GET /v1/ping', bodyJson } },
});

describe('размеченный текст идёт вторым каналом', () => {
  it('плоские строки не меняются от наличия разметки', () => {
    const withRich = editorLines([1], stepData(doc(text('Отправить GET /v1/ping'))), profile);
    const without = editorLines([1], stepData(), profile);
    expect(withRich).toEqual(without);
    expect(without).toEqual(['1. Отправить GET /v1/ping']);
  });

  it('размеченный текст лежит в шаге модели', () => {
    const rich = doc(text('Отправить GET /v1/ping'));
    const [built] = buildEditorSteps(stepData(rich));
    expect(built?.rich).toEqual(rich);
  });

  it('у шага без разметки её нет', () => {
    const [built] = buildEditorSteps(stepData());
    expect(built?.rich).toBeNull();
  });
});

describe('сценарий в представлении', () => {
  it('берёт разметку, когда она есть', () => {
    const rich = doc(text('Отправить '), text('GET /v1/ping', 'code'));
    const html = scenarioHtml(stepsOf(step('Отправить GET /v1/ping', { rich })), profile, assets);
    expect(html).toContain('<code>GET /v1/ping</code>');
  });

  it('без разметки показывает плоский текст, как раньше', () => {
    const plain = scenarioHtml(stepsOf('Отправить GET /v1/ping'), profile, assets);
    expect(plain).toContain('<li data-n="1.">Отправить GET /v1/ping</li>');
  });
});
