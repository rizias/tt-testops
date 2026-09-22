import { type AuditRules, auditCase } from './audit.js';
import { collectStepAttachments, emitTextLines, type TextOf } from './inlineContent.js';
import type { RawCase, RawScenario, RawScenarioStep, RawStepData, RichNode, TestCase } from './model.js';
import { normalizeCase } from './normalize.js';
import type { FormatProfile } from './profile.js';
import { renderCase } from './render.js';
import { CUSTOM_STEPS, customStepsId } from './scenarioSource.js';
import { buildStepsWithRich, isFakeNewFormat } from './stepBuilder.js';
import { collapseLines } from './text.js';
import type { ProjectTree } from './tree.js';

export interface ResolveDeps {
  fetchAttachment(attachmentId: number, shared?: boolean): Promise<string>;
  baseUrl: string;
  onWarn?: (message: string) => void;
  onLost?: (attachmentId: number) => void;
}

const ATTACHMENT_PATH = /\/api\/(?:rs\/)?(?:testcase|sharedstep)\/attachment\/\d+\/content/g;
const nl = (t: string) => t.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

export function absolutizeImages(text: string, baseUrl: string): string {
  const base = baseUrl.replace(/\/$/, '');
  return text.replace(ATTACHMENT_PATH, (path, offset: number) =>
    text.slice(Math.max(0, offset - base.length), offset) === base ? path : `${base}${path}`,
  );
}

export const lostMark = (attachmentId: number): string => `_вложение ${attachmentId} недоступно_`;

function textOf(deps: ResolveDeps, caseId: string | number | undefined): TextOf {
  return async (attachmentId, shared) => {
    try {
      return nl(await deps.fetchAttachment(attachmentId, shared));
    } catch (cause) {
      const detail = cause instanceof Error ? cause.message : String(cause);
      deps.onWarn?.(`кейс ${caseId ?? '?'}: вложение ${attachmentId} не скачалось — ${detail}`);
      deps.onLost?.(attachmentId);
      return null;
    }
  };
}

const STEP_TEXT = /^(description|expected|customSteps)/;

function isStepText(att: { name?: string; contentType?: string }): boolean {
  if ((att.contentType ?? '').startsWith('text/')) return true;
  return STEP_TEXT.test(att.name ?? '');
}

async function prefetchTextAttachments(
  data: RawStepData,
  p: FormatProfile,
  text: TextOf,
): Promise<Map<number, string> | undefined> {
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
      if (!STEP_TEXT.test(att.name ?? '') && !p.steps.expandAttachments) continue;
      const body = await text(att.id, shared);
      if (body !== null) expanded.set(att.id, body);
    }
  }
  return expanded;
}

interface InlineCtx {
  p: FormatProfile;
  baseUrl: string;
  text: TextOf;
}

async function renderInline(
  steps: RawScenarioStep[],
  ctx: InlineCtx,
  level = 0,
): Promise<string[]> {
  const { p } = ctx;
  const out: string[] = [];
  const indent = p.steps.indent.repeat(level);
  const cont = p.steps.indent;
  let n = 0;
  for (const s of steps) {
    const { desc, exp, pictures, missing } = await collectStepAttachments(s, ctx.text, lostMark);
    const own = `${s.keyword ?? ''}${s.name ?? ''}`;
    const text = absolutizeImages(
      desc === null ? collapseLines(own) : nl(desc),
      ctx.baseUrl,
    ).trim();

    const emitted = emitTextLines(text, indent, cont, p, n);
    out.push(...emitted.lines);
    n = emitted.n;

    for (const note of missing) out.push(`${indent}${cont}${note}`);
    for (const picture of pictures) {
      out.push(`${indent}${cont}${absolutizeImages(picture, ctx.baseUrl)}`);
    }
    if (exp !== null) {
      const e = absolutizeImages(exp, ctx.baseUrl).replace(/\n+/g, ' ').trim();
      if (e) out.push(`${indent}${cont}${p.steps.expectedInline.replace('{text}', e)}`);
    }
    if (s.steps?.length) out.push(...(await renderInline(s.steps, ctx, level + 1)));
  }
  return out;
}

export interface ResolvedScenario {
  lines: string[];

  rich: (RichNode | null)[];
}

export async function resolveScenario(
  raw: RawCase,
  p: FormatProfile,
  deps: ResolveDeps,
): Promise<string[]> {
  return (await resolveScenarioParts(raw, p, deps)).lines;
}

function flatScenario(lines: string[]): ResolvedScenario {
  return { lines, rich: lines.map(() => null) };
}

