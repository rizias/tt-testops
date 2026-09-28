import type { ScenarioState } from './audit.js';
import { scenarioHtml } from './htmlRichSteps.js';
import { type EmbeddedAssets, escapeHtml, renderMarkdown } from './htmlText.js';
import type { TestCase } from './model.js';
import type { FormatProfile } from './profile.js';

export { renderRich } from './htmlRich.js';
export type { EmbeddedAssets } from './htmlText.js';
export { escapeHtml, renderMarkdown } from './htmlText.js';

export interface HtmlCase {
  tc: TestCase;
  state: ScenarioState;
}
export const STATE_LABEL: Record<ScenarioState, string> = {
  current: 'актуальный формат',
  oldFormat: 'старый формат',
  empty: 'пустой сценарий',
};

function commentsSection(tc: TestCase, assets: EmbeddedAssets, people: PeopleNames): string {
  if (!tc.comments.length) return '';
  const items = tc.comments
    .map((c) => {
      const when = c.createdAt;
      const who = [people[c.author] ?? c.author, when].filter(Boolean).join(' · ');
      return `<li class="comment"><div class="who">${escapeHtml(who)}</div>${renderMarkdown(c.body, assets)}</li>`;
    })
    .join('\n');
  return `<section class="comments"><h3>Комментарии (${tc.comments.length})</h3><ul>${items}</ul></section>`;
}

export const caseUrl = (baseUrl: string, projectId: number | null, id: string): string =>
  `${baseUrl.replace(/\/+$/, '')}/project/${projectId ?? ''}/test-cases/${id}`;

export type PeopleNames = Record<string, string>;

const fact = (label: string, value: string, title = '') =>
  `<dt${title ? ` title="${escapeHtml(title)}"` : ''}>${escapeHtml(label)}</dt><dd>${value}</dd>`;

function peopleFacts(tc: TestCase, people: PeopleNames): string[] {
  const personName = (name: string) => people[name] ?? name;
  const owners = tc.people.filter((m) => m.role.toLowerCase() === 'owner');
  const others = tc.people.filter((m) => m.role.toLowerCase() !== 'owner');
  const facts: string[] = [];
  if (owners.length)
    facts.push(fact('Владелец', escapeHtml(owners.map((o) => personName(o.name)).join(', '))));
  if (others.length)
    facts.push(
      fact(
        'Участники',
        escapeHtml(
          others
            .map((o) => (o.role ? `${personName(o.name)} (${o.role})` : personName(o.name)))
            .join(', '),
        ),
      ),
    );
  return facts;
}

function issuesHtml(tc: TestCase): string {
  return tc.issues
    .map((i) => {
      const label = i.key || i.summary || i.url;
      const shown = escapeHtml(label);
      const link = i.url
        ? `<a href="${escapeHtml(i.url)}" target="_blank" rel="noopener">${shown}</a>`
        : shown;
      const title = i.summary && i.summary !== label ? escapeHtml(i.summary) : '';
      const state = i.status
        ? `<span class="pill${i.closed ? ' pill_done' : ''}">${escapeHtml(i.status)}</span>`
        : '';
      return `<div class="rel">${link}${title}${state}</div>`;
    })
    .join('');
}

function linksHtml(tc: TestCase): string {
  return tc.linkRefs
    .map((l) =>
      l.url
        ? `<div class="rel"><a href="${escapeHtml(l.url)}" target="_blank" rel="noopener">${escapeHtml(l.name)}</a></div>`
        : `<div class="rel">${escapeHtml(l.name)}</div>`,
    )
    .join('');
}

function relatedHtml(tc: TestCase, baseUrl: string): string {
  return tc.relatedCases
    .map((r) => {
      const label = escapeHtml([r.id, r.name].filter(Boolean).join(' '));
      const project = r.projectId ?? tc.projectId;
      const body =
        baseUrl && project !== null && r.id
          ? `<a href="${caseUrl(baseUrl, project, r.id)}" target="_blank" rel="noopener">${label}</a>`
          : label;
      const kind = r.kind ? `<span class="pill">${escapeHtml(r.kind)}</span>` : '';
      return `<div class="rel rel_case">${kind}${body}</div>`;
    })
    .join('');
}

