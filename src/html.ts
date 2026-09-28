import type { EmbeddedAssets, HtmlCase, PeopleNames } from './htmlCase.js';
import {
  caseBody,
  caseId,
  caseUrl,
  escapeHtml,
  ICON_AUTO,
  ICON_COPY,
  ICON_MANUAL,
  STATE_LABEL,
  typeIcon,
} from './htmlCase.js';
import { HANDLER } from './htmlScript.js';
import { STYLE } from './htmlStyle.js';
import type { FormatProfile } from './profile.js';

export type { EmbeddedAssets, HtmlCase, PeopleNames } from './htmlCase.js';
export { renderMarkdown, renderRich } from './htmlCase.js';
export interface PathGroup {
  name: string;
  count: number;

  project: boolean;

  automated: number;
  manual: number;
  cases: HtmlCase[];
  children: PathGroup[];
}

const NO_SECTION = 'Без раздела';
const NO_PROJECT = 'Проект не указан';

export type ProjectNames = Record<string, string>;

export function projectLabel(id: number | null, names: ProjectNames): string {
  if (id === null) return NO_PROJECT;
  return names[String(id)] ?? `Проект ${id}`;
}

function bySection(a: PathGroup, b: PathGroup): number {
  if (a.project || b.project) return 0;
  if (a.name === NO_SECTION || b.name === NO_SECTION) return Number(a.name === NO_SECTION) - Number(b.name === NO_SECTION);
  return a.name.localeCompare(b.name, 'ru');
}

export function groupByPath(items: HtmlCase[], names: ProjectNames = {}): PathGroup {
  const empty = (name: string, project = false): PathGroup => ({
    name,
    count: 0,
    project,
    automated: 0,
    manual: 0,
    cases: [],
    children: [],
  });
  const root = empty('');
  const manyProjects = new Set(items.map((i) => i.tc.projectId)).size > 1;
  const projectNodes = new Map<number | null, PathGroup>();
  for (const item of items) {
    const sections = item.tc.path.length ? item.tc.path : [NO_SECTION];
    let node = root;
    if (manyProjects) {
      let project = projectNodes.get(item.tc.projectId);
      if (!project) {
        project = empty(projectLabel(item.tc.projectId, names), true);
        projectNodes.set(item.tc.projectId, project);
        root.children.push(project);
      }
      node = project;
    }
    for (const part of sections) {
      let next = node.children.find((c) => c.name === part);
      if (!next) {
        next = empty(part);
        node.children.push(next);
      }
      node = next;
    }
    node.cases.push(item);
  }
  const count = (n: PathGroup): number => {
    n.children.sort(bySection);
    for (const child of n.children) count(child);
    n.count = n.cases.length + n.children.reduce((s, c) => s + c.count, 0);
    n.automated =
      n.cases.filter((c) => c.tc.automated).length +
      n.children.reduce((s, c) => s + c.automated, 0);
    n.manual = n.count - n.automated;
    return n.count;
  };
  count(root);
  return root;
}

function page(title: string, body: string): string {
  return `<!doctype html>
<html lang="ru"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(title)}</title><style>${STYLE}</style></head>
<body>
${body}
</body></html>`;
}

const groupCounts = (g: PathGroup): string => {
  const parts: string[] = [];
  if (g.automated)
    parts.push(
      `<span class="tally type_auto" title="автоматизировано">${ICON_AUTO}${g.automated}</span>`,
    );
  if (g.manual)
    parts.push(`<span class="tally type_manual" title="ручных">${ICON_MANUAL}${g.manual}</span>`);
  return parts.join('');
};

function copyButton(c: HtmlCase, baseUrl: string): string {
  if (!baseUrl || c.tc.projectId === null) return '';
  return `<button class="ctl ctl_copy" data-act="copy" data-case-name="${escapeHtml(
    c.tc.name,
  )}" data-case-url="${escapeHtml(
    caseUrl(baseUrl, c.tc.projectId, c.tc.id),
  )}" aria-label="Скопировать ссылку на кейс ${escapeHtml(c.tc.id)}" title="Скопировать имя и ссылку">${ICON_COPY}</button>`;
}