async function resolveManualScenario(
  raw: RawCase,
  p: FormatProfile,
  deps: ResolveDeps,
  text: TextOf,
  sc: RawScenario,
): Promise<ResolvedScenario> {
  const data = raw.steps;
  const custom =
    data && isFakeNewFormat(data)
      ? (Object.values(data.attachments ?? {}).find((a) => a?.name === CUSTOM_STEPS)?.id ?? null)
      : customStepsId(sc);
  if (typeof custom === 'number') {
    const body = await text(custom);
    return flatScenario(
      body === null ? [lostMark(custom)] : absolutizeImages(body, deps.baseUrl).split('\n'),
    );
  }
  if (!data) return flatScenario([p.warnings.emptyScenario, p.warnings.stepsFetchError]);
  const expanded = await prefetchTextAttachments(data, p, text);
  const built = buildStepsWithRich(data.root?.children ?? [], data, p, 0, expanded);
  const lines = built.lines.map((l) => absolutizeImages(l, deps.baseUrl));
  return lines.length ? { lines, rich: built.rich } : flatScenario([p.warnings.emptyScenario]);
}

async function resolveOverviewScenario(
  p: FormatProfile,
  deps: ResolveDeps,
  text: TextOf,
  sc: RawScenario,
): Promise<ResolvedScenario> {
  const csId = customStepsId(sc);
  if (csId !== null) {
    const body = await text(csId);
    if (body !== null) return flatScenario(absolutizeImages(body, deps.baseUrl).split('\n'));
    if ((sc.steps?.length ?? 0) === 0) return flatScenario([lostMark(csId)]);
  }
  if ((sc.steps?.length ?? 0) > 0) {
    const ctx: InlineCtx = { p, baseUrl: deps.baseUrl, text };
    return flatScenario([...(await renderInline(sc.steps ?? [], ctx))]);
  }
  return flatScenario([p.warnings.emptyScenario]);
}

export async function resolveScenarioParts(
  raw: RawCase,
  p: FormatProfile,
  deps: ResolveDeps,
): Promise<ResolvedScenario> {
  const ov = raw.overview;
  const text = textOf(deps, ov.id);
  const sc = ov.scenario ?? { steps: [], attachments: [] };

  if (ov.hasManualScenario) return resolveManualScenario(raw, p, deps, text, sc);
  return resolveOverviewScenario(p, deps, text, sc);
}

export async function resolveToTestCase(
  raw: RawCase,
  p: FormatProfile,
  deps: ResolveDeps,
  tree: ProjectTree | null = null,
): Promise<TestCase> {
  const tc = normalizeCase(raw, p, tree);
  const scenario = await resolveScenarioParts(raw, p, deps);
  tc.scenarioLines = scenario.lines;
  tc.scenarioRich = scenario.rich;
  tc.description = absolutizeImages(tc.description, deps.baseUrl);
  tc.precondition = absolutizeImages(tc.precondition, deps.baseUrl);
  tc.expectedResult = absolutizeImages(tc.expectedResult, deps.baseUrl);
  for (const comment of tc.comments) comment.body = absolutizeImages(comment.body, deps.baseUrl);
  return tc;
}

export async function renderResolved(
  raw: RawCase,
  p: FormatProfile,
  deps: ResolveDeps,
): Promise<string> {
  return renderCase(await resolveToTestCase(raw, p, deps), p);
}

export async function renderBatchResolved(
  cases: RawCase[],
  p: FormatProfile,
  deps: ResolveDeps,
  resolve: (raw: RawCase) => Promise<TestCase> = (raw) => resolveToTestCase(raw, p, deps),
  rules?: AuditRules,
): Promise<string> {
  const summary: string[] = [p.batch.summaryHeading];
  const details: string[] = [];
  const base = deps.baseUrl.replace(/\/$/, '');
  let hasIssues = false;
  for (const raw of cases) {
    const ov = raw.overview;
    const tc = await resolve(raw);
    const problems = auditCase(tc, raw, rules).map((f) => f.message);
    if (problems.length) {
      hasIssues = true;
      const name = ov.name ?? 'No Name';
      summary.push(
        ov.projectId === undefined || ov.projectId === null
          ? `- **${ov.id}** ${name}`
          : `- [**${ov.id}**](${base}/project/${ov.projectId}/test-cases/${ov.id}) ${name}`,
      );
      for (const pr of problems) summary.push(`  - ${pr}`);
    }
    details.push(renderCase(tc, p));
  }

  if (!p.showMarks) return details.join('\n');
  if (!hasIssues) summary.push(p.batch.noIssues);
  summary.push(`\n${p.batch.divider}\n`);
  return [...summary, ...details].join('\n');
}
