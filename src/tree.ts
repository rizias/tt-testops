import type { RawCustomField } from './model.js';

export interface ProjectTree {
  id: number;
  name: string;
  fields: Array<{ id: number; name: string }>;
}

export const NO_TREE = 'none';

export type TreeChoice = number | string | null;

export interface TreePick {
  tree: ProjectTree | null;
  ambiguous: boolean;
  missing: string | null;
}

export const shapeOf = (tree: ProjectTree): string => tree.fields.map((f) => f.name).join(' / ');

const sameName = (left: string, right: string): boolean =>
  left.trim().toLowerCase() === right.trim().toLowerCase();

function findTree(trees: ProjectTree[], choice: number | string): ProjectTree | null {
  const text = String(choice).trim();
  if (/^\d+$/.test(text)) return trees.find((t) => t.id === Number(text)) ?? null;
  return trees.find((t) => sameName(t.name, text)) ?? null;
}

const picked = (tree: ProjectTree | null): TreePick => ({ tree, ambiguous: false, missing: null });

function notFound(trees: ProjectTree[], wanted: number | string): TreePick {
  if (trees.length === 0) return picked(null);
  return { tree: null, ambiguous: false, missing: String(wanted) };
}

function unresolved(trees: ProjectTree[], wanted: number | string | null): TreePick {
  if (trees.length <= 1) return picked(trees[0] ?? null);
  if (wanted !== null) return notFound(trees, wanted);
  return { tree: null, ambiguous: true, missing: null };
}

export function pickTree(
  trees: ProjectTree[],
  sources: {
    flag?: TreeChoice;
    link?: number | null;
    config?: TreeChoice;
    shape?: string | null;
  },
): TreePick {
  if (sources.flag === NO_TREE) return picked(null);
  if (sources.flag != null) {
    const exact = findTree(trees, sources.flag);
    if (exact) return picked(exact);
  }
  if (sources.shape) {
    const same = trees.find((t) => shapeOf(t) === sources.shape);
    if (same) return picked(same);
  }
  if (sources.flag != null) return notFound(trees, sources.flag);
  if (sources.link != null) {
    const found = findTree(trees, sources.link);
    if (found) return picked(found);
  }
  if (sources.config === NO_TREE) return picked(null);
  if (sources.config != null) {
    const found = findTree(trees, sources.config);
    if (found) return picked(found);
  }
  return unresolved(trees, sources.config ?? null);
}

export function treePath(fields: RawCustomField[], tree: ProjectTree | null): string[] {
  if (!tree) return [];
  const value = new Map<number, string>();
  for (const c of fields) {
    const id = c.customField?.id;
    const name = c.name ?? '';
    if (typeof id === 'number' && name && !value.has(id)) value.set(id, name);
  }
  return tree.fields.map((f) => value.get(f.id) ?? '').filter((v) => v !== '');
}

export interface TreeAdviceInput {
  projectId: number;
  projectName: string | null;
  trees: ProjectTree[];
  profileFile: string | null;
  missing: string | null;
}

export function treeAdvice(input: TreeAdviceInput): string {
  const { projectId, trees } = input;
  const project = input.projectName ? `${projectId} «${input.projectName}»` : String(projectId);
  const names = trees.map((t) => `«${t.name}»`);
  const reason =
    input.missing === null
      ? 'не выбрано рабочее дерево разделов'
      : `дерева «${input.missing}» у проекта нет: его переименовали, удалили, либо в названии опечатка`;
  const file = input.profileFile ?? 'profile.json действующего профиля (путь покажет tt-testops config)';
  return [
    `Проект ${project}: выгрузка не начата — ${reason}.`,
    'Без дерева у кейсов нет пути, и выгрузка получается плоским списком без разделов.',
    '',
    'Деревья проекта — названия те же, что в интерфейсе TestOps:',
    ...trees.map((t) => `  «${t.name}» — уровней: ${t.fields.length} (${shapeOf(t)})`),
    '',
    `Что сделать. Спросить у человека: какое дерево разделов рабочее для проекта ${project} — ${names.join(', ')}?`,
    'Затем одно из трёх:',
    '  1. На один вызов — добавить к команде флаг с названием дерева:',
    ...trees.map((t) => `       --tree "${t.name}"`),
    `  2. Насовсем — в файле ${file}`,
    '     записать в поле "trees" проект и название дерева (поле уже есть — добавить в него эту пару):',
    ...trees.map((t) => `       "trees": { "${projectId}": "${t.name}" }`),
    `  3. Путь не нужен — флаг --tree ${NO_TREE}, либо "trees": { "${projectId}": "${NO_TREE}" } в том же файле.`,
  ].join('\n');
}
