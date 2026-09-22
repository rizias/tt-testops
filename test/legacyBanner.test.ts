import { describe, expect, it } from 'vitest';
import type { TestCase } from '../src/model.js';
import { defaultProfile } from '../src/profile.js';
import { renderCase } from '../src/render.js';

describe('пометка в Markdown различает два старых состояния', () => {
  const legacy = {
    id: '1',
    name: 'Кейс',
    path: [],
    status: 'Active',
    automated: false,
    layer: 'Web',
    tags: [],
    links: [],
    linkRefs: [],
    attributes: [],
    isLegacy: true,
    declaredManual: false,
    description: '',
    precondition: '',
    expectedResult: '',
    scenarioSource: 'rawMarkdown',
    scenarioLines: ['1. Шаг'],
  } as unknown as TestCase;

  it('кейс не объявлен ручным — старый формат', () => {
    expect(renderCase(legacy, defaultProfile)).toContain('**Старый формат**');
  });

  it('кейс объявлен ручным, а сценарий сырой — несогласованный формат', () => {
    const out = renderCase({ ...legacy, declaredManual: true }, defaultProfile);
    expect(out).toContain('**Несогласованный формат**');
    expect(out).not.toContain('**Старый формат**');
  });

  it('с выключенными пометками не выводится ни одна', () => {
    const out = renderCase(
      { ...legacy, declaredManual: true },
      {
        ...defaultProfile,
        showMarks: false,
      },
    );
    expect(out).not.toContain('формат**');
  });
});
