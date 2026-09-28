import { type EmbeddedAssets, embedAttribute, escapeHtml } from './htmlText.js';
import type { RichMark, RichNode } from './model.js';
import { cleanText } from './text.js';

function pictureOf(n: RichNode, assets: EmbeddedAssets): string {
  const src = (n.attrs?.src ?? n.attrs?.url ?? '').trim();
  if (!src) return '';
  const alt = escapeHtml(n.attrs?.alt ?? '');
  const embedded = embedAttribute('src', src, assets);
  if (embedded) return `<img ${embedded} alt="${alt}">`;
  return `<img src="${escapeHtml(src)}" alt="${alt}">`;
}

const MARK_TAGS: Record<string, string> = {
  code: 'code',
  bold: 'strong',
  strong: 'strong',
  italic: 'em',
  em: 'em',
  underline: 'u',
};

function linkMark(html: string, mark: RichMark): string {
  const raw = (mark.attrs?.href ?? '').trim();
  const href = raw ? cleanText(raw) : '';
  return href ? `<a href="${escapeHtml(href)}" target="_blank" rel="noopener">${html}</a>` : html;
}

function colorMark(html: string, mark: RichMark): string {
  const kind = mark.attrs?.kind ?? 'default';
  return kind === 'default' ? html : `<span class="tc tc-${escapeHtml(kind)}">${html}</span>`;
}

function applyMark(html: string, mark: RichMark): string {
  const tag = MARK_TAGS[mark.type ?? ''];
  if (tag) return `<${tag}>${html}</${tag}>`;
  if (mark.type === 'link') return linkMark(html, mark);
  if (mark.type === 'text_color') return colorMark(html, mark);
  return html;
}

function renderTextNode(n: RichNode): string {
  let html = escapeHtml(cleanText(n.text ?? ''));
  for (const mark of n.marks ?? []) html = applyMark(html, mark);
  return html;
}

function inlineHtml(n: RichNode, assets: EmbeddedAssets): string | null {
  if (n.type === 'image') return pictureOf(n, assets);
  if (n.type === 'text') return renderTextNode(n);
  if (n.type === 'hardBreak' || n.type === 'hard_break') return '<br>';
  if (n.type === 'parameter') return escapeHtml(`{{${n.attrs?.name ?? ''}}}`);
  return null;
}

const BLOCKS = new Set([
  'paragraph',
  'heading',
  'codeBlock',
  'code_block',
  'blockquote',
  'listItem',
  'list_item',
]);

export function renderRich(node: RichNode | null | undefined, assets: EmbeddedAssets = new Map()): string {
  if (!node) return '';
  const blocks: string[] = [];
  let current: string[] = [];
  const flush = (keepEmpty: boolean): void => {
    const html = current.join('');
    if (html || keepEmpty) blocks.push(html);
    current = [];
  };

  const walk = (n: RichNode): void => {
    const inline = inlineHtml(n, assets);
    if (inline !== null) {
      current.push(inline);
      return;
    }
    const block = BLOCKS.has(n.type ?? '');
    if (block) flush(false);
    for (const child of n.content ?? []) walk(child);
    if (block) flush(n.type === 'paragraph');
  };

  walk(node);
  flush(false);
  return blocks.map((html) => `<p class="para">${html || '<br>'}</p>`).join('');
}
