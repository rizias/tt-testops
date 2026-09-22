import { describe, expect, it } from 'vitest';
import { renderBatchResolved } from '../src/contentResolver.js';
import type { RawCase, TestCase } from '../src/model.js';
import { defaultProfile } from '../src/profile.js';
import { renderCase } from '../src/render.js';

const tc = {
  id: '10001',
  name: 'Отображение баннера',
  projectId: 14,
  path: ['Раздел А', 'Раздел Б'],
  status: 'Active',
  automated: false,
  layer: 'Web',
  tags: ['Смоук'],
  links: ['https://tracker.example/A-1'],
  linkRefs: [{ name: 'Задача', url: 'https://tracker.example/A-1' }],
  issues: [],
  people: [],
  relatedCases: [],
  attributes: [{ name: 'Важность', value: 'P1' }],
  isLegacy: false,
  declaredManual: false,
  description: 'Описание кейса.',
  precondition: 'Предусловие кейса.',
  expectedResult: 'Баннер показан.',
  scenarioSource: 'newSteps',
  scenarioLines: ['1. Открыть страницу', '  1. Проскроллить вниз', '2. Закрыть баннер'],
  comments: [],
} as unknown as TestCase;

const GOLDEN = [
  '# **Отображение баннера** (ID: 10001)',
  '- **Путь:** `Раздел А` → `Раздел Б`',
  '- **Статус:** `Active`',
  '- **Тип:** `Ручной`',
  '- **Layer:** `Web`',
  '- **Важность:** `P1`',
  '- **Теги:** `Смоук`',
  '- **Ссылки:** [Задача](https://tracker.example/A-1)',
  '',
  '### Описание',
  'Описание кейса.',
  '',
  '### Предварительное условие',
  'Предусловие кейса.',
  '',
  '### Сценарий',
  '1. Открыть страницу',
  '  1. Проскроллить вниз',
  '2. Закрыть баннер',
  '',
  '### Ожидаемый результат',
  'Баннер показан.',
].join('\n');

describe('эталонный снимок Markdown', () => {
  it('вывод совпадает с замороженным образцом байт в байт', () => {
    expect(renderCase(tc, defaultProfile)).toBe(GOLDEN);
  });

  it('вложенность шага — два пробела на уровень', () => {
    const scenario = renderCase(tc, defaultProfile).split('### Сценарий\n')[1] ?? '';
    const nested = scenario.split('\n')[1] ?? '';
    expect(nested).toBe('  1. Проскроллить вниз');
  });

  it('служебных строк о версии контракта в потоке нет', () => {
    const out = renderCase(tc, defaultProfile);
    expect(out).not.toContain('contractVersion');
    expect(out).not.toContain(defaultProfile.contractVersion);
  });
});

const rawOf = (id: number, name: string): RawCase =>
  ({
    overview: {
      id,
      projectId: 14,
      name,
      status: { name: 'Active' },
      automated: false,
      hasManualScenario: true,
      customFields: [],
      tags: [],
      links: [],
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

describe('эталонный снимок пачки', () => {
  it('вывод двух кейсов совпадает с замороженным образцом байт в байт', async () => {
    const out = await renderBatchResolved(
      [rawOf(10001, 'Первый кейс'), rawOf(10002, 'Второй кейс')],
      defaultProfile,
      deps,
    );
    expect(out).toBe(
      [
        '### 📊 Сводка по запросу',
        '✅ Все кейсы в порядке.',
        '',
        '==============================',
        '',
        '# **Первый кейс** (ID: 10001)',
        '- **Статус:** `Active`',
        '- **Тип:** `Ручной`',
        '- **Layer:** `Не указан`',
        '',
        '### Сценарий',
        '1. Открыть страницу',
        '',
        '# **Второй кейс** (ID: 10002)',
        '- **Статус:** `Active`',
        '- **Тип:** `Ручной`',
        '- **Layer:** `Не указан`',
        '',
        '### Сценарий',
        '1. Открыть страницу',
        '',
      ].join('\n'),
    );
  });
});