export function renderCaseHtml(
  c: HtmlCase,
  p: FormatProfile,
  assets: EmbeddedAssets,
  baseUrl = '',
  people: PeopleNames = {},
  filter = '',
): string {
  return page(
    `${c.tc.id} · ${c.tc.name}`,
    `<h1>${typeIcon(c.tc)}${caseId(c.tc, baseUrl)} ${escapeHtml(c.tc.name)}${copyButton(c, baseUrl)}</h1>\n${filter}${caseBody(c, p, assets, baseUrl, people)}\n${HANDLER}`,
  );
}

function caseBlock(
  c: HtmlCase,
  p: FormatProfile,
  assets: EmbeddedAssets,
  baseUrl: string,
  people: PeopleNames,
  depth = 0,
): string {
  const marks: string[] = [];
  if (p.showMarks && c.state !== 'current')
    marks.push(`<span class="tag warn">${STATE_LABEL[c.state]}</span>`);
  const retired = /inactive|outdated|deprecated|archiv/i.test(c.tc.status);
  if (c.tc.status)
    marks.push(
      `<span class="tag${retired ? ' tag_retired' : ''}">${escapeHtml(c.tc.status)}</span>`,
    );
  if (c.tc.comments.length)
    marks.push(`<span class="tag">комментариев: ${c.tc.comments.length}</span>`);

  const copy = copyButton(c, baseUrl);
  const top = TOOLBAR_H + FILTER_H + depth * GROUP_H;
  const find = escapeHtml(`${c.tc.id} ${c.tc.name}`.toLowerCase());
  return `<details class="case" id="case-${escapeHtml(c.tc.id)}" data-find="${find}"><summary style="--sticky-top:${top}px;--sticky-z:${60 - depth}">${typeIcon(c.tc)}${caseId(c.tc, baseUrl)}<span class="caseName">${escapeHtml(
    c.tc.name,
  )}</span>${marks.join('')}${copy}</summary>\n<div class="caseInner">${caseBody(c, p, assets, baseUrl, people)}</div>\n</details>`;
}

const TOOLBAR_H = 44;
const FILTER_H = 36;
const GROUP_H = 30;

function groupBlock(
  g: PathGroup,
  p: FormatProfile,
  assets: EmbeddedAssets,
  baseUrl: string,
  people: PeopleNames,
  depth: number,
  ids: { next: number },
): string {
  const id = `section-${ids.next++}`;
  const top = TOOLBAR_H + FILTER_H + depth * GROUP_H;
  const style = ` style="--sticky-top:${top}px;--sticky-z:${60 - depth};--anchor-offset:${top + GROUP_H + 8}px"`;

  const inner = [
    ...g.children.map((c) => groupBlock(c, p, assets, baseUrl, people, depth + 1, ids)),
    ...g.cases.map((c) => caseBlock(c, p, assets, baseUrl, people, depth + 1)),
  ].join('\n');

  return `<details class="group" data-depth="${depth}"><summary id="${id}"${style} title="${escapeHtml(
    g.name,
  )}"><span class="twisty" aria-hidden="true"></span><span class="groupName">${escapeHtml(
    g.name,
  )}</span>${groupCounts(g)}<span class="sectionCtl"><button class="ctl" data-act="open-section" aria-label="Развернуть всё в разделе «${escapeHtml(
    g.name,
  )}»" title="Развернуть всё внутри этого раздела">развернуть всё</button><button class="ctl" data-act="collapse-section" aria-label="Свернуть раздел «${escapeHtml(
    g.name,
  )}»" title="Свернуть только этот раздел">свернуть</button></span></summary>
${inner}
</details>`;
}

