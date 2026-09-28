import { isLegacySource } from './audit.js';
import type {
  CaseIssue,
  CaseLink,
  CasePerson,
  CaseRelation,
  RawCase,
  RawComment,
  RawLink,
  RawOverview,
  Scenario,
  TestCase,
  TestCaseAttribute,
  TestCaseComment,
} from './model.js';
import type { FormatProfile } from './profile.js';
import { scenarioLines, stepsHaveContent } from './scenarioMarkdown.js';
import { type ResolvedScenario, runOrEmpty, scenarioPlan } from './scenarioSource.js';
import { buildEditorSteps } from './stepBuilder.js';
import { cleanText, toLf } from './text.js';
import { type ProjectTree, treePath } from './tree.js';

function extractFields(
  ov: RawOverview,
  profile: FormatProfile,
  tree: ProjectTree | null,
): { path: string[]; attributes: TestCaseAttribute[] } {
  const { hide, rename, order } = profile.customFields;
  const levels = new Set((tree?.fields ?? []).map((f) => f.id));
  const fields = (ov.customFields ?? [])
    .map((c) => ({
      field: c.customField?.name ?? '',
      value: c.name ?? '',
      level: typeof c.customField?.id === 'number' && levels.has(c.customField.id),
    }))
    .filter((c) => c.field && !hide.includes(c.field));

  let attrs = fields.filter((c) => !c.level);
  if (order.length) {
    const idx = (n: string) => {
      const i = order.indexOf(n);
      return i === -1 ? order.length : i;
    };
    attrs = attrs.sort((a, b) => idx(a.field) - idx(b.field));
  }
  return {
    path: treePath(ov.customFields ?? [], tree),
    attributes: attrs.map((c) => ({ name: rename[c.field] ?? c.field, value: c.value })),
  };
}

function extractLinkRefs(links: RawLink[] | undefined): CaseLink[] {
  const out: CaseLink[] = [];
  for (const l of links ?? []) {
    const url = (l.url ?? '').trim();
    const name = (l.name ?? '').trim() || url;
    if (!name) continue;
    out.push({ name, url });
  }
  return out;
}

function extractIssues(ov: RawOverview): CaseIssue[] {
  return (ov.issues ?? [])
    .map((i) => ({
      key: i.displayName ?? i.name ?? '',
      summary: i.summary ?? '',
      status: i.status ?? '',
      closed: i.closed === true,
      url: i.url ?? '',
    }));
}

function extractPeople(ov: RawOverview): CasePerson[] {
  return (ov.members ?? []).map((m) => ({ name: m.name ?? '', role: m.role?.name ?? '' }));
}

function extractRelations(raw: RawCase): CaseRelation[] {
  return (raw.relations ?? [])
    .map((r) => ({
      id: r.target?.id === undefined ? '' : String(r.target.id),
      name: r.target?.name ?? '',
      kind: r.type ?? '',
      projectId: typeof r.target?.projectId === 'number' ? r.target.projectId : null,
    }));
}

function extractLayer(ov: RawOverview): string {
  return ov.layer?.name ?? ov.testLayer?.name ?? ov.layerName ?? '';
}

const EMPTY: Scenario = { kind: 'empty', fetchError: false };

function detectScenario(raw: RawCase): ResolvedScenario {
  const plan = scenarioPlan(raw);
  if (plan.kind === 'inline') return { source: 'inlineSteps', scenario: EMPTY };
  if (plan.kind === 'fetchError') {
    return { source: 'empty', scenario: { kind: 'empty', fetchError: true } };
  }
  if (plan.kind === 'editor') {
    const steps = buildEditorSteps(plan.data);
    if (stepsHaveContent(steps)) return { source: 'newSteps', scenario: { kind: 'steps', steps } };
  }
  return runOrEmpty(raw);
}

export function normalizeCase(
  raw: RawCase,
  profile: FormatProfile,
  tree: ProjectTree | null = null,
): TestCase {
  const ov = raw.overview;
  const { source, scenario } = detectScenario(raw);
  const { path, attributes } = extractFields(ov, profile, tree);

  return {
    id: String(ov.id),
    name: ov.name ?? '',
    projectId: ov.projectId ?? null,
    path,
    status: ov.status?.name ?? '',
    automated: !!ov.automated,
    layer: extractLayer(ov),
    tags: (ov.tags ?? []).map((t) => t.name ?? '').filter(Boolean),
    linkRefs: extractLinkRefs(ov.links),
    issues: extractIssues(ov),
    people: extractPeople(ov),
    relatedCases: extractRelations(raw),
    attributes,
    isLegacy: isLegacySource(source, raw),
    description: cleanText(ov.description),
    precondition: cleanText(ov.precondition),
    expectedResult: cleanText(ov.expectedResult),
    scenarioSource: source,
    scenario,
    scenarioLines: scenarioLines(scenario, profile),
    comments: normalizeComments(raw.comments),
    attachments: [],
  };
}

export function normalizeComments(raw: RawComment[] | null | undefined): TestCaseComment[] {
  return (Array.isArray(raw) ? raw : [])
    .slice()
    .sort((a, b) => (a.createdDate ?? 0) - (b.createdDate ?? 0))
    .map((c) => ({
      id: String(c.id ?? ''),
      author: [c.firstName, c.lastName].filter(Boolean).join(' ').trim() || (c.createdBy ?? ''),
      createdAt: c.createdDate ? new Date(c.createdDate).toISOString() : '',
      body: toLf(c.body ?? '').trim(),
    }));
}
