import { auditCase } from './audit.js';
import { caseUrl, type PeopleNames } from './htmlCase.js';
import type {
  CaseAttachment,
  CaseIssue,
  CaseLink,
  CasePerson,
  CaseRelation,
  RawCase,
  TestCase,
} from './model.js';
import type { FormatProfile, SectionKey } from './profile.js';
import { attachmentKey } from './text.js';

export function mdLinkUrl(url: string): string {
  return /[ )]/.test(url) ? `<${url}>` : url;
}

export function codeSpan(text: string): string {
  const value = text ?? '';
  const runs = value.match(/`+/g) ?? [];
  const fenceLen = Math.max(0, ...runs.map((r) => r.length)) + 1;
  const fence = '`'.repeat(fenceLen);
  const pad = value === '' || value.startsWith('`') || value.endsWith('`') ? ' ' : '';
  return `${fence}${pad}${value}${pad}${fence}`;
}

const ATTACHMENT_LINK =
  /\]\(<?((?:[a-z][a-z0-9+.-]*:\/\/[^\s<>()]*?)?\/api\/(?:rs\/)?(?:testcase|sharedstep)\/attachment\/(\d+)\/content)>?\)/g;

function localAttachmentLinks(md: string, attachments: CaseAttachment[]): string {
  const local = new Map(attachments.flatMap((a) => (a.path ? [[a.key, a.path] as const] : [])));
  return md.replace(ATTACHMENT_LINK, (whole, url: string, id: string) => {
    const path = local.get(attachmentKey(url, id));
    return path === undefined ? whole : `](${mdLinkUrl(path.replace(/\\/g, '/'))} "${url}")`;
  });
}

function linkText(link: CaseLink): string {
  if (!link.url) return link.name;
  return link.name === link.url ? link.url : `[${link.name}](${mdLinkUrl(link.url)})`;
}

function issueText(issue: CaseIssue): string {
  const label = issue.key || issue.summary || issue.url;
  const linked = issue.url ? `[${label}](${mdLinkUrl(issue.url)})` : label;
  return issue.status ? `${linked} (${issue.status})` : linked;
}

function relationText(r: CaseRelation, tc: TestCase, baseUrl: string): string {
  const label = [r.id, r.name].filter(Boolean).join(' ');
  const project = r.projectId ?? tc.projectId;
  const linked =
    baseUrl && project != null && r.id ? `[${label}](${mdLinkUrl(caseUrl(baseUrl, project, r.id))})` : label;
  return r.kind ? `${r.kind} ${linked}` : linked;
}

function personText(person: CasePerson, people: PeopleNames): string {
  const name = people[person.name] ?? person.name;
  return person.role ? `${name} (${person.role})` : name;
}

function markLines(tc: TestCase, p: FormatProfile, marks: string[]): string[] {
  if (!p.showMarks) return [];
  const L: string[] = [];
  for (const mark of marks) L.push(`> ⚠️ ${mark}`, '');
  if (tc.isLegacy && p.legacyBanner) L.push(p.legacyBanner, '');
  return L;
}

function headerLine(tc: TestCase): string {
  return `# **${tc.name}** (ID: ${tc.id})`;
}

function addressLine(tc: TestCase, p: FormatProfile, baseUrl: string): string[] {
  const url = baseUrl && tc.projectId != null ? caseUrl(baseUrl, tc.projectId, tc.id) : null;
  return url ? [`- **${p.meta.addressLabel}:** <${url}>`] : [];
}

function attributeLines(tc: TestCase, p: FormatProfile): string[] {
  return tc.attributes.filter((a) => a.value !== '').map((a) => {
    const name = a.name;
    const value = codeSpan(a.value);
    return p.meta.attributeLine.replace(/\{(name|value)\}/g, (_m, key: string) =>
      key === 'name' ? name : value,
    );
  });
}

function peopleLines(tc: TestCase, p: FormatProfile, people: PeopleNames): string[] {
  const owners = tc.people.filter((m) => m.role.toLowerCase() === 'owner');
  const others = tc.people.filter((m) => m.role.toLowerCase() !== 'owner');
  const L: string[] = [];
  if (owners.length)
    L.push(`- **${p.meta.ownerLabel}:** ${owners.map((o) => personText(o, people)).join(', ')}`);
  if (others.length)
    L.push(`- **${p.meta.participantsLabel}:** ${others.map((o) => personText(o, people)).join(', ')}`);
  return L;
}