function tocTree(node: PathGroup, trail: string[], ids: { next: number }): string {
  const items = node.children
    .map((child) => {
      const id = `section-${ids.next++}`;
      const path = [...trail, child.name];
      const inner = tocTree(child, path, ids);
      return `<li data-search="${escapeHtml(path.join(' ').toLowerCase())}"><div class="tocRow"><a href="#${id}" data-section-target="${id}">${escapeHtml(
        child.name,
      )}</a>${groupCounts(child)}</div>${inner}</li>`;
    })
    .join('');
  return items ? `<ul>${items}</ul>` : '';
}

function countSections(g: PathGroup): number {
  return g.children.reduce((sum, c) => sum + (c.project ? 0 : 1) + countSections(c), 0);
}

function zeroState(cases: HtmlCase[], tree: PathGroup, names: ProjectNames): string {
  const automated = cases.filter((c) => c.tc.automated).length;
  const projects = [...new Set(cases.map((c) => projectLabel(c.tc.projectId, names)))];
  const row = (label: string, value: string) =>
    `<dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd>`;
  const rows = [
    row('Кейсов', String(cases.length)),
    row('Из них автоматизировано', String(automated)),
    row('Разделов', String(countSections(tree))),
    row(projects.length > 1 ? 'Проекты' : 'Проект', projects.join(', ')),
  ].join('');
  return `<div class="paneZero" id="pane-zero"><h2>Выгрузка тест-кейсов</h2><dl>${rows}</dl><p class="paneHint">Выберите кейс слева.</p></div>`;
}

export function renderBatchHtml(
  cases: HtmlCase[],
  p: FormatProfile,
  assets: EmbeddedAssets,
  baseUrl = '',
  names: ProjectNames = {},
  people: PeopleNames = {},
  filter = '',
): string {
  const only = cases[0];
  if (cases.length === 1 && only) return renderCaseHtml(only, p, assets, baseUrl, people, filter);

  const tree = groupByPath(cases, names);
  const blockIds = { next: 0 };
  const blocks = tree.children
    .map((g) => groupBlock(g, p, assets, baseUrl, people, 0, blockIds))
    .join('\n');
  const toc = tocTree(tree, [], { next: 0 });

  const withMarks = cases.filter((c) => c.state !== 'current').length;
  const summary = p.showMarks
    ? `<p class="summary">Кейсов: ${cases.length}. Требуют переписывания перед автоматизацией: ${withMarks}.</p>`
    : '';

  const toolbar =
    '<div id="top-sentinel" aria-hidden="true"></div>' +
    '<nav class="toolbar" id="page-top" tabindex="-1" aria-label="Управление выгрузкой">' +
    '<button class="ctl ctl_toc" data-act="toc" aria-expanded="false">разделы</button>' +
    '<button class="ctl ctl_view" data-act="view" title="Документ или две колонки">две колонки</button>' +
    '<span class="toolbarScope">вся выгрузка:</span>' +
    '<button class="ctl" data-act="open-all">развернуть всё</button>' +
    '<button class="ctl" data-act="close-all">свернуть всё</button>' +
    '</nav>';

  const panel = toc
    ? `<aside class="toc" id="section-toc" hidden aria-label="Разделы"><div class="tocHead"><strong>Разделы</strong><button class="ctl" data-act="close-toc" aria-label="Закрыть оглавление">×</button></div><input class="tocSearch" type="search" placeholder="Найти раздел" autocomplete="off" aria-label="Найти раздел"><nav class="tocTree">${toc}</nav></aside>`
    : '';

  const toTop =
    '<button class="toTop" type="button" hidden aria-label="В начало страницы">↑</button>';

  const treeFilter =
    '<input class="treeFilter" type="search" autocomplete="off" placeholder="Фильтр по номеру или имени" aria-label="Фильтр кейсов">';
  const gutter =
    '<div id="gutter" role="separator" aria-orientation="vertical" aria-label="Граница колонок"></div>';
  const pane = `<div class="pane" id="pane">${zeroState(cases, tree, names)}</div>`;

  return page(
    `Тест-кейсы (${cases.length})`,
    `${toolbar}${summary}${filter}\n${panel}\n<div id="tree">${treeFilter}${blocks}</div>\n${gutter}\n${pane}\n${toTop}\n${HANDLER}`,
  );
}
