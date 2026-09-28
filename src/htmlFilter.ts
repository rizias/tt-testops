import { type FilterRow, LINK_TOO_LONG } from './filterRows.js';
import { escapeHtml } from './htmlText.js';

function filterRow(r: FilterRow): string {
  const name = escapeHtml(`${r.projectName ?? r.project} · ${r.count}`);
  const parts = r.parts.map((p) => `<span class="filterPart">${escapeHtml(p)}</span>`).join('');
  const link = r.url
    ? `<a class="ctl filterOpen" href="${escapeHtml(r.url)}" target="_blank" rel="noopener">Открыть в TestOps ↗</a>`
    : `<span class="filterMiss">${escapeHtml(LINK_TOO_LONG[0]?.toUpperCase() + LINK_TOO_LONG.slice(1))}</span>`;
  return `<div class="filterRow"><div class="filterProject">${name}</div><div class="filterParts">${parts}</div><div class="filterLink">${link}</div></div>`;
}

export function filterBlock(rows: FilterRow[]): string {
  if (!rows.length) return '';
  return `<section class="block filterBlock" aria-label="Фильтр"><h3>Фильтр</h3>${rows.map(filterRow).join('')}</section>`;
}
