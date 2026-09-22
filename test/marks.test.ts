import { describe, expect, it } from 'vitest';
import type { RawCase, TestCase } from '../src/model.js';
import { defaultProfile } from '../src/profile.js';
import { renderBatch, renderCase } from '../src/render.js';

const legacyCase = {
  id: '1',
  name: 'Кейс',
  path: [],
  status: 'Active',
  type: '',
  layer: 'Web',
  tags: [],
  links: [],
  linkRefs: [],
  issues: [],
  people: [],
  relatedCases: [],
  attributes: [],
  description: 'Описание',
  precondition: '',
  scenarioLines: ['1. Шаг один', '2. Шаг два'],
  expectedResult: 'Результат',
  scenarioSource: 'rawMarkdown',
  automated: false,
  isLegacy: true,
  declaredManual: false,
} as unknown as TestCase;

const marksOff = { ...defaultProfile, showMarks: false };

describe('marks can be turned off without touching the data', () => {
  it('drops the legacy banner', () => {
    expect(renderCase(legacyCase, defaultProfile)).toContain(defaultProfile.legacyBanner);
    expect(renderCase(legacyCase, marksOff)).not.toContain(defaultProfile.legacyBanner);
  });

  it('keeps every section and step in place', () => {
    const off = renderCase(legacyCase, marksOff);
    expect(off).toContain(defaultProfile.sections.description);
    expect(off).toContain(defaultProfile.sections.scenario);
    expect(off).toContain(defaultProfile.sections.expectedResult);
    expect(off).toContain('1. Шаг один');
    expect(off).toContain('2. Шаг два');
  });

  it('changes nothing but the banner', () => {
    const on = renderCase(legacyCase, defaultProfile).split('\n');
    const off = renderCase(legacyCase, marksOff).split('\n');

    expect(on.filter((l) => l !== defaultProfile.legacyBanner && l !== '')).toEqual(
      off.filter((l) => l !== ''),
    );
  });

  it('marks are on by default', () => {
    expect(defaultProfile.showMarks).toBe(true);
  });
});

const rawEmpty: RawCase = {
  overview: { id: 42, name: 'Пустой', hasManualScenario: false },
  steps: null,
} as unknown as RawCase;

describe('batch summary is a list of marks', () => {
  it('is printed when marks are on', () => {
    expect(renderBatch([rawEmpty], defaultProfile, 'https://x.test')).toContain(
      defaultProfile.batch.summaryHeading,
    );
  });

  it('is gone when marks are off, cases stay', () => {
    const off = renderBatch([rawEmpty], marksOff, 'https://x.test');
    expect(off).not.toContain(defaultProfile.batch.summaryHeading);
    expect(off).not.toContain(defaultProfile.batch.divider);
    expect(off).toContain('Пустой');
  });

  it('keeps the frozen "Нет шагов" literal with marks off', () => {
    expect(renderBatch([rawEmpty], marksOff, 'https://x.test')).toContain('Нет шагов');
  });
});
