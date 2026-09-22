import type { Flags } from './args.js';
import type { Gateway } from './gateway.js';
import { finish, type CommandResult } from './output.js';
import { stampFor } from './report.js';

export async function caseOutput(
  gw: Gateway,
  id: string,
  format?: string,
): Promise<string | null> {
  if (format === 'html') return gw.getTestCaseHtml(id);
  if (format === 'raw') {
    const raw = await gw.getTestCaseRaw(id);
    return raw ? JSON.stringify(raw, null, 2) : null;
  }
  if (format === 'json') {
    const json = await gw.getTestCaseJson(id);
    return json ? JSON.stringify(json, null, 2) : null;
  }
  return gw.getTestCase(id);
}

export async function printCaseAttachments(gw: Gateway, id: string): Promise<void> {
  for (const saved of (await gw.saveAttachments(id)) ?? []) {
    process.stderr.write(`Вложение ${saved.id}: ${saved.path}\n`);
  }
}

export async function handleCase(gw: Gateway, f: Flags): Promise<CommandResult | number> {
  const id = f._[0];
  if (!id) throw new Error('case <id> required');
  const found = await caseOutput(gw, id, f.format);
  if (found === null) {
    process.stderr.write(`Кейс ${id} не найден.\n`);
    return 1;
  }
  let htmlName: string | null = null;
  if (f.format === 'html') htmlName = `case-${id}-${stampFor()}.html`;
  else await printCaseAttachments(gw, id);
  return { out: found, htmlName };
}

export async function handleAttachments(
  gw: Gateway,
  f: Flags,
  startedAt: number,
): Promise<number> {
  const id = f._[0];
  if (!id) throw new Error('attachments <id> обязателен: tt-testops attachments <id>');
  const saved = await gw.saveAttachments(id, f.out);
  if (saved === null) {
    process.stderr.write(`Кейс ${id} не найден.\n`);
    return 1;
  }
  const out =
    f.format === 'json'
      ? JSON.stringify(saved, null, 2)
      : saved.map((s) => s.path).join('\n') || 'У кейса нет вложений.';
  return finish(out, { ...f, out: undefined }, null, startedAt);
}