function caseFacts(tc: TestCase, p: FormatProfile, baseUrl: string, people: PeopleNames): string[] {
  const facts: string[] = [];
  if (tc.path.length) facts.push(fact(p.meta.pathLabel, pathTrail(tc.path)));
  facts.push(
    fact('Статус', escapeHtml(tc.status), 'состояние кейса в процессе TestOps, его ставит человек'),
  );
  if (tc.layer) facts.push(fact('Слой', escapeHtml(tc.layer)));
  facts.push(...peopleFacts(tc, people));
  if (tc.issues.length) facts.push(fact('Задачи', issuesHtml(tc)));
  if (tc.linkRefs.length) facts.push(fact('Ссылки', linksHtml(tc)));
  if (tc.relatedCases.length) facts.push(fact('Связанные кейсы', relatedHtml(tc, baseUrl)));
  if (tc.tags.length)
    facts.push(
      fact(
        p.meta.tagsLabel,
        tc.tags.map((t) => `<span class="tag">${escapeHtml(t)}</span>`).join(''),
      ),
    );
  for (const a of tc.attributes) if (a.value !== '') facts.push(fact(a.name, escapeHtml(a.value)));
  return facts;
}

const block = (title: string, body: string, kind = '') =>
  body.trim()
    ? `<section class="block${kind ? ` ${kind}` : ''}"><h3>${title}</h3><div class="blockBody">${body}</div></section>`
    : '';

export function caseBody(
  { tc, state }: HtmlCase,
  p: FormatProfile,
  assets: EmbeddedAssets,
  baseUrl = '',
  people: PeopleNames = {},
): string {
  const banner =
    p.showMarks && state !== 'current'
      ? `<p class="mark">${STATE_LABEL[state]} — перед автоматизацией кейс надо переписать</p>`
      : '';

  return [
    banner,
    `<dl class="facts">${caseFacts(tc, p, baseUrl, people).join('')}</dl>`,
    block('Описание', renderMarkdown(tc.description, assets)),
    block('Предварительное условие', renderMarkdown(tc.precondition, assets)),
    block('Сценарий', scenarioHtml(tc.scenario, p, assets), 'scenario'),
    block('Ожидаемый результат', renderMarkdown(tc.expectedResult, assets)),
    commentsSection(tc, assets, people),
  ]
    .filter(Boolean)
    .join('\n');
}

export const ICON_AUTO =
  '<svg class="ico" viewBox="0 0 16 16" aria-hidden="true"><rect x="3.5" y="5.5" width="9" height="7" rx="2"/><path d="M8 3.4V5"/><circle cx="8" cy="2.6" r="1.1"/><path d="M1.8 8.5h1.4M12.8 8.5h1.4"/><circle cx="6.3" cy="9" r=".95" class="dot"/><circle cx="9.7" cy="9" r=".95" class="dot"/></svg>';
export const ICON_COPY =
  '<svg class="ico" viewBox="0 0 16 16" aria-hidden="true"><rect x="5.5" y="5.5" width="8" height="9" rx="1.6"/><path d="M10.5 3.2A1.7 1.7 0 0 0 8.9 2H3.7A1.7 1.7 0 0 0 2 3.7v5.2c0 .8.5 1.4 1.2 1.6"/></svg>';
export const ICON_MANUAL =
  '<svg class="ico" viewBox="0 0 16 16" aria-hidden="true"><path d="M6 8.2V3.6a1.1 1.1 0 0 1 2.2 0v4M8.2 7.4V2.9a1.1 1.1 0 0 1 2.2 0v4.5M10.4 7.8V4.6a1.1 1.1 0 0 1 2.2 0v5.1c0 2.4-1.7 4-4 4-2 0-3-.9-3.9-2.3L3.3 9.2a1.1 1.1 0 0 1 1.8-1.3L6 9.1"/></svg>';

export const typeIcon = (tc: TestCase): string =>
  `<span class="type type_${tc.automated ? 'auto' : 'manual'}" title="${
    tc.automated ? 'есть автотест' : 'автотеста нет'
  }">${tc.automated ? ICON_AUTO : ICON_MANUAL}</span>`;

export const pathTrail = (path: string[]): string =>
  path.map((p) => `<span class="crumb">${escapeHtml(p)}</span>`).join('<span class="sep">/</span>');

export function caseId(tc: TestCase, baseUrl: string): string {
  const text = escapeHtml(tc.id);
  const url = baseUrl && tc.projectId != null ? caseUrl(baseUrl, tc.projectId, tc.id) : null;
  return url
    ? `<a class="id" href="${url}" target="_blank" rel="noopener">${text}</a>`
    : `<span class="id">${text}</span>`;
}
