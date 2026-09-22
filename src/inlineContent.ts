import type { RawScenarioStep } from './model.js';
import type { FormatProfile } from './profile.js';
import { stepMarker } from './stepBuilder.js';

export type TextOf = (attachmentId: number, shared?: boolean) => Promise<string | null>;

export interface StepAttachments {
  desc: string | null;
  exp: string | null;
  pictures: string[];
  missing: string[];
}

export async function collectStepAttachments(
  s: RawScenarioStep,
  text: TextOf,
  lostMark: (attachmentId: number) => string,
): Promise<StepAttachments> {
  let desc: string | null = null;
  let exp: string | null = null;
  const pictures: string[] = [];
  const missing: string[] = [];
  for (const a of s.attachments ?? []) {
    if (!a || typeof a.id !== 'number') continue;
    const name = a.name ?? '';
    if (name.startsWith('description')) {
      desc = await text(a.id);
      if (desc === null) missing.push(lostMark(a.id));
    } else if (name.startsWith('expected')) {
      exp = await text(a.id);
      if (exp === null) missing.push(lostMark(a.id));
    } else if ((a.contentType ?? '').startsWith('image/')) {
      pictures.push(`![${name || 'вложение'}](/api/testcase/attachment/${a.id}/content)`);
    }
  }
  return { desc, exp, pictures, missing };
}

export function emitTextLines(
  text: string,
  indent: string,
  cont: string,
  p: FormatProfile,
  startN: number,
): { lines: string[]; n: number } {
  const out: string[] = [];
  let n = startN;
  let first = true;
  for (const raw of text.split('\n')) {
    const line = raw.trimEnd();
    if (!line) continue;
    if (line.trimStart().startsWith('-')) out.push(`${indent}${line}`);
    else if (first) {
      n += 1;
      out.push(`${indent}${stepMarker(p, n)}${line.trimStart()}`);
      first = false;
    } else out.push(`${indent}${cont}${line.trimStart()}`);
  }
  return { lines: out, n };
}
