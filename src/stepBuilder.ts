import type { RawStepData, RawStepNode, RichNode } from './model.js';
import type { FormatProfile } from './profile.js';
import { cleanText, collapseLines } from './text.js';

const EXPECTED_HEADERS = new Set(['Expected Result', 'Expected result']);

export function isFakeNewFormat(data: RawStepData | null): boolean {
  if (!data) return false;
  const children = data.root?.children ?? [];
  if (children.length !== 1) return false;
  const first = data.scenarioSteps?.[String(children[0])];
  if (first?.body !== 'Scenario') return false;
  return Object.values(data.attachments ?? {}).some((a) => a?.name === 'customSteps.md');
}

export const stepMarker = (profile: FormatProfile, n: number): string =>
  profile.steps.numbered ? `${n}. ` : '- ';

function attachmentLine(step: RawStepNode, data: RawStepData, shared = false): string | null {
  if (step.attachmentId === undefined) return null;
  const att = data.attachments?.[String(step.attachmentId)];
  if (!att || typeof att.id !== 'number') return null;
  const img = (att.contentType ?? '').startsWith('image/');
  const kind = shared ? 'sharedstep' : 'testcase';
  return `${img ? '!' : ''}[${att.name ?? 'attachment'}](/api/${kind}/attachment/${att.id}/content)`;
}

function attachmentContent(
  step: RawStepNode,
  data: RawStepData,
  expanded: Map<number, string> | undefined,
): string[] {
  if (!expanded || step.attachmentId === undefined) return [];
  const att = data.attachments?.[String(step.attachmentId)];
  const content = att && typeof att.id === 'number' ? expanded.get(att.id) : undefined;
  if (!content) return [];
  return content
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
}

export interface BuiltSteps {
  lines: string[];

  rich: (RichNode | null)[];
}

export function buildSteps(
  stepIds: (string | number)[],
  data: RawStepData,
  profile: FormatProfile,
  level = 0,
  expanded?: Map<number, string>,
): string[] {
  return buildStepsWithRich(stepIds, data, profile, level, expanded).lines;
}

interface Walk {
  data: RawStepData;
  profile: FormatProfile;
  expanded?: Map<number, string>;
  shared: boolean;
  lines: string[];
  rich: (RichNode | null)[];
}

const push = (w: Walk, line: string, doc: RichNode | null = null): void => {
  w.lines.push(line);
  w.rich.push(doc);
};

const pushAll = (w: Walk, built: BuiltSteps): void => {
  w.lines.push(...built.lines);
  w.rich.push(...built.rich);
};

const isExpectedBlock = (node: RawStepNode | undefined): boolean =>
  !!node && !!node.body && EXPECTED_HEADERS.has(node.body) && (node.children?.length ?? 0) > 0;

function emitNode(w: Walk, node: RawStepNode, at: string, n: number, trim: boolean): number {
  const raw = cleanText(node.body ?? '', w.profile.removeLinks);
  const text = trim ? raw.trim() : collapseLines(raw);
  const attLine = attachmentLine(node, w.data, w.shared);
  if (!text && !attLine) return n;
  const next = n + 1;
  const cont = w.profile.steps.indent;
  if (text) {
    push(w, `${at}${stepMarker(w.profile, next)}${text}`, node.bodyJson ?? null);
    if (attLine) push(w, `${at}${cont}${attLine}`);
  } else if (attLine) {
    push(w, `${at}${stepMarker(w.profile, next)}${attLine}`);
  }
  for (const l of attachmentContent(node, w.data, w.expanded)) push(w, `${at}${cont}${l}`);
  return next;
}

function emitSharedStep(w: Walk, step: RawStepNode, indent: string, level: number, n: number): number {
  const shared = w.data.sharedSteps?.[String(step.sharedStepId)];
  if (!shared) return n;
  const next = n + 1;
  push(
    w,
    `${indent}${stepMarker(w.profile, next)}${w.profile.steps.sharedStep.replace('{name}', shared.body ?? '')}`,
  );
  const fake: RawStepData = {
    ...w.data,
    scenarioSteps: w.data.sharedStepScenarioSteps ?? {},
    attachments: w.data.sharedStepAttachments ?? w.data.attachments,
  };
  pushAll(w, buildStepsWithRich(shared.children ?? [], fake, w.profile, level + 1, w.expanded, true));
  return next;
}

function emitExpectedBlock(w: Walk, exp: RawStepNode, indent: string): void {
  const cont = w.profile.steps.indent;
  push(w, `${indent}${cont}${w.profile.steps.expectedBlock}`);
  const childIndent = `${indent}${cont}${cont}`;
  let m = 0;
  for (const cid of exp.children ?? []) {
    const child = w.data.scenarioSteps?.[String(cid)];
    if (child) m = emitNode(w, child, childIndent, m, true);
  }
}

function emitExpectedInline(w: Walk, exp: RawStepNode, indent: string): void {
  const fromFile = attachmentContent(exp, w.data, w.expanded).join(' ').trim();
  const t = cleanText(exp.body ?? '', w.profile.removeLinks).trim() || fromFile;
  if (!t) return;
  push(
    w,
    `${indent}${w.profile.steps.indent}${w.profile.steps.expectedInline.replace('{text}', t)}`,
    exp.bodyJson ?? null,
  );
}

function emitExpected(w: Walk, step: RawStepNode, indent: string): void {
  if (!step.expectedResultId) return;
  const exp = w.data.scenarioSteps?.[String(step.expectedResultId)];
  if (!exp) return;
  if (isExpectedBlock(exp)) emitExpectedBlock(w, exp, indent);
  else emitExpectedInline(w, exp, indent);
}

export function buildStepsWithRich(
  stepIds: (string | number)[],
  data: RawStepData,
  profile: FormatProfile,
  level = 0,
  expanded?: Map<number, string>,
  shared = false,
): BuiltSteps {
  const w: Walk = { data, profile, expanded, shared, lines: [], rich: [] };
  const indent = profile.steps.indent.repeat(level);
  let n = 0;
  for (const rawId of stepIds) {
    const step = data.scenarioSteps?.[String(rawId)];
    if (!step) continue;
    if (step.sharedStepId) {
      n = emitSharedStep(w, step, indent, level, n);
      continue;
    }
    if (isExpectedBlock(step)) {
      pushAll(w, buildStepsWithRich(step.children ?? [], data, profile, level, expanded, shared));
      continue;
    }
    n = emitNode(w, step, indent, n, false);
    emitExpected(w, step, indent);
    if ((step.children?.length ?? 0) > 0) {
      pushAll(w, buildStepsWithRich(step.children ?? [], data, profile, level + 1, expanded, shared));
    }
  }
  return { lines: w.lines, rich: w.rich };
}
