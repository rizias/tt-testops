import type { Flags } from './args.js';
import { sourcesOf } from './querySources.js';
import { catalogOutput } from './catalogCommands.js';
import { filterLines } from './filterRows.js';
import type { Gateway } from './gateway.js';
import type { CommandResult } from './output.js';
import { stampFor } from './report.js';

function announceFilter(gw: Gateway): void {
  for (const line of filterLines(gw.filterRows())) process.stderr.write(`${line}\n`);
}

export async function handleList(gw: Gateway, f: Flags): Promise<CommandResult> {
  const sources = sourcesOf(f);
  if (f.format === 'html') {
    const out = await gw.getTestCasesHtml(sources, f.limit);
    announceFilter(gw);
    return { out, htmlName: `cases-${stampFor()}.html` };
  }
  const out = await gw.getTestCasesList(sources, f.limit);
  announceFilter(gw);
  return { out, htmlName: null };
}

export async function handleLink(gw: Gateway, f: Flags): Promise<CommandResult> {
  const all = sourcesOf(f);
  if (all.length > 1)
    throw new Error(
      `link строит одну ссылку, а пар «проект + запрос» передано ${all.length}. Ссылка на выборку из нескольких проектов в TestOps невозможна.`,
    );
  const q = all[0] ?? { rql: '' };
  const hasQuery = !!q.rql || !!q.conditions?.length || q.filterId !== undefined || !!q.text;
  if (!hasQuery) {
    throw new Error('Команде link нужен запрос: AQL, ссылка на фильтр TestOps или фраза --text.');
  }
  return { out: gw.linkFor(q), htmlName: null };
}

export async function handleCatalog(
  cmd: string,
  gw: Gateway,
  f: Flags,
): Promise<CommandResult> {
  const out = await catalogOutput(cmd, gw, f, () => gw.countSources(sourcesOf(f)));
  return { out, htmlName: null };
}
