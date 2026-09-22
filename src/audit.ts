import type { RawCase, TestCase } from './model.js';

export type AuditRuleId = 'fakeNewFormat' | 'emptyScenario' | 'oldRawMarkdown';

export interface AuditFinding {
  ruleId: AuditRuleId;
  severity: 'warning' | 'error';
  message: string;
  caseId: string;
}

export interface AuditRules {
  fakeNewFormat: { enabled: boolean; severity: 'warning' | 'error'; message: string };
  emptyScenario: { enabled: boolean; severity: 'warning' | 'error'; message: string };
  oldRawMarkdown: { enabled: boolean; severity: 'warning' | 'error'; message: string };
}

export const defaultAuditRules: AuditRules = {
  fakeNewFormat: { enabled: true, severity: 'warning', message: 'Обнови до актуального сценария' },
  emptyScenario: { enabled: true, severity: 'warning', message: 'Пустой сценарий' },
  oldRawMarkdown: { enabled: true, severity: 'error', message: 'Старый формат (Raw Markdown)' },
};

export type ScenarioState = 'current' | 'oldFormat' | 'inconsistentFormat' | 'empty';

export function scenarioStateOf(tc: TestCase, raw: RawCase): ScenarioState {
  if (tc.scenarioSource === 'empty') return 'empty';
  const manual = !!raw.overview.hasManualScenario;
  if (tc.scenarioSource === 'rawMarkdown') return manual ? 'inconsistentFormat' : 'oldFormat';
  if (tc.scenarioSource === 'inlineSteps' && !manual) return 'oldFormat';
  return 'current';
}

export function auditCase(
  tc: TestCase,
  raw: RawCase,
  rules: AuditRules = defaultAuditRules,
): AuditFinding[] {
  const out: AuditFinding[] = [];
  const id = tc.id;
  const manual = !!raw.overview.hasManualScenario;
  const add = (ruleId: AuditRuleId) => {
    const r = rules[ruleId];
    if (r.enabled) out.push({ ruleId, severity: r.severity, message: r.message, caseId: id });
  };

  if (manual && tc.scenarioSource === 'rawMarkdown') add('fakeNewFormat');
  else if (tc.scenarioSource === 'empty') add('emptyScenario');
  else if (!manual && (tc.scenarioSource === 'rawMarkdown' || tc.scenarioSource === 'inlineSteps'))
    add('oldRawMarkdown');

  return out;
}
