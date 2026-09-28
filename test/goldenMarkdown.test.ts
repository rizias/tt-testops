import { describe, expect, it } from 'vitest';
import { resolveToTestCase } from '../src/contentResolver.js';
import type { RawCase, TestCase } from '../src/model.js';
import { defaultProfile } from '../src/profile.js';
import { renderBatch, renderCase } from '../src/render.js';
import { step, stepsOf } from './scenarioFixtures.js';

const tc = {
  id: '10001',
  name: 'Отображение баннера',
  projectId: 1,
  path: ['Раздел А', 'Раздел Б'],
  status: 'Active',
  automated: false,
  layer: 'Web',
  tags: ['Смоук'],
  attachments: [],
  linkRefs: [{ name: 'Задача', url: 'https://tracker.example/A-1' }],
  issues: [],
  people: [],
  relatedCases: [],
  attributes: [{ name: 'Важность', value: 'P1' }],
  isLegacy: false,
  description: 'Описание кейса.',
  precondition: 'Предусловие кейса.',
  expectedResult: 'Баннер показан.',
  scenarioSource: 'newSteps',
  scenario: stepsOf(step('Открыть страницу', { children: [step('Проскроллить вниз')] }), 'Закрыть баннер'),
  scenarioLines: ['1. Открыть страницу', '', '    1. Проскроллить вниз', '2. Закрыть баннер'],
  comments: [],
} as unknown as TestCase;

const GOLDEN = [
  '# **Отображение баннера** (ID: 10001)',
  '- **Проект:** `1`',
  '- **Путь:** `Раздел А` → `Раздел Б`',
  '- **Статус:** `Active`',
  '- **Слой:** `Web`',
  '- **Тип:** `Ручной`',
  '- **Ссылки:** [Задача](https://tracker.example/A-1)',
  '- **Теги:** `Смоук`',
  '- **Важность:** `P1`',
  '',
  '### Описание',
  'Описание кейса.',
  '',
  '### Предварительное условие',
  'Предусловие кейса.',
  '',
  '### Сценарий',
  '1. Открыть страницу',
  '',
  '    1. Проскроллить вниз',
  '2. Закрыть баннер',
  '',
  '### Ожидаемый результат',
  'Баннер показан.',
].join('\n');

const GOLDEN_WITH_ADDRESS = [
  '# **Отображение баннера** (ID: 10001)',
  '- **Адрес в TestOps:** <https://ts.example/project/1/test-cases/10001>',
  ...GOLDEN.split('\n').slice(1),
].join('\n');

describe('снимок вывода Markdown', () => {
  it('вывод совпадает с замороженным образцом байт в байт — без адреса сервера (renderCase без baseUrl)', () => {
    expect(renderCase(tc, defaultProfile)).toBe(GOLDEN);
  });

  it('реальный вывод CLI с адресом сервера: строка адреса — первая под шапкой, автоссылка', () => {
    expect(renderCase(tc, defaultProfile, [], 'https://ts.example')).toBe(GOLDEN_WITH_ADDRESS);
  });

  it('строка адреса остаётся первой и перед баннером старого формата', () => {
    const legacy = { ...tc, isLegacy: true, scenarioSource: 'inlineSteps' } as unknown as TestCase;
    const out = renderCase(legacy, defaultProfile, [], 'https://ts.example').split('\n');
    expect(out[0]).toBe('# **Отображение баннера** (ID: 10001)');
    expect(out[1]).toBe('- **Адрес в TestOps:** <https://ts.example/project/1/test-cases/10001>');
    expect(out.findIndex((l) => l.includes('Старый формат'))).toBeGreaterThan(1);
  });

  it('вложенность шага — 4 пробела на уровень', () => {
    const scenario = renderCase(tc, defaultProfile).split('### Сценарий\n')[1] ?? '';
    const nested = scenario.split('\n')[2] ?? '';
    expect(nested).toBe('    1. Проскроллить вниз');
  });

});

const rawOf = (id: number, name: string): RawCase =>
  ({
    overview: {
      id,
      projectId: 1,
      name,
      status: { name: 'Active' },
      automated: false,
      hasManualScenario: true,
      customFields: [],
      tags: [],
      attachments: [],
      members: [],
    },
    steps: {
      root: { children: [1] },
      scenarioSteps: { 1: { body: 'Открыть страницу' } },
      attachments: {},
      sharedSteps: {},
    },
    comments: [],
    relations: [],
  }) as unknown as RawCase;

const deps = { fetchAttachment: async () => '', baseUrl: 'https://ts.example' };

describe('снимок вывода пачки', () => {
  it('вывод двух кейсов совпадает с замороженным образцом байт в байт', async () => {
    const cases = [rawOf(10001, 'Первый кейс'), rawOf(10002, 'Второй кейс')];
    const resolved = await Promise.all(
      cases.map((raw) => resolveToTestCase(raw, defaultProfile, deps)),
    );
    const out = renderBatch(cases, defaultProfile, deps.baseUrl, resolved, () => null, {});
    expect(out).toBe(
      [
        '### 📊 Сводка по запросу',
        '✅ Все кейсы в порядке.',
        '',
        '==============================',
        '',
        '# **Первый кейс** (ID: 10001)',
        '- **Адрес в TestOps:** <https://ts.example/project/1/test-cases/10001>',
        '- **Проект:** `1`',
        '- **Статус:** `Active`',
        '- **Тип:** `Ручной`',
        '',
        '### Сценарий',
        '1. Открыть страницу',
        '',
        '# **Второй кейс** (ID: 10002)',
        '- **Адрес в TestOps:** <https://ts.example/project/1/test-cases/10002>',
        '- **Проект:** `1`',
        '- **Статус:** `Active`',
        '- **Тип:** `Ручной`',
        '',
        '### Сценарий',
        '1. Открыть страницу',
        '',
      ].join('\n'),
    );
  });
});
