import { isLegacySource } from './audit.js';
import { collectStepAttachments, type TextOf } from './inlineContent.js';
import type {
  RawCase,
  RawScenarioStep,
  RawStepData,
  Scenario,
  ScenarioStep,
  StepExtra,
  TestCase,
} from './model.js';
import { normalizeCase } from './normalize.js';
import type { FormatProfile } from './profile.js';
import { scenarioLines, stepsHaveContent } from './scenarioMarkdown.js';
import { type ResolvedScenario, runOrEmpty, scenarioPlan } from './scenarioSource.js';
import { buildEditorSteps } from './stepBuilder.js';
import { ATTACHMENT_URL, toLf } from './text.js';
import type { ProjectTree } from './tree.js';

export interface ResolveDeps {
  fetchAttachment(attachmentId: number, shared?: boolean): Promise<string>;
  baseUrl: string;
  onWarn?: (message: string) => void;
}

export function absolutizeImages(text: string, baseUrl: string): string {
  const base = baseUrl.replace(/\/$/, '');
  return text.replace(ATTACHMENT_URL, (path, _id, offset: number) =>
    text.slice(Math.max(0, offset - base.length), offset) === base ? path : `${base}${path}`,
  );
}

function textOf(deps: ResolveDeps, caseId: string | number | undefined): TextOf {
  return async (attachmentId, shared) => {
    try {
      return toLf(await deps.fetchAttachment(attachmentId, shared));
    } catch (cause) {
      const detail = cause instanceof Error ? cause.message : String(cause);
      deps.onWarn?.(`кейс ${caseId ?? '?'}: вложение ${attachmentId} не скачалось — ${detail}`);
      return null;
    }
  };
}

const STEP_TEXT = /^(description|expected)/;

const alwaysExpanded = (att: { name?: string; contentType?: string }): boolean =>
  STEP_TEXT.test(att.name ?? '') || att.contentType === 'text/markdown';

function isStepText(att: { name?: string; contentType?: string }): boolean {
  if ((att.contentType ?? '').startsWith('text/')) return true;
  return STEP_TEXT.test(att.name ?? '');
}

async function prefetchTextAttachments(
  data: RawStepData,
  p: FormatProfile,
  text: TextOf,
): Promise<Map<number, string>> {
  const expanded = new Map<number, string>();
  const dicts: Array<
    [Record<string, { id?: number; name?: string; contentType?: string } | undefined>, boolean]
  > = [
    [data.attachments ?? {}, false],
    [data.sharedStepAttachments ?? {}, true],
  ];
  for (const [dict, shared] of dicts) {
    for (const att of Object.values(dict)) {
      if (!att || typeof att.id !== 'number') continue;
      if (!isStepText(att)) continue;
      if (!alwaysExpanded(att) && !p.steps.expandAttachments) continue;
      const body = await text(att.id, shared);
      if (body !== null) expanded.set(att.id, body);
    }
  }
  return expanded;
}

const absolutizeExtra = (extra: StepExtra, baseUrl: string): StepExtra => {
  if (extra.kind === 'lost') return extra;
  if (extra.kind === 'text') return { ...extra, text: absolutizeImages(extra.text, baseUrl) };
  return { ...extra, markdown: absolutizeImages(extra.markdown, baseUrl) };
};

function absolutizeStep(step: ScenarioStep, baseUrl: string): ScenarioStep {
  const expected = step.expected;
  return {
    ...step,
    text: absolutizeImages(step.text, baseUrl),
    extras: step.extras.map((extra) => absolutizeExtra(extra, baseUrl)),
    expected:
      expected?.kind === 'items'
        ? { kind: 'items', items: expected.items.map((item) => absolutizeStep(item, baseUrl)) }
        : expected && { ...expected, text: absolutizeImages(expected.text, baseUrl) },
    children: step.children.map((child) => absolutizeStep(child, baseUrl)),
  };
}

async function fileSteps(steps: RawScenarioStep[], baseUrl: string, text: TextOf): Promise<ScenarioStep[]> {
  const out: ScenarioStep[] = [];
  for (const s of steps) {
    const { desc, exp, docs, extras } = await collectStepAttachments(s, text);
    const own = toLf(`${s.keyword ?? ''}${s.name ?? ''}`);
    const expected = [s.expectedResult ?? '', ...exp]
      .map((part) => absolutizeImages(toLf(part), baseUrl))
      .filter((part) => part.trim())
      .join('\n\n');
    const texts = [...desc, ...docs].map((doc) => absolutizeImages(toLf(doc), baseUrl)).filter((t) => t.trim());
    const [first = '', ...under] = own.trim() ? ['', ...texts] : texts;
    const textExtras: StepExtra[] = under.map((body) => ({ kind: 'text', text: body }));
    out.push({
      origin: 'text',
      text: own.trim() ? own : first,
      rich: null,
      shared: false,
      bare: false,
      extras: [...textExtras, ...extras.map((extra) => absolutizeExtra(extra, baseUrl))],
      expected: expected ? { kind: 'text', text: expected, rich: null } : null,
      children: await fileSteps(s.steps ?? [], baseUrl, text),
    });
  }
  return out;
}

async function editorScenario(
  raw: RawCase,
  data: RawStepData,
  p: FormatProfile,
  deps: ResolveDeps,
  text: TextOf,
): Promise<ResolvedScenario> {
  const expanded = await prefetchTextAttachments(data, p, text);
  const steps = buildEditorSteps(data, expanded).map((step) => absolutizeStep(step, deps.baseUrl));
  const scenario: Scenario = { kind: 'steps', steps };
  return stepsHaveContent(steps) ? { source: 'newSteps', scenario } : runOrEmpty(raw);
}

export async function resolveScenarioModel(
  raw: RawCase,
  p: FormatProfile,
  deps: ResolveDeps,
): Promise<ResolvedScenario> {
  const text = textOf(deps, raw.overview.id);
  const plan = scenarioPlan(raw);
  if (plan.kind === 'editor') return editorScenario(raw, plan.data, p, deps, text);
  if (plan.kind === 'fetchError') {
    return { source: 'empty', scenario: { kind: 'empty', fetchError: true } };
  }
  if (plan.kind === 'inline') {
    const steps = await fileSteps(plan.steps, deps.baseUrl, text);
    return { source: 'inlineSteps', scenario: { kind: 'steps', steps } };
  }
  return runOrEmpty(raw);
}

export async function resolveToTestCase(
  raw: RawCase,
  p: FormatProfile,
  deps: ResolveDeps,
  tree: ProjectTree | null = null,
): Promise<TestCase> {
  const tc = normalizeCase(raw, p, tree);
  const { source, scenario } = await resolveScenarioModel(raw, p, deps);
  tc.scenarioSource = source;
  tc.isLegacy = isLegacySource(source, raw);
  tc.scenario = scenario;
  tc.scenarioLines = scenarioLines(scenario, p);
  tc.description = absolutizeImages(tc.description, deps.baseUrl);
  tc.precondition = absolutizeImages(tc.precondition, deps.baseUrl);
  tc.expectedResult = absolutizeImages(tc.expectedResult, deps.baseUrl);
  for (const comment of tc.comments) comment.body = absolutizeImages(comment.body, deps.baseUrl);
  return tc;
}
