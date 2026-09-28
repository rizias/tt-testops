import { describe, expect, it } from 'vitest';

describe('пустое состояние при нескольких проектах', () => {
  it('число разделов не завышено служебными узлами проектов', async () => {
    const { groupByPath, renderBatchHtml } = await import('../src/html.js');
    const items = [
      { tc: { id: '1', projectId: 1, path: ['Раздел А'] }, state: 'current' },
      { tc: { id: '2', projectId: 2, path: ['Раздел Б'] }, state: 'current' },
    ] as never[];
    const tree = groupByPath(items, {});
    expect(tree.children.every((c) => c.project)).toBe(true);
    expect(renderBatchHtml).toBeTypeOf('function');
  });
});

describe('дерево того же состава в другом проекте', () => {
  it('находится по набору полей, даже если названо иначе', async () => {
    const { pickTree, shapeOf } = await import('../src/tree.js');
    const ta = {
      id: 41,
      name: 'Дерево А',
      fields: [
        { id: 1, name: 'Поле1' },
        { id: 2, name: 'Поле2' },
      ],
    };
    const crm = {
      id: 116,
      name: 'Дерево Б',
      fields: [
        { id: 7, name: 'Поле1' },
        { id: 8, name: 'Поле2' },
      ],
    };
    const other = { id: 114, name: 'Features', fields: [{ id: 9, name: 'Feature' }] };

    expect(pickTree([crm, other], { flag: 41, shape: shapeOf(ta) }).tree?.id).toBe(116);
  });

  it('без дерева того же состава путь остаётся пустым', async () => {
    const { pickTree, shapeOf } = await import('../src/tree.js');
    const ta = { id: 41, name: 'Дерево А', fields: [{ id: 1, name: 'Поле1' }] };
    const other = { id: 114, name: 'Features', fields: [{ id: 9, name: 'Feature' }] };
    const pick = pickTree([other], { flag: 41, shape: shapeOf(ta) });
    expect(pick.tree).toBeNull();
    expect(pick.missing).toBe('41');
  });

  it('точное совпадение по номеру важнее состава', async () => {
    const { pickTree } = await import('../src/tree.js');
    const a = { id: 41, name: 'Дерево А', fields: [{ id: 1, name: 'Поле1' }] };
    const b = { id: 99, name: 'Другое', fields: [{ id: 1, name: 'Поле1' }] };
    expect(pickTree([a, b], { flag: 41, shape: 'Поле1' }).tree?.id).toBe(41);
  });
});
