import type { RawCase, RawStepData, ScenarioSource, TestCase } from './model.js';

function hasCustomStepsMarkdown(data: RawStepData | null | undefined): boolean {
  if (!data) return false;
  return Object.values(data.attachments ?? {}).some((a) => a?.name === 'customSteps.md');
}

export const isLegacySource = (source: ScenarioSource, raw: RawCase): boolean =>
  source === 'inlineSteps' || hasCustomStepsMarkdown(raw.steps);

export interface AuditFinding {
  ruleId: 'emptyScenario' | 'oldRawMarkdown';
  severity: 'warning' | 'error';
  message: string;
  caseId: string;
}

const RULES: Record<'empty' | 'oldFormat', Omit<AuditFinding, 'caseId'>> = {
  empty: { ruleId: 'emptyScenario', severity: 'warning', message: 'Пустой сценарий' },
  oldFormat: { ruleId: 'oldRawMarkdown', severity: 'error', message: 'Старый формат (Raw Markdown)' },
};

export type ScenarioState = 'current' | 'oldFormat' | 'empty';

export function scenarioStateOf(tc: TestCase, raw: RawCase): ScenarioState {
  if (tc.scenarioSource === 'empty' || tc.scenarioSource === 'autotestRun') return 'empty';
  return isLegacySource(tc.scenarioSource, raw) ? 'oldFormat' : 'current';
}

export function auditCase(tc: TestCase, raw: RawCase): AuditFinding[] {
  const state = scenarioStateOf(tc, raw);
  return state === 'current' ? [] : [{ ...RULES[state], caseId: tc.id }];
}
