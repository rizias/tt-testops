import type { Flags } from './args.js';
import type { Gateway } from './gateway.js';
import type { CustomFieldValue } from './testops/client.js';

export const CATALOG_COMMANDS = ['fields', 'trees', 'projects', 'count'];

const num = (n: number): string => String(n).padStart(6);

function valueLines(values: CustomFieldValue[]): string {
  return (
    values.map((v) => `${num(v.testCasesCount)}  ${v.name}`).join('\n') || 'У поля нет значений.'
  );
}

async function fieldsOutput(gw: Gateway, f: Flags): Promise<string> {
  const project = f.projects[0];
  if (f.find !== undefined) {
    if (!f.find.trim())
      throw new Error('Флагу --find нужно слово для поиска, пустая строка не подходит.');
    const found = await gw.findValues(f.find, project);
    if (f.format === 'json') return JSON.stringify(found, null, 2);
    if (!found.length) {
      return `«${f.find}» не встречается ни в значениях полей, ни в слоях проекта ${gw.projectIdOf(project)}.`;
    }
    return found.map((v) => `${num(v.cases)}  ${v.condition}`).join('\n');
  }
  const name = f._[0];
  if (name) {
    const values = await gw.fieldValues(name, project);
    return f.format === 'json' ? JSON.stringify(values, null, 2) : valueLines(values);
  }
  const overview = await gw.overview(project);
  if (f.format === 'json') return JSON.stringify(overview, null, 2);
  const lines = [`Поля проекта ${gw.projectIdOf(project)} — значений в каждом:`];
  for (const field of overview.fields) {
    lines.push(`${num(field.values)}  ${field.name}\tcf["${field.name}"]`);
  }
  if (!overview.fields.length) lines.push('В проекте нет кастомных полей.');
  lines.push('', 'Слои проекта:');
  for (const layer of overview.layers) {
    lines.push(`${num(layer.testCasesCount)}  ${layer.name}\tlayer = "${layer.name}"`);
  }
  if (!overview.layers.length) lines.push('Слоями в проекте не помечен ни один кейс.');
  return lines.join('\n');
}

async function treesOutput(gw: Gateway, f: Flags): Promise<string> {
  const project = gw.projectIdOf(f.projects[0]);
  const trees = await gw.projectTrees(project);
  const working = await gw.workingTreeOf(project);
  if (f.format === 'json') {
    return JSON.stringify({ project, working: working?.id ?? null, trees }, null, 2);
  }
  if (!trees.length) {
    return `У проекта ${project} нет деревьев разделов: путь кейсов будет пустым.`;
  }
  const lines = trees.map((t) => {
    const mark = working && working.id === t.id ? ' ← рабочее' : '';
    const fields = t.fields.map((x) => x.name).join(' / ');
    return `  «${t.name}»${mark} — идентификатор ${t.id}\n        уровни: ${fields}\n        выбрать: --tree "${t.name}"  либо  "trees": { "${project}": "${t.name}" } в profile.json`;
  });
  return [`Деревья проекта ${project}:`, ...lines].join('\n');
}

async function projectsOutput(gw: Gateway, f: Flags): Promise<string> {
  const r = await gw.projects();
  if (f.format === 'json') return JSON.stringify(r, null, 2);
  const mark = (onServer: boolean | null) =>
    onServer === null ? '?' : onServer ? 'есть' : 'НЕТ на сервере';
  const lines = ['Согласованный список (из конфигурации):'];
  for (const p of r.agreed)
    lines.push(`  ${String(p.id).padStart(4)}  ${p.name} — ${mark(p.onServer)}`);
  if (!r.serverReachable) {
    lines.push(
      '',
      `Сверить с сервером не удалось (${r.serverError ?? 'причина неизвестна'}) — показан только список из конфигурации.`,
    );
  } else if (r.notInConfig.length) {
    lines.push('', 'Есть на сервере, но в конфигурацию не внесены:');
    for (const p of r.notInConfig) lines.push(`  ${String(p.id).padStart(4)}  ${p.name}`);
  }
  return lines.join('\n');
}

export async function catalogOutput(
  cmd: string,
  gw: Gateway,
  f: Flags,
  counts: () => Promise<Array<{ project: number; count: number }>>,
): Promise<string> {
  if (cmd === 'fields') return fieldsOutput(gw, f);
  if (cmd === 'trees') return treesOutput(gw, f);
  if (cmd === 'projects') return projectsOutput(gw, f);
  const found = await counts();
  if (f.format === 'json') return JSON.stringify(found, null, 2);
  if (found.length === 1 && found[0] !== undefined) return String(found[0].count);
  return found.map((c) => `${c.project}\t${c.count}`).join('\n');
}
