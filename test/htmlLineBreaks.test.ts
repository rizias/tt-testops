import { describe, expect, it } from 'vitest';
import { renderCaseHtml } from '../src/html.js';
import type { EmbeddedAssets, HtmlCase } from '../src/html.js';
import type { TestCase } from '../src/model.js';
import { defaultProfile } from '../src/profile.js';

const assets: EmbeddedAssets = new Map();

const caseWith = (over: Partial<TestCase>): HtmlCase => ({
  tc: {
    id: '1',
    name: 'Кейс',
    projectId: 14,
    path: [],
    status: 'Active',
    automated: false,
    layer: '',
    tags: [],
    links: [],
    linkRefs: [],
    issues: [],
    people: [],
    relatedCases: [],
    attributes: [],
    comments: [],
    description: '',
    precondition: '',
    expectedResult: '',
    scenarioLines: ['1. Шаг'],
    scenarioSource: 'newSteps',
    isLegacy: false,
    ...over,
  } as unknown as TestCase,
  state: 'current',
});

describe('переносы строк в тексте кейса на странице', () => {
  it('строки, разделённые одиночным переносом, остаются отдельными строками', () => {
    const html = renderCaseHtml(
      caseWith({ expectedResult: 'Агентство: А\nФИО агента: Б\nТелефон агента: В' }),
      defaultProfile,
      assets,
    );
    expect(html).toMatch(/Агентство: А<br\s*\/?>\s*ФИО агента: Б<br\s*\/?>\s*Телефон агента: В/);
  });

  it('пустая строка между строками даёт два абзаца', () => {
    const html = renderCaseHtml(
      caseWith({ description: 'Первый абзац\n\nВторой абзац' }),
      defaultProfile,
      assets,
    );
    expect(html).toMatch(/<p>Первый абзац<\/p>\s*<p>Второй абзац<\/p>/);
  });

  it('перенос виден и в предусловии', () => {
    const html = renderCaseHtml(caseWith({ precondition: 'Роль: АА\nГород: МСК' }), defaultProfile, assets);
    expect(html).toMatch(/Роль: АА<br\s*\/?>\s*Город: МСК/);
  });
});

describe('метка состояния задачи', () => {
  const issue = (closed: boolean) => ({
    key: 'A-1',
    url: 'https://tracker.example/A-1',
    summary: 'Задача',
    status: 'Ready',
    closed,
  });
  const page = (closed: boolean): string =>
    renderCaseHtml(caseWith({ issues: [issue(closed)] } as Partial<TestCase>), defaultProfile, assets);

  it('закрытая задача — текст состояния как есть, на зелёной подложке', () => {
    expect(page(true)).toContain('<span class="pill pill_done">Ready</span>');
  });

  it('открытая задача — нейтральная метка', () => {
    expect(page(false)).toContain('<span class="pill">Ready</span>');
  });
});

describe('цвета метки закрытой задачи', () => {
  it('светлая тема: подложка #D3F1A7 и текст #4C6B1F, тёмная: #28311B и #B3DF72', async () => {
    const { STYLE } = await import('../src/htmlStyle.js');
    expect(STYLE).toContain('--done-bg:#D3F1A7; --done-ink:#4C6B1F;');
    expect(STYLE).toContain('--done-bg:#28311B; --done-ink:#B3DF72;');
  });

  it('метка не зачёркнута и не использует предупреждающие цвета', async () => {
    const { STYLE } = await import('../src/htmlStyle.js');
    const rule = STYLE.split('\n').find((line) => line.startsWith('.pill_done{')) ?? '';
    expect(rule).toBe('.pill_done{background:var(--done-bg); color:var(--done-ink)}');
  });
});
