export interface CfCondition {
  field: string;
  value: string;
}

const CF_EQUALITY = /(^|[\s(])cf\["([^"]+)"\]\s*=\s*"([^"]*)"/g;
const CF_IN = /(^|[\s(])cf\["([^"]+)"\]\s*in\s*\[([^\]]*)\]/gi;
const CF_ANY = /(^|[\s(])cf\["([^"]+)"\]/g;
const NEGATED_BEFORE = /\bnot\s*\(?\s*$/i;

function listValues(body: string): string[] {
  const out: string[] = [];
  for (const m of body.matchAll(/"([^"]*)"|([^,\s][^,]*)/g)) {
    const value = (m[1] ?? m[2] ?? '').trim();
    if (value) out.push(value);
  }
  return out;
}

function negated(rql: string, m: RegExpMatchArray): boolean {
  const before = `${rql.slice(0, m.index ?? 0)}${m[1] ?? ''}`;
  return NEGATED_BEFORE.test(`${before.trimEnd()} `);
}

function equalityConditions(rql: string): CfCondition[] {
  const out: CfCondition[] = [];
  for (const m of rql.matchAll(CF_EQUALITY)) {
    const [field, value] = [m[2], m[3]];
    if (!negated(rql, m) && field !== undefined && value !== undefined) out.push({ field, value });
  }
  return out;
}

function inConditions(rql: string): CfCondition[] {
  const out: CfCondition[] = [];
  for (const m of rql.matchAll(CF_IN)) {
    const field = m[2];
    if (field === undefined || negated(rql, m)) continue;
    for (const value of listValues(m[3] ?? '')) out.push({ field, value });
  }
  return out;
}

export function extractCfConditions(rql: string): CfCondition[] {
  const out = [...equalityConditions(rql), ...inConditions(rql)];
  for (const m of rql.matchAll(CF_ANY)) {
    const field = m[2];
    if (field !== undefined && !out.some((c) => c.field === field)) out.push({ field, value: '' });
  }
  return out;
}

const LAYER_EQUALITY = /(^|[\s(])layer\s*=\s*"([^"]*)"/gi;
const LAYER_IN = /(^|[\s(])layer\s+in\s*\[([^\]]*)\]/gi;

export function extractLayerValues(rql: string): string[] {
  const out: string[] = [];
  const push = (value: string) => {
    if (value && !out.includes(value)) out.push(value);
  };
  for (const m of rql.matchAll(LAYER_EQUALITY)) {
    if (negated(rql, m)) continue;
    push(m[2] ?? '');
  }
  for (const m of rql.matchAll(LAYER_IN)) {
    if (negated(rql, m)) continue;
    for (const value of listValues(m[2] ?? '')) push(value);
  }
  return out;
}

type IdToken = { kind: 'number'; value: number } | { kind: 'symbol'; value: string };

function idTokens(rql: string): IdToken[] | null {
  const tokens: IdToken[] = [];
  const token = /\s+|\d+|[()[\],=]|[A-Za-z_]+/y;
  let at = 0;
  while (at < rql.length) {
    token.lastIndex = at;
    const match = token.exec(rql);
    if (!match) return null;
    at = token.lastIndex;
    const value = match[0];
    if (/^\s+$/.test(value)) continue;
    if (/^\d+$/.test(value)) {
      const id = Number(value);
      if (!Number.isSafeInteger(id)) return null;
      tokens.push({ kind: 'number', value: id });
    } else {
      tokens.push({ kind: 'symbol', value: value.toLowerCase() });
    }
  }
  return tokens;
}

export function idsOnly(rql: string): number[] | null {
  const tokens = idTokens(rql);
  if (!tokens?.length) return null;
  let at = 0;
  const ids: number[] = [];
  const symbol = (value: string): boolean => {
    const current = tokens[at];
    if (current?.kind !== 'symbol' || current.value !== value) return false;
    at++;
    return true;
  };
  const number = (): number | null => {
    const current = tokens[at];
    if (current?.kind !== 'number') return null;
    at++;
    return current.value;
  };

  const condition = (): boolean => {
    if (!symbol('id')) return false;
    if (symbol('=')) {
      const id = number();
      if (id === null) return false;
      ids.push(id);
      return true;
    }
    if (!symbol('in') || !symbol('[')) return false;
    const first = number();
    if (first === null) return false;
    ids.push(first);
    while (symbol(',')) {
      const next = number();
      if (next === null) return false;
      ids.push(next);
    }
    return symbol(']');
  };

  const term = (): boolean => {
    if (!symbol('(')) return condition();
    if (!expression() || !symbol(')')) return false;
    return true;
  };
  const expression = (): boolean => {
    if (!term()) return false;
    while (symbol('or')) if (!term()) return false;
    return true;
  };

  return expression() && at === tokens.length ? ids : null;
}

const HOMOGLYPHS: Record<string, string> = {
  а: 'a',
  в: 'b',
  с: 'c',
  е: 'e',
  н: 'h',
  к: 'k',
  м: 'm',
  о: 'o',
  р: 'p',
  т: 't',
  х: 'x',
  у: 'y',
};

function normalize(s: string): string {
  return [...s.trim().toLowerCase().replace(/\s+/g, ' ')]
    .map((ch) => HOMOGLYPHS[ch] ?? ch)
    .join('');
}

export function findSimilar(wanted: string, candidates: string[]): string[] {
  const key = normalize(wanted);
  return candidates.filter((c) => normalize(c) === key && c !== wanted);
}

export function describeChoices(similar: string[], all: string[]): string {
  if (similar.length) return `Похоже на: ${similar.map((s) => `«${s}»`).join(', ')}.`;
  if (!all.length) return 'Доступных вариантов нет.';
  return `Доступно: ${all.join(', ')}.`;
}
