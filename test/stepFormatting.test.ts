import { describe, expect, it } from 'vitest';
import { type EmbeddedAssets, renderRich, renderScenario } from '../src/html.js';
import type { RawStepData, RichNode } from '../src/model.js';
import { defaultProfile } from '../src/profile.js';
import { buildSteps, buildStepsWithRich } from '../src/stepBuilder.js';

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
    const html = renderRich(doc(text('Отправить '), text('GET /v1/ping', 'code')), profile);
    expect(html).toBe('Отправить <code>GET /v1/ping</code>');
  });

  it('показывает полужирный фрагмент', () => {
    const html = renderRich(doc(text('Ответ '), text('429 Too Many Requests', 'bold')), profile);
    expect(html).toBe('Ответ <strong>429 Too Many Requests</strong>');
  });

  it('показывает подчёркивание, которого в Markdown нет вовсе', () => {
    expect(renderRich(doc(text('важно', 'underline')), profile)).toBe('<u>важно</u>');
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
    const html = renderRich(node, { ...profile, removeLinks: false });
    expect(html).toContain('<a href="https://example.test/doc"');
    expect(html).toContain('rel="noopener"');
  });

  it('не пропускает исполняемое содержимое', () => {
    const node: RichNode = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: '<script>alert(1)</script>' },
            {
              type: 'text',
              text: 'ссылка',
              marks: [{ type: 'link', attrs: { href: 'javascript:alert(1)' } }],
            },
          ],
        },
      ],
    };
    const html = renderRich(node, profile);
    expect(html).not.toContain('<script');
    expect(html).not.toContain('javascript:');
    expect(html).toContain('&lt;script&gt;');
  });

  it('неизвестное оформление показывается текстом, а не разметкой', () => {
    expect(renderRich(doc(text('текст', 'highlight')), profile)).toBe('текст');
  });
});

const stepData = (bodyJson?: RichNode): RawStepData => ({
  root: { children: [1] },
  scenarioSteps: { 1: { body: 'Отправить GET /v1/ping', bodyJson } },
});

describe('размеченный текст идёт вторым каналом', () => {
  it('плоские строки не меняются от наличия разметки', () => {
    const withRich = buildSteps([1], stepData(doc(text('Отправить GET /v1/ping'))), profile);
    const without = buildSteps([1], stepData(), profile);
    expect(withRich).toEqual(without);
    expect(without).toEqual(['1. Отправить GET /v1/ping']);
  });

  it('размеченный текст выровнен по строкам', () => {
    const built = buildStepsWithRich([1], stepData(doc(text('Отправить GET /v1/ping'))), profile);
    expect(built.lines).toHaveLength(built.rich.length);
    expect(built.rich[0]).not.toBeNull();
  });

  it('шаг без разметки даёт пустое место в канале', () => {
    const built = buildStepsWithRich([1], stepData(), profile);
    expect(built.rich).toEqual([null]);
  });
});

describe('сценарий в представлении', () => {
  it('берёт разметку, когда она есть', () => {
    const html = renderScenario(['1. Отправить GET /v1/ping'], profile, assets, [
      doc(text('Отправить '), text('GET /v1/ping', 'code')),
    ]);
    expect(html).toContain('<code>GET /v1/ping</code>');
  });

  it('без разметки показывает плоский текст, как раньше', () => {
    const plain = renderScenario(['1. Отправить GET /v1/ping'], profile, assets);
    const withNull = renderScenario(['1. Отправить GET /v1/ping'], profile, assets, [null]);
    expect(withNull).toBe(plain);
    expect(plain).toContain('Отправить GET /v1/ping');
  });
});
