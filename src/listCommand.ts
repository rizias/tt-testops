import { sourcesOf, type Flags } from './args.js';
import { catalogOutput } from './catalogCommands.js';
import type { Gateway } from './gateway.js';
import type { CommandResult } from './output.js';
import { stampFor } from './report.js';

export async function handleList(gw: Gateway, f: Flags): Promise<CommandResult> {
  const sources = sourcesOf(f);
  if (f.format === 'html') {
    const out = await gw.getTestCasesHtml(sources, f.limit);
    return { out, htmlName: `cases-${stampFor()}.html` };
  }
  const out =
    f.format === 'json'
      ? JSON.stringify(await gw.searchCasesJson(sources, f.limit), null, 2)
      : await gw.getTestCasesList(sources, f.limit);
  return { out, htmlName: null };
}

export async function handleAudit(gw: Gateway, f: Flags): Promise<CommandResult> {
  const found = await gw.searchCasesJson(sourcesOf(f), f.limit);
  if (f.format === 'json') {
    return { out: JSON.stringify(found.audit, null, 2), htmlName: null };
  }
  if (!found.cases.length) {
    return { out: 'По данному запросу кейсов не найдено.', htmlName: null };
  }
  const out =
    found.audit.map((a) => `${a.caseId}\t${a.severity}\t${a.message}`).join('\n') ||
    `Пометок нет: проверено кейсов ${found.cases.length}.`;
  return { out, htmlName: null };
}

export async function handleLink(gw: Gateway, f: Flags): Promise<CommandResult> {
  const all = sourcesOf(f);
  if (all.length > 1)
    throw new Error(
      `link строит одну ссылку, а пар «проект + запрос» передано ${all.length}. Ссылка на выборку из нескольких проектов в TestOps невозможна.`,
    );
  const q = all[0] ?? { rql: '' };
  if (!q.rql) throw new Error('link <запрос> required');
  const url = gw.linkFor(q.rql, q.project);
  const out = f.format === 'json' ? JSON.stringify({ url, rql: q.rql }, null, 2) : url;
  return { out, htmlName: null };
}

export async function handleCatalog(
  cmd: string,
  gw: Gateway,
  f: Flags,
): Promise<CommandResult> {
  const out = await catalogOutput(cmd, gw, f, () => gw.countSources(sourcesOf(f)));
  return { out, htmlName: null };
}
