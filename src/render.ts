import { type AuditRules, auditCase } from './audit.js';
import type { CaseLink, RawCase, TestCase } from './model.js';
import { normalizeCase } from './normalize.js';
import type { FormatProfile, SectionKey } from './profile.js';
import { extractDomain } from './text.js';

function linkText(link: CaseLink, removeLinks: boolean): string {
  if (!link.url) return link.name;
  const url = removeLinks ? extractDomain(link.url) : link.url;
  return link.name === link.url ? url : `[${link.name}](${url})`;
}

function markLines(tc: TestCase, p: FormatProfile, marks: string[]): string[] {
  if (!p.showMarks) return [];
  const L: string[] = [];
  for (const mark of marks) L.push(`> ⚠️ ${mark}`, '');
  const banner =
    tc.declaredManual && tc.scenarioSource === 'rawMarkdown'
      ? p.inconsistentBanner
      : p.legacyBanner;
  if (tc.isLegacy && banner) L.push(banner, '');
  return L;
}

export function renderCase(tc: TestCase, p: FormatProfile, marks: string[] = []): string {
  const L: string[] = [];
  L.push(`# **${tc.name}** (ID: ${tc.id})`);
  L.push(...markLines(tc, p, marks));

  if (tc.path.length)
    L.push(
      `- **${p.meta.pathLabel}:** ${tc.path.map((s) => `\`${s}\``).join(p.meta.pathDisplaySep)}`,
    );
  L.push(`- **${p.meta.statusLabel}:** \`${tc.status}\``);
  L.push(
    `- **${p.meta.typeLabel}:** \`${tc.automated ? p.meta.automatedValue : p.meta.manualValue}\``,
  );
  L.push(`- **${p.meta.layerLabel}:** \`${tc.layer || p.meta.layerDefault}\``);

  for (const a of tc.attributes)
    L.push(p.meta.attributeLine.replace('{name}', a.name).replace('{value}', a.value));
  if (tc.tags.length)
    L.push(`- **${p.meta.tagsLabel}:** ${tc.tags.map((t) => `\`${t}\``).join(', ')}`);
  if (tc.linkRefs.length)
    L.push(
      `- **${p.meta.linksLabel}:** ${tc.linkRefs.map((link) => linkText(link, p.removeLinks)).join(', ')}`,
    );

  for (const key of p.sectionOrder) L.push(...sectionLines(key, tc, p));
  return L.join('\n');
}

function sectionLines(key: SectionKey, tc: TestCase, p: FormatProfile): string[] {
  if (key === 'description')
    return tc.description ? ['', p.sections.description, tc.description] : [];
  if (key === 'precondition')
    return tc.precondition ? ['', p.sections.precondition, tc.precondition] : [];
  if (key === 'scenario') return ['', p.sections.scenario, ...tc.scenarioLines, ''];
  return tc.expectedResult ? [p.sections.expectedResult, tc.expectedResult] : [];
}

export function renderBatch(
  cases: RawCase[],
  p: FormatProfile,
  baseUrl: string,
  rules?: AuditRules,
): string {
  const summary: string[] = [p.batch.summaryHeading];
  const details: string[] = [];
  const base = baseUrl.replace(/\/$/, '');
  let hasIssues = false;

  for (const raw of cases) {
    const ov = raw.overview;
    const caseId = ov.id;
    const projectId = ov.projectId ?? '';
    const name = ov.name ?? 'No Name';
    const webUrl = projectId === '' ? null : `${base}/project/${projectId}/test-cases/${caseId}`;
    const tc = normalizeCase(raw, p);
    const problems = auditCase(tc, raw, rules).map((f) => f.message);
    if (problems.length) {
      hasIssues = true;
      summary.push(webUrl ? `- [**${caseId}**](${webUrl}) ${name}` : `- **${caseId}** ${name}`);
      for (const pr of problems) summary.push(`  - ${pr}`);
    }
    details.push(renderCase(tc, p));
  }

  if (!p.showMarks) return details.join('\n');
  if (!hasIssues) summary.push(p.batch.noIssues);
  summary.push(`\n${p.batch.divider}\n`);
  return [...summary, ...details].join('\n');
}
