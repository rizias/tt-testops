import type { RawRunStep, ScenarioStep } from './model.js';
import { toLf } from './text.js';

export function runSteps(steps: RawRunStep[]): ScenarioStep[] {
  return steps.map((s) => {
    const expected = (s.expectedResult ?? '').trim();
    return {
      origin: 'text',
      text: toLf(`${s.keyword ?? ''}${s.name ?? ''}`).trim(),
      rich: null,
      shared: false,
      bare: false,
      extras: [],
      expected: expected ? { kind: 'text', text: expected, rich: null } : null,
      children: runSteps(s.steps ?? []),
    };
  });
}
