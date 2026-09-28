import { describe, expect, it } from 'vitest';
import { type ResolveDeps, resolveToTestCase } from '../src/contentResolver.js';
import type { RawCase } from '../src/model.js';
import { defaultProfile } from '../src/profile.js';

const deps = (bodies: Record<number, string> = {}): ResolveDeps => ({
  baseUrl: 'https://ts.example',
  fetchAttachment: async (id) => {
    const body = bodies[id];
    if (body === undefined) throw new Error('нет вложения');
    return body;
  },
});

const md = (id: number, name: string) => ({ id, name, contentType: 'text/markdown' });

const legacyCase = (steps: unknown[]): RawCase =>
  ({
    overview: { id: 2, name: 'Кейс', hasManualScenario: false, scenario: { attachments: [], steps } },
    steps: null,
  }) as unknown as RawCase;

const editorCase = (steps: Record<string, unknown>, children: number[]): RawCase =>
  ({
    overview: { id: 1, name: 'Кейс', hasManualScenario: true, scenario: { steps: [] } },
    steps: { root: { children }, scenarioSteps: steps, attachments: {} },
  }) as unknown as RawCase;

describe('Markdown 2.0: текст шага', () => {
  it('абзацы шага нового редактора идут как пришли, пустая строка сохраняется', async () => {
    const raw = editorCase(
      { 1: { body: 'Родитель', children: [2] }, 2: { body: 'Первый абзац\nВторой абзац\n\nТретий абзац' } },
      [1],
    );
    const tc = await resolveToTestCase(raw, defaultProfile, deps());
    expect(tc.scenarioLines).toEqual([
      '1. Родитель',
      '',
      '    1. Первый абзац',
      '       Второй абзац',
      '',
      '       Третий абзац',
    ]);
  });

  it('описание списком идёт под именем шага, как в TestOps', async () => {
    const raw = legacyCase([{ name: 'Step 0', attachments: [md(1, 'description_0.md')] }]);
    const tc = await resolveToTestCase(raw, defaultProfile, deps({ 1: '- пункт один\n- пункт два' }));
    expect(tc.scenarioLines).toEqual(['1. Step 0', '   - пункт один', '   - пункт два']);
  });

  it('вложенный пункт списка в описании сохраняет свой отступ', async () => {
    const raw = legacyCase([{ name: 'Step 0', attachments: [md(1, 'description_0.md')] }]);
    const text = '1. Открыть\n    - вложенный пункт\n2. Закрыть';
    const tc = await resolveToTestCase(raw, defaultProfile, deps({ 1: text }));
    expect(tc.scenarioLines).toEqual([
      '1. Step 0',
      '   1. Открыть',
      '       - вложенный пункт',
      '   2. Закрыть',
    ]);
  });

  it('файл-вложение шага выводится строкой-ссылкой под текстом', async () => {
    const raw = legacyCase([
      { name: 'Выгрузить отчёт', attachments: [{ id: 7, name: 'отчёт.xlsx', contentType: 'application/zip' }] },
    ]);
    const tc = await resolveToTestCase(raw, defaultProfile, deps());
    expect(tc.scenarioLines).toEqual([
      '1. Выгрузить отчёт',
      '   [отчёт.xlsx](https://ts.example/api/testcase/attachment/7/content)',
    ]);
  });
});
