import { describe, expect, it } from 'vitest';
import type { TestCase } from '../src/model.js';
import { defaultProfile } from '../src/profile.js';
import { renderCase } from '../src/render.js';
import { stepsOf } from './scenarioFixtures.js';

describe('пометка старого формата в Markdown одна на оба источника', () => {
  const legacy = {
    id: '1',
    name: 'Кейс',
    path: [],
    status: 'Active',
    automated: false,
    layer: 'Web',
    tags: [],
    attachments: [],
    linkRefs: [],
    issues: [],
    people: [],
    relatedCases: [],
    comments: [],
    attributes: [],
    isLegacy: true,
    description: '',
    precondition: '',
    expectedResult: '',
    scenarioSource: 'inlineSteps',
    scenario: stepsOf('Шаг'),
    scenarioLines: ['1. Шаг'],
  } as unknown as TestCase;

  it('сценарий в старом редакторе — старый формат', () => {
    expect(renderCase(legacy, defaultProfile)).toContain('**Старый формат**');
  });

  it('customSteps.md на шаге кейса нового редактора — тот же старый формат', () => {
    const out = renderCase({ ...legacy, scenarioSource: 'newSteps' }, defaultProfile);
    expect(out).toContain('**Старый формат**');
  });

  it('с выключенными пометками не выводится ни одна', () => {
    const out = renderCase(legacy, { ...defaultProfile, showMarks: false });
    expect(out).not.toContain('формат**');
  });
});
