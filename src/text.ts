export const ATTACHMENT_URL = /\/api\/(?:rs\/)?(?:testcase|sharedstep)\/attachment\/(\d+)\/content/g;

export const attachmentKey = (url: string, id: string): number =>
  url.includes('/sharedstep/') ? -Number(id) : Number(id);

export function toLf(text: string): string {
  return text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}

export function cleanText(raw: string | null | undefined): string {
  return raw ? toLf(raw) : '';
}
