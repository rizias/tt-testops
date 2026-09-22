import { describe, expect, it } from 'vitest';
import { type ResolveDeps, resolveScenario } from '../src/contentResolver.js';
import type { RawCase, TestCase } from '../src/model.js';
import { normalizeCase } from '../src/normalize.js';
import { defaultProfile } from '../src/profile.js';
import { renderCase } from '../src/render.js';
import { cleanText, collapseLines, toLf } from '../src/text.js';

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
    overview: { id: 1, projectId: 14, hasManualScenario: false, scenario },
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
    overview: { id: 30233, projectId: 14, hasManualScenario: false, scenario: { steps } },
    steps: null,
    comments: [],
  }) as unknown as RawCase;

describe('сценарий вложением customSteps.md', () => {
  it('вложение лежит в обзоре кейса, а не в шаге', async () => {
    const raw = caseWith({
      attachments: [{ id: 7, name: 'customSteps.md' }],
      steps: [],
    });

    const lines = await resolveScenario(raw, defaultProfile, deps({ 7: '1. Открыть страницу' }));

    expect(lines.join('\n')).toContain('1. Открыть страницу');
  });

  it('вложение лежит в единственном шаге', async () => {
    const raw = caseWith({
      attachments: [],
      steps: [{ name: 'шаг', attachments: [{ id: 8, name: 'customSteps.md' }] }],
    });

    const lines = await resolveScenario(raw, defaultProfile, deps({ 8: '1. Из шага' }));

    expect(lines.join('\n')).toContain('1. Из шага');
  });
});

describe('нормализация переводов строк', () => {
  it('CRLF и одиночный CR становятся LF', () => {
    expect(toLf('а\r\nб\rв')).toBe('а\nб\nв');
    expect(cleanText('а\r\nб', false)).toBe('а\nб');
  });

  it('перевод строки внутри текста шага схлопывается в один пробел', () => {
    expect(collapseLines('первая\nвторая')).toBe('первая вторая');
    expect(collapseLines('первая\r\n   вторая')).toBe('первая вторая');
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

  it('customSteps.md делает кейс сырым Markdown', () => {
    const tc = normalizeCase(
      oldCase({ steps: [], attachments: [{ id: 5, name: 'customSteps.md' }] }),
      defaultProfile,
    );
    expect(tc.scenarioSource).toBe('rawMarkdown');
  });

  it('обычные шаги без customSteps.md — встроенные шаги', () => {
    const tc = normalizeCase(oldCase({ steps: [{ name: 'Шаг' }] }), defaultProfile);
    expect(tc.scenarioSource).toBe('inlineSteps');
  });
});

describe('customSteps.md у объявленного ручным кейса', () => {
  it('находится в обзоре, а не только в шагах', async () => {
    const lines = await resolveScenario(
      {
        overview: {
          id: 1,
          projectId: 14,
          hasManualScenario: true,
          scenario: { steps: [], attachments: [{ id: 42, name: 'customSteps.md' }] },
        },
        steps: { root: { children: [] }, scenarioSteps: {}, attachments: {}, sharedSteps: {} },
        comments: [],
      } as unknown as RawCase,
      defaultProfile,
      { fetchAttachment: async () => '1. Настоящий сценарий', baseUrl: 'https://ts.example' },
    );
    expect(lines).toEqual(['1. Настоящий сценарий']);
  });
});

describe('сырой сценарий из customSteps.md', () => {
  it('разбит на строки, а не склеен в один пункт', async () => {
    const lines = await resolveScenario(
      {
        overview: {
          id: 1,
          projectId: 14,
          hasManualScenario: false,
          scenario: { steps: [], attachments: [{ id: 9, name: 'customSteps.md' }] },
        },
        steps: null,
        comments: [],
      } as unknown as RawCase,
      defaultProfile,
      {
        fetchAttachment: async () => '1. Первый шаг\n2. Второй шаг',
        baseUrl: 'https://ts.example',
      },
    );
    expect(lines).toEqual(['1. Первый шаг', '2. Второй шаг']);
  });
});

describe('ожидаемый результат в представлении', () => {
  it('выводится подписью, а не пунктом с номером', async () => {
    const { renderScenario } = await import('../src/htmlRich.js');
    const html = renderScenario(
      ['1. Открыть форму', '  **Ожидаемый результат**', '    1. Кнопка активна'],
      defaultProfile,
      new Map(),
    );
    expect(html).toContain('<div class="expLabel">Ожидаемый результат</div>');
    expect(html).toContain('<div class="expItem">Кнопка активна</div>');
    expect(html).not.toContain('<li><strong>Ожидаемый результат');
  });

  it('однострочная форма тоже становится подписью', async () => {
    const { renderScenario } = await import('../src/htmlRich.js');
    const html = renderScenario(
      ['1. Открыть форму', '  **Ожидаемый результат:** Кнопка активна'],
      defaultProfile,
      new Map(),
    );
    expect(html).toContain('<div class="expLabel">Ожидаемый результат</div>');
    expect(html).toContain('Кнопка активна');
    expect(html).not.toMatch(/<li>[^<]*<strong>Ожидаемый/);
  });

  it('обычные шаги остаются пунктами', async () => {
    const { renderScenario } = await import('../src/htmlRich.js');
    const html = renderScenario(['1. Первый', '2. Второй'], defaultProfile, new Map());
    expect((html.match(/<li>/g) ?? []).length).toBe(2);
  });
});

describe('customSteps.md лежит не в первом шаге', () => {
  it('всё равно находится и становится сценарием', async () => {
    const warns: string[] = [];
    const lines = await resolveScenario(
      legacyCase([
        { name: 'Обычный шаг' },
        { name: 'Вложенный', steps: [{ attachments: [{ id: 42, name: 'customSteps.md' }] }] },
      ]),
      defaultProfile,
      depsR5(async (id) => (id === 42 ? '1. Настоящий сценарий' : ''), warns),
    );
    expect(lines).toEqual(['1. Настоящий сценарий']);
  });
});

describe('перевод строки во встроенном тексте шага', () => {
  it('схлопывается в один пробел', async () => {
    const warns: string[] = [];
    const lines = await resolveScenario(
      legacyCase([{ name: 'Открыть форму\nи нажать «Сохранить»' }]),
      defaultProfile,
      depsR5(async () => '', warns),
    );
    expect(lines).toEqual(['1. Открыть форму и нажать «Сохранить»']);
  });
});

describe('слой кейса не указан', () => {
  it('в модели остаётся пустым', () => {
    const tc = normalizeCase(
      { overview: { id: 1, projectId: 14 }, steps: null, comments: [] } as unknown as RawCase,
      defaultProfile,
    );
    expect(tc.layer).toBe('');
  });

  it('в Markdown подпись отсутствия берётся из профиля', () => {
    const tc = {
      id: '1',
      name: 'Кейс',
      path: [],
      status: 'Active',
      automated: false,
      layer: '',
      tags: [],
      links: [],
      linkRefs: [],
      attributes: [],
      isLegacy: false,
      declaredManual: false,
      description: '',
      precondition: '',
      expectedResult: '',
      scenarioLines: ['1. Шаг'],
    } as unknown as TestCase;
    expect(renderCase(tc, defaultProfile)).toContain('- **Layer:** `Не указан`');
  });
});