function headLines(
  tc: TestCase,
  p: FormatProfile,
  baseUrl: string,
  projectName: string | null,
  people: PeopleNames,
): string[] {
  const L: string[] = [];
  if (tc.projectId != null)
    L.push(`- **${p.meta.projectLabel}:** ${codeSpan(projectName ?? String(tc.projectId))}`);
  if (tc.path.length)
    L.push(
      `- **${p.meta.pathLabel}:** ${tc.path.map((s) => codeSpan(s)).join(p.meta.pathDisplaySep)}`,
    );
  L.push(`- **${p.meta.statusLabel}:** ${codeSpan(tc.status)}`);
  if (tc.layer) L.push(`- **${p.meta.layerLabel}:** ${codeSpan(tc.layer)}`);
  L.push(
    `- **${p.meta.typeLabel}:** ${codeSpan(tc.automated ? p.meta.automatedValue : p.meta.manualValue)}`,
  );
  L.push(...peopleLines(tc, p, people));
  if (tc.issues.length)
    L.push(`- **${p.meta.issuesLabel}:** ${tc.issues.map(issueText).join(', ')}`);
  if (tc.linkRefs.length)
    L.push(
      `- **${p.meta.linksLabel}:** ${tc.linkRefs.map(linkText).join(', ')}`,
    );
  if (tc.relatedCases.length)
    L.push(
      `- **${p.meta.relatedCasesLabel}:** ${tc.relatedCases.map((r) => relationText(r, tc, baseUrl)).join(', ')}`,
    );
  if (tc.tags.length)
    L.push(`- **${p.meta.tagsLabel}:** ${tc.tags.map((t) => codeSpan(t)).join(', ')}`);
  L.push(...attributeLines(tc, p));
  return L;
}

export function renderCase(
  tc: TestCase,
  p: FormatProfile,
  marks: string[] = [],
  baseUrl = '',
  projectName: string | null = null,
  people: PeopleNames = {},
): string {
  const L: string[] = [];
  L.push(headerLine(tc));
  L.push(...addressLine(tc, p, baseUrl));
  L.push(...markLines(tc, p, marks));
  L.push(...headLines(tc, p, baseUrl, projectName, people));

  for (const key of p.sectionOrder) L.push(...sectionLines(key, tc, p, people));
  return localAttachmentLinks(L.join('\n'), tc.attachments);
}

function commentLines(tc: TestCase, p: FormatProfile, people: PeopleNames): string[] {
  if (!tc.comments.length) return [];
  const body = tc.comments.flatMap((c, i) => {
    const when = c.createdAt;
    const author = people[c.author] ?? c.author;
    const who = [author, when].filter(Boolean).join(' · ');
    return [...(i ? [''] : []), ...(who ? [`**${who}**`, ''] : []), c.body];
  });
  return ['', p.sections.comments, ...body];
}

function sectionLines(key: SectionKey, tc: TestCase, p: FormatProfile, people: PeopleNames): string[] {
  if (key === 'description')
    return tc.description ? ['', p.sections.description, tc.description] : [];
  if (key === 'precondition')
    return tc.precondition ? ['', p.sections.precondition, tc.precondition] : [];
  if (key === 'scenario') return ['', p.sections.scenario, ...tc.scenarioLines, ''];
  if (key === 'comments') return commentLines(tc, p, people);
  return tc.expectedResult ? [p.sections.expectedResult, tc.expectedResult] : [];
}

export function renderBatch(
  cases: RawCase[],
  p: FormatProfile,
  baseUrl: string,
  resolved: TestCase[],
  projectName: (id: number | null) => string | null,
  people: PeopleNames,
): string {
  const summary: string[] = [p.batch.summaryHeading];
  const details: string[] = [];
  let hasIssues = false;
  cases.forEach((raw, i) => {
    const ov = raw.overview;
    const tc = resolved[i] as TestCase;
    const problems = auditCase(tc, raw).map((f) => f.message);
    if (problems.length) {
      hasIssues = true;
      const id =
        ov.projectId === undefined || ov.projectId === null
          ? `**${ov.id}**`
          : `[**${ov.id}**](${caseUrl(baseUrl, ov.projectId, String(ov.id))})`;
      summary.push(['-', id, ov.name].filter(Boolean).join(' '));
      for (const pr of problems) summary.push(`  - ${pr}`);
    }
    details.push(renderCase(tc, p, [], baseUrl, projectName(tc.projectId), people));
  });

  if (!p.showMarks) return details.join('\n');
  if (!hasIssues) summary.push(p.batch.noIssues);
  summary.push(`\n${p.batch.divider}\n`);
  return [...summary, ...details].join('\n');
}
