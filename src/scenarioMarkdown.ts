import type { RichNode, Scenario, ScenarioStep, StepExpected, StepExtra } from './model.js';
import type { FormatProfile } from './profile.js';

export const lostMark = (attachmentId: number): string => `_вложение ${attachmentId} недоступно_`;

export const stepMarker = (p: FormatProfile, n: number): string =>
  p.steps.numbered ? `${n}. ` : '- ';

const expectedMarker = (p: FormatProfile, n: number): string =>
  p.steps.numbered ? `${n}) ` : '* ';

export function textBlock(text: string): string[] {
  const lines = text.split('\n');
  const first = lines.findIndex((l) => l.trim());
  if (first === -1) return [];
  const last = lines.length - 1 - [...lines].reverse().findIndex((l) => l.trim());
  return lines.slice(first, last + 1);
}

function contFor(marker: string, p: FormatProfile): string {
  const unit = p.steps.indent;
  return marker.length <= unit.length ? unit : unit + ' '.repeat(marker.length - unit.length);
}

function extraLines(extra: StepExtra): string[] {
  if (extra.kind === 'text') return textBlock(extra.text);
  if (extra.kind === 'lost') return [lostMark(extra.id)];
  return [extra.markdown];
}

const bodyLines = (step: ScenarioStep): string[] => [...textBlock(step.text), ...step.extras.flatMap(extraLines)];

function expectedTextBody(text: string, at: string, p: FormatProfile): string[] {
  const lines = textBlock(text);
  if (lines.length <= 1) {
    const single = lines[0] ?? '';
    return [`${at}${p.steps.expectedInline.replace('{text}', () => single)}`];
  }
  const [before = '', after = ''] = p.steps.expectedInline.split('{text}');
  const body = lines.map((l) => (l ? `${at}${l}` : ''));
  const tail = after.trim() ? [`${at}${after.trim()}`] : [];
  return [`${at}${before.trimEnd()}`, '', ...body, ...tail];
}

function ownLines(step: ScenarioStep, p: FormatProfile, at: string, marker: string): string[] {
  if (step.shared)
    return [`${at}${marker}${p.steps.sharedStep.replace('{name}', () => step.text)}`];
  const [first, ...rest] = bodyLines(step);
  const cont = ' '.repeat(marker.length);
  const head = first ? `${at}${marker}${first}` : `${at}${marker}`.trimEnd();
  return [head, ...rest.map((line) => (line ? `${at}${cont}${line}` : ''))];
}

function expectedBody(expected: StepExpected | null, p: FormatProfile, at: string): string[] {
  if (!expected) return [];
  if (expected.kind === 'text') return expectedTextBody(expected.text, at, p);
  return [`${at}${p.steps.expectedBlock}`, '', ...stepLines(expected.items, p, at, expectedMarker)];
}

function tailLines(blocks: string[][], leadsWithContent: boolean): string[] {
  return blocks
    .filter((block) => block.length > 0)
    .flatMap((block, i) => (i === 0 && !leadsWithContent ? block : ['', ...block]));
}

function stepLines(
  steps: ScenarioStep[],
  p: FormatProfile,
  indent: string,
  markerOf: (p: FormatProfile, n: number) => string,
): string[] {
  let n = 0;
  return steps.flatMap((step) => {
    if (step.bare) return stepLines(step.children, p, indent, markerOf);
    n += 1;
    const marker = markerOf(p, n);
    const childAt = indent + contFor(marker, p);
    const hasOwnContent = step.shared || bodyLines(step).length > 0;
    const tail = tailLines(
      [
        expectedBody(step.expected, p, childAt),
        step.children.length ? stepLines(step.children, p, childAt, stepMarker) : [],
      ],
      hasOwnContent,
    );
    return [...ownLines(step, p, indent, marker), ...tail];
  });
}

function expectedHasContent(expected: StepExpected | null): boolean {
  if (!expected) return false;
  return expected.kind === 'text' ? expected.text.trim() !== '' : stepsHaveContent(expected.items);
}

const RICH_LEAVES = new Set(['image', 'parameter']);

const richHasContent = (node: RichNode | null | undefined): boolean =>
  !!node &&
  ((node.text ?? '').trim() !== '' ||
    RICH_LEAVES.has(node.type ?? '') ||
    (node.content ?? []).some(richHasContent));

const stepHasContent = (step: ScenarioStep): boolean =>
  step.text.trim() !== '' ||
  richHasContent(step.rich) ||
  step.extras.length > 0 ||
  expectedHasContent(step.expected) ||
  stepsHaveContent(step.children);

export function stepsHaveContent(steps: ScenarioStep[]): boolean {
  return steps.some(stepHasContent);
}

export function scenarioLines(scenario: Scenario, p: FormatProfile): string[] {
  if (scenario.kind === 'empty') {
    return scenario.fetchError
      ? [p.warnings.emptyScenario, '', p.warnings.stepsFetchError]
      : [p.warnings.emptyScenario];
  }
  if (scenario.kind === 'autotest') {
    return [p.warnings.autotestScenario, ...stepLines(scenario.steps, p, '', stepMarker)];
  }
  return stepLines(scenario.steps, p, '', stepMarker);
}
