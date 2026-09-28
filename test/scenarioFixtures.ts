import { scenarioHtml } from '../src/htmlRichSteps.js';
import type { RawStepData, Scenario, ScenarioStep } from '../src/model.js';
import type { FormatProfile } from '../src/profile.js';
import { scenarioLines } from '../src/scenarioMarkdown.js';
import { buildEditorSteps } from '../src/stepBuilder.js';

export const step = (text: string, fields: Partial<ScenarioStep> = {}): ScenarioStep => ({
  origin: 'editor',
  text,
  rich: null,
  shared: false,
  bare: false,
  extras: [],
  expected: null,
  children: [],
  ...fields,
});

export const stepsOf = (...steps: (string | ScenarioStep)[]): Scenario => ({
  kind: 'steps',
  steps: steps.map((s) => (typeof s === 'string' ? step(s) : s)),
});

export const editorLines = (
  ids: number[],
  data: RawStepData,
  profile: FormatProfile,
  expanded?: Map<number, string>,
): string[] =>
  scenarioLines(
    { kind: 'steps', steps: buildEditorSteps({ ...data, root: { children: ids } }, expanded) },
    profile,
  );

export const editorHtml = (
  ids: number[],
  data: RawStepData,
  profile: FormatProfile,
  expanded?: Map<number, string>,
): string =>
  scenarioHtml(
    { kind: 'steps', steps: buildEditorSteps({ ...data, root: { children: ids } }, expanded) },
    profile,
    new Map(),
  );
