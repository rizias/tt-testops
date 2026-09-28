import { Marked } from 'marked';
import { ATTACHMENT_URL, attachmentKey } from './text.js';

export type EmbeddedAssets = Map<number, string>;

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
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
  const [m] = url.matchAll(ATTACHMENT_URL);
  if (!m) return null;
  const id = Number(m[1]);
  const data = assets.get(attachmentKey(m[0], String(m[1])));
  if (data) return `${attr}="${data}"`;
  return `${attr}="${missingPicture(id)}" data-missing-attachment="${id}"`;
}

const markdown = new Marked({
  breaks: true,
  tokenizer: { html: () => undefined, tag: () => undefined },
});

export function renderMarkdown(md: string, assets: EmbeddedAssets): string {
  const html = (markdown.parse(md, { async: false }) as string).replace(/>\n+/g, '>').replace(/\n+(?=<)/g, '');
  return html.replace(/\s(href|src)="([^"]*)"/g, (whole, attr: string, url: string) => {
    const embedded = embedAttribute(attr, url, assets);
    return embedded ? ` ${embedded}` : whole;
  });
}
