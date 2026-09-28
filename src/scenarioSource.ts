import type {
  RawCase,
  RawOverview,
  RawScenarioStep,
  RawStepData,
  Scenario,
  ScenarioSource,
} from './model.js';
import { runSteps } from './runScenario.js';
import { stepsHaveContent } from './scenarioMarkdown.js';
import { buildEditorSteps } from './stepBuilder.js';

export function ownScenarioEmpty(overview: RawOverview, steps: RawStepData | null): boolean {
  const scenario = overview.scenario ?? {};
  if (overview.hasManualScenario) {
    if (!steps) return false;
    return !stepsHaveContent(buildEditorSteps(steps));
  }
  return (scenario.steps?.length ?? 0) === 0;
}

export type ScenarioPlan =
  | { kind: 'editor'; data: RawStepData }
  | { kind: 'inline'; steps: RawScenarioStep[] }
  | { kind: 'fetchError' }
  | { kind: 'none' };

export interface ResolvedScenario {
  source: ScenarioSource;
  scenario: Scenario;
}

export function scenarioPlan(raw: RawCase): ScenarioPlan {
  const ov = raw.overview;
  const sc = ov.scenario ?? {};
  if (ov.hasManualScenario) {
    const data = raw.steps ?? null;
    return data ? { kind: 'editor', data } : { kind: 'fetchError' };
  }
  const steps = sc.steps ?? [];
  return steps.length ? { kind: 'inline', steps } : { kind: 'none' };
}

export function runOrEmpty(raw: RawCase): ResolvedScenario {
  const steps = raw.runScenario?.steps ?? [];
  return steps.length
    ? { source: 'autotestRun', scenario: { kind: 'autotest', steps: runSteps(steps) } }
    : { source: 'empty', scenario: { kind: 'empty', fetchError: false } };
}
