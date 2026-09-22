import {
  type EmbeddedAssets,
  embedAttribute,
  escapeHtml,
  renderMarkdown,
  SAFE_HREF,
} from './htmlText.js';
import { adjustListDepth, renderExpectedBlock, type ScenarioState } from './htmlRichSteps.js';
import type { RichMark, RichNode } from './model.js';
import type { FormatProfile } from './profile.js';
import { cleanText } from './text.js';

function pictureOf(n: RichNode, assets: EmbeddedAssets): string {
  const src = (n.attrs?.src ?? n.attrs?.url ?? '').trim();
  if (!src) return '';
  const alt = escapeHtml(n.attrs?.alt ?? 'вложение');
  const embedded = embedAttribute('src', src, assets);
  if (embedded) return `<img ${embedded} alt="${alt}">`;
  return SAFE_HREF.test(src) ? `<img src="${escapeHtml(src)}" alt="${alt}">` : '';
}

function applyMark(html: string, mark: RichMark, p: FormatProfile): string {
  if (mark.type === 'code') return `<code>${html}</code>`;
  if (mark.type === 'bold' || mark.type === 'strong') return `<strong>${html}</strong>`;
  if (mark.type === 'italic' || mark.type === 'em') return `<em>${html}</em>`;
  if (mark.type === 'underline') return `<u>${html}</u>`;
  if (mark.type === 'link') {
    const raw = (mark.attrs?.href ?? '').trim();
    const href = SAFE_HREF.test(raw) ? cleanText(raw, p.removeLinks) : '';
    if (href) return `<a href="${escapeHtml(href)}" target="_blank" rel="noopener">${html}</a>`;
  }
  return html;
}

function renderTextNode(n: RichNode, p: FormatProfile): string {
  let html = escapeHtml(cleanText(n.text ?? '', p.removeLinks));
  for (const mark of n.marks ?? []) html = applyMark(html, mark, p);
  return html;
}

export function renderRich(
  node: RichNode | null | undefined,
  p: FormatProfile,
  assets: EmbeddedAssets = new Map(),
): string {
  if (!node) return '';
  const paragraphs: string[] = [];
  let current: string[] = [];

  const walk = (n: RichNode): void => {
    if (n.type === 'image') {
      const picture = pictureOf(n, assets);
      if (picture) current.push(picture);
      return;
    }
    if (n.type === 'text') {
      current.push(renderTextNode(n, p));
      return;
    }
    if (n.type === 'hardBreak' || n.type === 'hard_break') {
      current.push(' ');
      return;
    }
    if (n.type === 'paragraph') {
      current = [];
      for (const child of n.content ?? []) walk(child);
      const text = current.join('');
      if (text) paragraphs.push(text);
      return;
    }
    for (const child of n.content ?? []) walk(child);
  };

  walk(node);
  if (!paragraphs.length) {
    const only = current.join('');
    return only;
  }
  return paragraphs.join(' ');
}

const SCENARIO_MARKER = /^(\d+\.|[-*])\s+/;

function plainText(s: string): string {
  return s.replace(/\*\*/g, '').trim();
}

export function renderScenario(
  lines: string[],
  p: FormatProfile,
  assets: EmbeddedAssets,
  rich?: (RichNode | null)[],
): string {
  const unit = p.steps.indent.length || 2;
  const levelOf = (l: string) => Math.floor((l.length - l.trimStart().length) / unit);
  const textOf = (l: string) => l.trimStart().replace(SCENARIO_MARKER, '');

  if (!lines.some((l) => SCENARIO_MARKER.test(l.trimStart()))) return '';

  const state: ScenarioState = { out: [], depth: -1, open: false };
  const expLabel = plainText(p.steps.expectedBlock);
  const done = new Set<number>();

  const bodyOf = (index: number, line: string): string => {
    const marked = rich?.[index] ? renderRich(rich[index], p, assets) : '';
    return marked || renderMarkdown(textOf(line), assets).replace(/^<p>|<\/p>\s*$/g, '');
  };

  for (const [index, line] of lines.entries()) {
    if (!line.trim() || done.has(index)) continue;
    const level = levelOf(line);

    const bare = plainText(textOf(line));
    const inlineExp = bare.startsWith(`${expLabel}:`);
    if (state.open && (bare === expLabel || inlineExp)) {
      state.out.push(
        renderExpectedBlock(
          lines,
          index,
          level,
          line,
          inlineExp,
          expLabel,
          levelOf,
          bodyOf,
          textOf,
          assets,
          done,
        ),
      );
      continue;
    }

    const inline = bodyOf(index, line);
    adjustListDepth(state, level);
    state.out.push(`<li>${inline}`);
    state.open = true;
  }

  if (state.depth === -1) return '';
  if (state.open) state.out.push('</li>');
  for (let i = state.depth; i > 0; i--) state.out.push('</ol></li>');
  state.out.push('</ol>');
  return state.out.join('');
}
