import type {
  CaseIssue,
  CaseLink,
  CasePerson,
  CaseRelation,
  RawCase,
  RawComment,
  RawLink,
  RawOverview,
  RichNode,
  ScenarioSource,
  TestCase,
  TestCaseAttribute,
  TestCaseComment,
} from './model.js';
import type { FormatProfile } from './profile.js';
import { customStepsId } from './scenarioSource.js';
import { buildStepsWithRich, isFakeNewFormat } from './stepBuilder.js';
import { cleanText, extractDomain, toLf } from './text.js';
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
    .filter((c) => c.field && c.value && !hide.includes(c.field));

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
  const seen = new Set<string>();
  const out: CaseLink[] = [];
  for (const l of links ?? []) {
    const url = (l.url ?? '').trim();
    const name = (l.name ?? '').trim() || url;
    const key = name + String.fromCharCode(0) + url;
    if (!name || seen.has(key)) continue;
    seen.add(key);
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
    }))
    .filter((i) => i.key || i.url);
}

function extractPeople(ov: RawOverview): CasePerson[] {
  return (ov.members ?? [])
    .map((m) => ({ name: m.name ?? '', role: m.role?.name ?? '' }))
    .filter((m) => m.name);
}

function extractRelations(raw: RawCase): CaseRelation[] {
  return (raw.relations ?? [])
    .map((r) => ({
      id: r.target?.id === undefined ? '' : String(r.target.id),
      name: r.target?.name ?? '',
      kind: r.type ?? '',
      projectId: typeof r.target?.projectId === 'number' ? r.target.projectId : null,
    }))
    .filter((r) => r.id);
}

function extractLayer(ov: RawOverview): string {
  return ov.layer?.name ?? ov.testLayer?.name ?? ov.layerName ?? '';
}

function formatLinks(links: RawLink[] | undefined): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const l of links ?? []) {
    let disp = l.name ?? '';
    if (!disp && l.url) disp = extractDomain(l.url).replace(/^https?:\/\//, '');
    if (disp && !seen.has(disp)) {
      seen.add(disp);
      out.push(disp);
    }
  }
  return out;
}

interface ScenarioParts {
  scenarioSource: ScenarioSource;
  scenarioLines: string[];
  scenarioRich?: (RichNode | null)[];
}

function manualScenario(raw: RawCase, profile: FormatProfile): ScenarioParts {
  const data = raw.steps;
  const empty = profile.warnings.emptyScenario;
  if (isFakeNewFormat(data)) return { scenarioSource: 'rawMarkdown', scenarioLines: [empty] };
  if (!data) {
    return { scenarioSource: 'empty', scenarioLines: [empty, profile.warnings.stepsFetchError] };
  }
  const children = data.root?.children ?? [];
  if (children.length === 0) return { scenarioSource: 'empty', scenarioLines: [empty] };
  const built = buildStepsWithRich(children, data, profile);
  return { scenarioSource: 'newSteps', scenarioLines: built.lines, scenarioRich: built.rich };
}

function overviewScenario(raw: RawCase, profile: FormatProfile): ScenarioParts {
  const scenario = raw.overview.scenario ?? {};
  const hasCustom = customStepsId(scenario) !== null;
  const hasSteps = (scenario.steps?.length ?? 0) > 0;
  const scenarioLines = [profile.warnings.emptyScenario];
  if (hasCustom) return { scenarioSource: 'rawMarkdown', scenarioLines };
  if (hasSteps) return { scenarioSource: 'inlineSteps', scenarioLines };
  return { scenarioSource: 'empty', scenarioLines };
}

function detectScenario(raw: RawCase, profile: FormatProfile): ScenarioParts {
  return raw.overview.hasManualScenario
    ? manualScenario(raw, profile)
    : overviewScenario(raw, profile);
}

export function normalizeCase(
  raw: RawCase,
  profile: FormatProfile,
  tree: ProjectTree | null = null,
): TestCase {
  const ov = raw.overview;
  const { scenarioSource, scenarioLines, scenarioRich } = detectScenario(raw, profile);

  const isLegacy = scenarioSource === 'rawMarkdown' || scenarioSource === 'inlineSteps';
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
    links: formatLinks(ov.links),
    linkRefs: extractLinkRefs(ov.links),
    issues: extractIssues(ov),
    people: extractPeople(ov),
    relatedCases: extractRelations(raw),
    attributes,
    isLegacy,
    declaredManual: !!ov.hasManualScenario,
    description: cleanText(ov.description, profile.removeLinks),
    precondition: cleanText(ov.precondition, profile.removeLinks),
    expectedResult: cleanText(ov.expectedResult, profile.removeLinks),
    scenarioSource,
    scenarioLines,
    scenarioRich,
    comments: normalizeComments(raw.comments),
  };
}

export function normalizeComments(raw: RawComment[] | null | undefined): TestCaseComment[] {
  return (Array.isArray(raw) ? raw : [])
    .slice()
    .sort((a, b) => (a.createdDate ?? 0) - (b.createdDate ?? 0))
    .map((c) => ({
      id: String(c.id ?? ''),
      author:
        [c.firstName, c.lastName].filter(Boolean).join(' ').trim() || (c.createdBy ?? 'неизвестно'),
      createdAt: c.createdDate ? new Date(c.createdDate).toISOString() : '',
      body: toLf(c.body ?? '').trim(),
    }));
}
