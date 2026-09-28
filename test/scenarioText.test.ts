import { describe, expect, it } from 'vitest';
import { type ResolveDeps, resolveToTestCase } from '../src/contentResolver.js';
import type { RawCase, TestCase } from '../src/model.js';
import { normalizeCase } from '../src/normalize.js';
import { defaultProfile, type FormatProfile } from '../src/profile.js';
import { renderCase } from '../src/render.js';
import { cleanText, toLf } from '../src/text.js';
import { step, stepsOf } from './scenarioFixtures.js';

const resolveScenario = async (raw: RawCase, p: FormatProfile, deps: ResolveDeps) =>
  (await resolveToTestCase(raw, p, deps)).scenarioLines;

const deps = (bodies: Record<number, string> = {}): ResolveDeps => ({
  fetchAttachment: async (id) => bodies[id] ?? '',
  baseUrl: 'https://ts.example',
});

const caseWith = (scenario: unknown): RawCase =>
  ({
    overview: { id: 1, name: 'Кейс', hasManualScenario: false, scenario },
    steps: null,
  }) as unknown as RawCase;

const oldCase = (scenario: unknown): RawCase =>
  ({
    overview: { id: 1, projectId: 1, hasManualScenario: false, scenario },
    steps: null,
    comments: [],
  }) as unknown as RawCase;

const depsR5 = (fetchAttachment: (id: number) => Promise<string>, warns: string[]) => ({
  fetchAttachment,
  baseUrl: 'https://ts.example',
  onWarn: (m: string) => warns.push(m),
});

const legacyCase = (steps: unknown): RawCase =>
  ({
    overview: { id: 30233, projectId: 1, hasManualScenario: false, scenario: { steps } },
    steps: null,
    comments: [],
  }) as unknown as RawCase;

describe('сценарий вложением customSteps.md', () => {
  it('вложение лежит в единственном шаге', async () => {
    const raw = caseWith({
      attachments: [],
      steps: [{ name: 'шаг', attachments: [{ id: 8, name: 'customSteps.md', contentType: 'text/markdown' }] }],
    });

    const lines = await resolveScenario(raw, defaultProfile, deps({ 8: '1. Из шага' }));

    expect(lines).toEqual(['1. шаг', '   1. Из шага']);
  });
});

describe('нормализация переводов строк', () => {
  it('CRLF и одиночный CR становятся LF', () => {
    expect(toLf('а\r\nб\rв')).toBe('а\nб\nв');
    expect(cleanText('а\r\nб')).toBe('а\nб');
  });
});

describe('источник сценария старого кейса', () => {
  it('постороннее вложение не делает кейс сырым Markdown', () => {
    const tc = normalizeCase(
      oldCase({ steps: [], attachments: [{ id: 5, name: 'скриншот.png' }] }),
      defaultProfile,
    );
    expect(tc.scenarioSource).toBe('empty');
    expect(tc.isLegacy).toBe(false);
  });

  it('обычные шаги без customSteps.md — встроенные шаги', () => {
    const tc = normalizeCase(oldCase({ steps: [{ name: 'Шаг' }] }), defaultProfile);
    expect(tc.scenarioSource).toBe('inlineSteps');
  });
});

describe('ожидаемый результат в представлении', () => {
  it('выводится подписью, а не пунктом с номером', async () => {
    const { scenarioHtml } = await import('../src/htmlRichSteps.js');
    const expected = { kind: 'items' as const, items: [step('Кнопка активна')] };
    const html = scenarioHtml(stepsOf(step('Открыть форму', { expected })), defaultProfile, new Map());
    expect(html).toContain('<div class="expLabel">Ожидаемый результат</div>');
    expect(html).toContain('<ol class="expList"><li data-n="1.">Кнопка активна</li></ol>');
    expect(html).not.toContain('<li><strong>Ожидаемый результат');
  });

  it('однострочная форма тоже становится подписью', async () => {
    const { scenarioHtml } = await import('../src/htmlRichSteps.js');
    const expected = { kind: 'text' as const, text: 'Кнопка активна', rich: null };
    const html = scenarioHtml(stepsOf(step('Открыть форму', { expected })), defaultProfile, new Map());
    expect(html).toContain('<div class="expLabel">Ожидаемый результат</div>');
    expect(html).toContain('Кнопка активна');
    expect(html).not.toMatch(/<li>[^<]*<strong>Ожидаемый/);
  });

  it('обычные шаги остаются пунктами', async () => {
    const { scenarioHtml } = await import('../src/htmlRichSteps.js');
    const html = scenarioHtml(stepsOf('Первый', 'Второй'), defaultProfile, new Map());
    expect(html).toBe('<ol class="steps"><li data-n="1.">Первый</li><li data-n="2.">Второй</li></ol>');
  });
});

describe('customSteps.md лежит на вложенном шаге', () => {
  it('его текст выводится внутри этого шага, остальные шаги на месте', async () => {
    const warns: string[] = [];
    const lines = await resolveScenario(
      legacyCase([
        { name: 'Обычный шаг' },
        { name: 'Вложенный', steps: [{ attachments: [{ id: 42, name: 'customSteps.md', contentType: 'text/markdown' }] }] },
      ]),
      defaultProfile,
      depsR5(async (id) => (id === 42 ? '1. Настоящий сценарий' : ''), warns),
    );
    expect(lines).toEqual([
      '1. Обычный шаг',
      '2. Вложенный',
      '',
      '    1. 1. Настоящий сценарий',
    ]);
  });
});

describe('перевод строки во встроенном тексте шага', () => {
  it('сохраняется: вторая строка идёт с отступом шага плюс ширина номера', async () => {
    const warns: string[] = [];
    const lines = await resolveScenario(
      legacyCase([{ name: 'Открыть форму\r\nи нажать «Сохранить»' }]),
      defaultProfile,
      depsR5(async () => '', warns),
    );
    expect(lines).toEqual(['1. Открыть форму', '   и нажать «Сохранить»']);
  });
});

describe('слой кейса не указан', () => {
  it('в модели остаётся пустым', () => {
    const tc = normalizeCase(
      { overview: { id: 1, projectId: 1 }, steps: null, comments: [] } as unknown as RawCase,
      defaultProfile,
    );
    expect(tc.layer).toBe('');
  });

  it('в Markdown строка слоя без значения опускается', () => {
    const tc = {
      id: '1',
      name: 'Кейс',
      path: [],
      status: 'Active',
      automated: false,
      layer: '',
      tags: [],
      attachments: [],
      linkRefs: [],
      issues: [],
      people: [],
      relatedCases: [],
      comments: [],
      attributes: [],
      isLegacy: false,
      description: '',
      precondition: '',
      expectedResult: '',
      scenario: stepsOf('Шаг'),
      scenarioLines: ['1. Шаг'],
    } as unknown as TestCase;
    expect(renderCase(tc, defaultProfile)).not.toContain('**Слой:**');
  });
});
