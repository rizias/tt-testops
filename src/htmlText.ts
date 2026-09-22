import { marked } from 'marked';

export const SAFE_HREF = /^(https?:|mailto:)/i;

export type EmbeddedAssets = Map<number, string>;

const ATTACHMENT_URL = /\/api\/(?:rs\/)?(?:testcase|sharedstep)\/attachment\/(\d+)\/content/;

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function decodeEntities(value: string): string {
  return value
    .replace(/&#x([0-9a-f]+);?/gi, (_m, hex) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#(\d+);?/g, (_m, dec) => String.fromCodePoint(Number(dec)))
    .replace(/&(amp|colon|tab|newline|NewLine);?/gi, (_m, name) =>
      name.toLowerCase() === 'amp' ? '&' : name.toLowerCase() === 'colon' ? ':' : '',
    );
}

const ALLOWED = new Set(['http', 'https', 'mailto']);

export function safeUrl(value: string): string {
  const decoded = decodeEntities(value);
  const colon = decoded.indexOf(':');
  if (colon === -1) return value;
  const before = decoded.slice(0, colon);
  if (/[/?#]/.test(before)) return value;
  const scheme = before.replace(/[^a-z]/gi, '').toLowerCase();
  if (!scheme) return value;
  if (scheme === 'data') return decoded.startsWith('data:image/') ? value : '';
  return ALLOWED.has(scheme) ? value : '';
}

const ACTIVE_TAGS = 'script|style|iframe|object|embed|form|base|link|meta|svg|math|applet|frame';
const URL_ATTRS = 'href|src|action|formaction|data|poster|srcset|background|xlink:href';

function stripActiveContent(html: string): string {
  return html
    .replace(new RegExp(`<\\s*(${ACTIVE_TAGS})\\b[\\s\\S]*?<\\s*/\\s*\\1\\s*>`, 'gi'), '')
    .replace(new RegExp(`<\\s*/?\\s*(${ACTIVE_TAGS})\\b[^>]*>`, 'gi'), '')
    .replace(/\son\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    .replace(
      new RegExp(`(${URL_ATTRS})\\s*=\\s*("|')([^"']*)\\2`, 'gi'),
      (_m, attr: string, quote: string, value: string) =>
        `${attr}=${quote}${safeUrl(value)}${quote}`,
    )
    .replace(
      new RegExp(`(${URL_ATTRS})\\s*=\\s*([^\\s">]+)`, 'gi'),
      (_m, attr: string, value: string) => `${attr}="${safeUrl(value)}"`,
    );
}

export function missingPicture(id: number): string {
  const svg = [
    '<svg xmlns="http://www.w3.org/2000/svg" width="320" height="40">',
    '<rect width="320" height="40" fill="#eceff4"/>',
    '<text x="12" y="25" font-family="sans-serif" font-size="13" fill="#616875">',
    `вложение ${id} не скачалось</text></svg>`,
  ].join('');
  return `data:image/svg+xml;base64,${Buffer.from(svg, 'utf8').toString('base64')}`;
}

export function embedAttribute(attr: string, url: string, assets: EmbeddedAssets): string | null {
  const m = ATTACHMENT_URL.exec(url);
  if (!m) return null;
  const id = Number(m[1]);
  const data = assets.get(id);
  if (data) return `${attr}="${data}"`;
  return `${attr}="${missingPicture(id)}" data-missing-attachment="${id}"`;
}

export function renderMarkdown(md: string, assets: EmbeddedAssets): string {
  const html = stripActiveContent(marked.parse(md, { async: false, breaks: true }) as string);
  return html.replace(
    /(src|href)="([^"]*)"/g,
    (whole, attr: string, url: string) => embedAttribute(attr, url, assets) ?? whole,
  );
}
