import type { RawScenarioStep, StepExtra } from './model.js';

export type TextOf = (attachmentId: number, shared?: boolean) => Promise<string | null>;

export interface StepAttachments {
  desc: string[];
  exp: string[];
  docs: string[];
  extras: StepExtra[];
}

async function readText(id: number, text: TextOf, lost: StepExtra[]): Promise<string | null> {
  const body = await text(id);
  if (body === null) lost.push({ kind: 'lost', id });
  return body;
}

function sinkFor(
  name: string,
  contentType: string | undefined,
  desc: string[],
  exp: string[],
  docs: string[],
): string[] | null {
  if (name.startsWith('description')) return desc;
  if (name.startsWith('expected')) return exp;
  return contentType === 'text/markdown' ? docs : null;
}

export async function collectStepAttachments(
  s: RawScenarioStep,
  text: TextOf,
): Promise<StepAttachments> {
  const desc: string[] = [];
  const exp: string[] = [];
  const lost: StepExtra[] = [];
  const docs: string[] = [];
  const pictures: StepExtra[] = [];
  const files: StepExtra[] = [];
  for (const a of s.attachments ?? []) {
    if (!a || typeof a.id !== 'number') continue;
    const name = a.name ?? '';
    const url = `/api/testcase/attachment/${a.id}/content`;
    const target = sinkFor(name, a.contentType, desc, exp, docs);
    if (target) {
      const body = await readText(a.id, text, lost);
      if (body !== null) target.push(body);
    } else if ((a.contentType ?? '').startsWith('image/')) {
      pictures.push({ kind: 'link', markdown: `![${name}](${url})` });
    } else {
      files.push({ kind: 'file', markdown: `[${name || url}](${url})` });
    }
  }
  return { desc, exp, docs, extras: [...lost, ...pictures, ...files] };
}
