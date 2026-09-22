import { describe, expect, it } from 'vitest';
import { scenarioStateOf } from '../src/audit.js';
import { toJson } from '../src/json.js';
import type { RawCase, ScenarioSource, TestCase } from '../src/model.js';

const testCase = (scenarioSource: ScenarioSource): TestCase =>
  ({
    id: '1',
    name: 'X',
    path: [],
    status: 'Active',
    type: '',
    layer: '',
    tags: [],
    links: [],
    linkRefs: [],
    issues: [],
    people: [],
    relatedCases: [],
    attributes: [],
    description: '',
    precondition: '',
    steps: [],
    expectedResult: '',
    scenarioSource,
  }) as unknown as TestCase;

const rawCase = (hasManualScenario: boolean): RawCase =>
  ({ overview: { id: 1, name: 'X', hasManualScenario }, steps: null }) as unknown as RawCase;

describe('scenarioStateOf', () => {
  it('structured steps -> current format', () => {
    expect(scenarioStateOf(testCase('newSteps'), rawCase(true))).toBe('current');
  });

  it('raw markdown on a case not declared manual -> old format', () => {
    expect(scenarioStateOf(testCase('rawMarkdown'), rawCase(false))).toBe('oldFormat');
  });

  it('inline steps on a case not declared manual -> old format', () => {
    expect(scenarioStateOf(testCase('inlineSteps'), rawCase(false))).toBe('oldFormat');
  });

  it('raw markdown on a case declared manual -> inconsistent format', () => {
    expect(scenarioStateOf(testCase('rawMarkdown'), rawCase(true))).toBe('inconsistentFormat');
  });

  it('no scenario at all -> empty', () => {
    expect(scenarioStateOf(testCase('empty'), rawCase(true))).toBe('empty');
    expect(scenarioStateOf(testCase('empty'), rawCase(false))).toBe('empty');
  });

  it('marks every non-current state as needing a rewrite', () => {
    const states = [
      scenarioStateOf(testCase('rawMarkdown'), rawCase(false)),
      scenarioStateOf(testCase('rawMarkdown'), rawCase(true)),
      scenarioStateOf(testCase('empty'), rawCase(true)),
    ];
    expect(states.every((s) => s !== 'current')).toBe(true);
  });
});

describe('scenario state in the structured output', () => {
  it('is its own field', () => {
    const json = toJson(testCase('rawMarkdown'), 'oldFormat');
    expect(json.scenarioState).toBe('oldFormat');
  });

  it('leaves the existing fields in place', () => {
    const json = toJson(testCase('newSteps'), 'current');
    expect(json.id).toBe('1');
    expect(json.scenarioSource).toBe('newSteps');
    expect(json.fields).toBeDefined();
  });
});
