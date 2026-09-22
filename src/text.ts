const MD_LINK_URL = /\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g;
const RAW_URL = /https?:\/\/\S+/g;

export function extractDomain(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.protocol}//${parsed.host}`;
  } catch {
    return url;
  }
}

export function toLf(text: string): string {
  return text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}

export function collapseLines(text: string): string {
  return toLf(text)
    .replace(/\s*\n\s*/g, ' ')
    .trim();
}

export function cleanText(raw: string | null | undefined, removeLinks: boolean): string {
  if (!raw) return '';
  const text = toLf(raw);
  if (removeLinks) {
    let out = text.replace(
      MD_LINK_URL,
      (_m, label: string, url: string) => `[${label}](${extractDomain(url)})`,
    );
    out = out.replace(RAW_URL, (m) => extractDomain(m));
    return out.trim();
  }
  return text;
}
