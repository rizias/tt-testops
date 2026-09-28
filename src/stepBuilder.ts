import type { RawStepData, RawStepNode, ScenarioStep, StepExpected, StepExtra } from './model.js';
import { cleanText } from './text.js';

const EXPECTED_HEADERS = new Set(['Expected Result', 'Expected result']);

interface Walk {
  data: RawStepData;
  expanded?: Map<number, string>;
  shared: boolean;
}

const newStep = (fields: Partial<ScenarioStep>): ScenarioStep => ({
  origin: 'editor',
  text: '',
  rich: null,
  shared: false,
  bare: false,
  extras: [],
  expected: null,
  children: [],
  ...fields,
});

function attachmentOf(step: RawStepNode, data: RawStepData) {
  if (step.attachmentId === undefined) return null;
  const att = data.attachments?.[String(step.attachmentId)];
  return att && typeof att.id === 'number' ? { ...att, id: att.id } : null;
}

function extrasOf(step: RawStepNode, w: Walk): StepExtra[] {
  const att = attachmentOf(step, w.data);
  if (!att) return [];
  const img = (att.contentType ?? '').startsWith('image/');
  const kind = w.shared ? 'sharedstep' : 'testcase';
  const url = `/api/${kind}/attachment/${att.id}/content`;
  const link = img ? `![${att.name ?? ''}](${url})` : `[${att.name || url}](${url})`;
  const content = w.expanded?.get(att.id);
  return content ? [{ kind: 'text', text: content }] : [{ kind: 'link', markdown: link }];
}

const isExpectedBlock = (node: RawStepNode | undefined): boolean =>
  !!node && !!node.body && EXPECTED_HEADERS.has(node.body) && (node.children?.length ?? 0) > 0;

const isAttachmentRow = (node: RawStepNode): boolean =>
  node.attachmentId !== undefined &&
  !(node.body ?? '').trim() &&
  !node.children?.length &&
  !node.expectedResultId &&
  !node.sharedStepId;

interface Folded {
  steps: ScenarioStep[];
  lead: StepExtra[];
}

function foldRows(
  ids: (string | number)[],
  w: Walk,
  build: (node: RawStepNode) => ScenarioStep | null,
): Folded {
  const folded: Folded = { steps: [], lead: [] };
  for (const rawId of ids) {
    const node = w.data.scenarioSteps?.[String(rawId)];
    if (!node) continue;
    if (isAttachmentRow(node) && ids.length === 1) {
      folded.lead.push(...extrasOf(node, w));
      continue;
    }
    const step = build(node);
    if (step) folded.steps.push(step);
  }
  return folded;
}

function absorbLead({ steps, lead }: Folded): ScenarioStep[] {
  if (!lead.length) return steps;
  const [first, ...rest] = steps;
  if (!first) return [newStep({ extras: lead })];
  return [{ ...first, extras: [...lead, ...first.extras] }, ...rest];
}

function stepText(node: RawStepNode): string {
  return cleanText(node.body ?? '');
}

function nodeStep(node: RawStepNode, w: Walk): ScenarioStep {
  return newStep({
    text: stepText(node),
    rich: node.bodyJson ?? null,
    extras: extrasOf(node, w),
  });
}

function fullNodeStep(node: RawStepNode, w: Walk): ScenarioStep {
  const own = nodeStep(node, w);
  const { steps, lead } = walkFolded(node.children ?? [], w);
  return {
    ...own,
    extras: [...own.extras, ...lead],
    expected: expectedOf(node, w),
    children: steps,
  };
}

function expectedOf(step: RawStepNode, w: Walk): StepExpected | null {
  if (!step.expectedResultId) return null;
  const exp = w.data.scenarioSteps?.[String(step.expectedResultId)];
  if (!exp) return null;
  if (isExpectedBlock(exp)) {
    return { kind: 'items', items: absorbLead(foldRows(exp.children ?? [], w, (child) => fullNodeStep(child, w))) };
  }
  const att = attachmentOf(exp, w.data);
  const fromFile = (att ? w.expanded?.get(att.id) : undefined)?.trim() ?? '';
  const text = stepText(exp) || fromFile;
  return text ? { kind: 'text', text, rich: exp.bodyJson ?? null } : null;
}

function sharedStep(step: RawStepNode, w: Walk): ScenarioStep | null {
  const shared = w.data.sharedSteps?.[String(step.sharedStepId)];
  if (!shared) return null;
  const inner: Walk = {
    ...w,
    shared: true,
    data: {
      ...w.data,
      scenarioSteps: w.data.sharedStepScenarioSteps ?? {},
      attachments: w.data.sharedStepAttachments ?? w.data.attachments,
    },
  };
  const { steps, lead } = walkFolded(shared.children ?? [], inner);
  return newStep({ text: shared.body ?? '', shared: true, extras: lead, children: steps });
}

function anyStep(step: RawStepNode, w: Walk): ScenarioStep | null {
  if (step.sharedStepId) return sharedStep(step, w);
  if (isExpectedBlock(step)) return newStep({ bare: true, children: walkSteps(step.children ?? [], w) });
  return fullNodeStep(step, w);
}

function walkFolded(stepIds: (string | number)[], w: Walk): Folded {
  return foldRows(stepIds, w, (step) => anyStep(step, w));
}

function walkSteps(stepIds: (string | number)[], w: Walk): ScenarioStep[] {
  return absorbLead(walkFolded(stepIds, w));
}

export function buildEditorSteps(
  data: RawStepData,
  expanded?: Map<number, string>,
): ScenarioStep[] {
  return walkSteps(data.root?.children ?? [], { data, expanded, shared: false });
}
