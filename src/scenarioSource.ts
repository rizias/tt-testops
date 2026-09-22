import type { RawScenario, RawScenarioStep } from './model.js';

export const CUSTOM_STEPS = 'customSteps.md';

function inSteps(steps: RawScenarioStep[]): number | null {
  for (const s of steps) {
    for (const a of s.attachments ?? [])
      if (a?.name === CUSTOM_STEPS && typeof a.id === 'number') return a.id;
    const deeper = inSteps(s.steps ?? []);
    if (deeper !== null) return deeper;
  }
  return null;
}

export function customStepsId(sc: RawScenario | undefined): number | null {
  if (!sc) return null;
  for (const a of sc.attachments ?? [])
    if (a?.name === CUSTOM_STEPS && typeof a.id === 'number') return a.id;
  return inSteps(sc.steps ?? []);
}
