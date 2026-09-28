import { renderRich } from './htmlRich.js';
import { type EmbeddedAssets, escapeHtml, renderMarkdown } from './htmlText.js';
import type { RichNode, Scenario, ScenarioStep, StepExpected, StepExtra } from './model.js';
import type { FormatProfile } from './profile.js';
import { lostMark, stepMarker, textBlock } from './scenarioMarkdown.js';

interface Ctx {
  p: FormatProfile;
  assets: EmbeddedAssets;
}

function inlineMarkdown(md: string, assets: EmbeddedAssets): string {
  const html = renderMarkdown(md, assets).trim();
  const single = /^<p>([\s\S]*)<\/p>$/.exec(html);
  return single?.[1] !== undefined && !single[1].includes('<p>') ? single[1] : html;
}

function extraHtml(extra: StepExtra, ctx: Ctx): string {
  if (extra.kind === 'text') return `<div class="stepExtra">${renderMarkdown(extra.text, ctx.assets)}</div>`;
  const md = extra.kind === 'lost' ? lostMark(extra.id) : extra.markdown;
  return `<div class="stepExtra">${inlineMarkdown(md, ctx.assets)}</div>`;
}

function textHtml(step: ScenarioStep, ctx: Ctx): string {
  if (step.shared) {
    return inlineMarkdown(ctx.p.steps.sharedStep.replace('{name}', () => step.text), ctx.assets);
  }
  const rich = step.rich ? renderRich(step.rich, ctx.assets) : '';
  if (rich) return rich;
  if (step.origin === 'editor') return textBlock(step.text).map(escapeHtml).join('<br>');
  const text = step.text.trim();
  return text ? inlineMarkdown(text, ctx.assets) : '';
}

const expectedLabel = (p: FormatProfile): string =>
  `<div class="expLabel">${escapeHtml(p.steps.expectedBlock.replace(/\*\*/g, '').trim())}</div>`;

function expectedHtml(expected: StepExpected | null, ctx: Ctx): string {
  if (!expected) return '';
  if (expected.kind === 'text') {
    const single = expected.rich && !expected.text.includes('\n');
    const rich = single ? renderRich(expected.rich, ctx.assets) : '';
    const body = rich || inlineMarkdown(expected.text, ctx.assets);
    return `<div class="exp">${expectedLabel(ctx.p)}<div class="expItem">${body}</div></div>`;
  }
  return `<div class="exp">${expectedLabel(ctx.p)}<ol class="expList">${stepItems(expected.items, ctx)}</ol></div>`;
}

function itemHtml(step: ScenarioStep, n: number, ctx: Ctx): string {
  const marker = ` data-n="${escapeHtml(stepMarker(ctx.p, n).trim())}"`;
  const own = [textHtml(step, ctx), ...step.extras.map((extra) => extraHtml(extra, ctx))];
  const body = own.join('') + expectedHtml(step.expected, ctx);
  const children = step.children.length ? stepList(step.children, ctx) : '';
  return `<li${marker}>${body}${children}</li>`;
}

function stepItems(steps: ScenarioStep[], ctx: Ctx): string {
  let n = 0;
  return steps
    .map((step) => {
      if (step.bare) return stepItems(step.children, ctx);
      n += 1;
      return itemHtml(step, n, ctx);
    })
    .join('');
}

const stepList = (steps: ScenarioStep[], ctx: Ctx): string =>
  `<ol class="steps">${stepItems(steps, ctx)}</ol>`;

export function scenarioHtml(scenario: Scenario, p: FormatProfile, assets: EmbeddedAssets): string {
  const ctx: Ctx = { p, assets };
  if (scenario.kind === 'empty') {
    const error = scenario.fetchError ? renderMarkdown(p.warnings.stepsFetchError, assets) : '';
    return renderMarkdown(p.warnings.emptyScenario, assets) + error;
  }
  if (scenario.kind === 'autotest') {
    return renderMarkdown(p.warnings.autotestScenario, assets) + stepList(scenario.steps, ctx);
  }
  return stepList(scenario.steps, ctx);
}

function extraSource(extra: StepExtra): string {
  if (extra.kind === 'lost') return '';
  return extra.kind === 'text' ? extra.text : extra.markdown;
}

function collectStep(step: ScenarioStep, texts: string[], rich: RichNode[]): void {
  texts.push(step.text);
  if (step.rich) rich.push(step.rich);
  for (const extra of step.extras) texts.push(extraSource(extra));
  const expected = step.expected;
  if (expected?.kind === 'text') {
    texts.push(expected.text);
    if (expected.rich) rich.push(expected.rich);
  }
  if (expected?.kind === 'items') for (const item of expected.items) collectStep(item, texts, rich);
  for (const child of step.children) collectStep(child, texts, rich);
}

export function scenarioSources(scenario: Scenario): { texts: string[]; rich: RichNode[] } {
  const texts: string[] = [];
  const rich: RichNode[] = [];
  if (scenario.kind === 'steps' || scenario.kind === 'autotest') {
    for (const step of scenario.steps) collectStep(step, texts, rich);
  }
  return { texts, rich };
}
