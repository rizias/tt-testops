import { type EmbeddedAssets, escapeHtml, renderMarkdown } from './htmlText.js';

export interface ScenarioState {
  out: string[];
  depth: number;
  open: boolean;
}

export function adjustListDepth(state: ScenarioState, level: number): void {
  if (state.depth === -1) {
    state.out.push('<ol>');
    state.depth = 0;
    return;
  }
  if (level > state.depth) {
    for (let i = state.depth; i < level; i++) state.out.push('<ol>');
    state.depth = level;
    return;
  }
  if (state.open) state.out.push('</li>');
  for (let i = state.depth; i > level; i--) state.out.push('</ol></li>');
  state.depth = level;
}

function collectExpectedItems(
  lines: string[],
  index: number,
  level: number,
  levelOf: (l: string) => number,
  bodyOf: (i: number, l: string) => string,
  done: Set<number>,
): string[] {
  const inside: string[] = [];
  for (let k = index + 1; k < lines.length; k++) {
    const next = lines[k] ?? '';
    if (!next.trim()) continue;
    if (levelOf(next) <= level) break;
    done.add(k);
    inside.push(`<div class="expItem">${bodyOf(k, next)}</div>`);
  }
  return inside;
}

export function renderExpectedBlock(
  lines: string[],
  index: number,
  level: number,
  line: string,
  inlineExp: boolean,
  expLabel: string,
  levelOf: (l: string) => number,
  bodyOf: (i: number, l: string) => string,
  textOf: (l: string) => string,
  assets: EmbeddedAssets,
  done: Set<number>,
): string {
  const inside: string[] = [];
  if (inlineExp) {
    const rest = textOf(line).replace(/^\*\*[^*]*\*\*\s*/, '');
    inside.push(
      `<div class="expItem">${renderMarkdown(rest, assets).replace(/^<p>|<\/p>\s*$/g, '')}</div>`,
    );
  }
  inside.push(...collectExpectedItems(lines, index, level, levelOf, bodyOf, done));
  return `<div class="exp"><div class="expLabel">${escapeHtml(expLabel)}</div>${inside.join('')}</div>`;
}
