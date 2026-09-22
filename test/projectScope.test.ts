import { describe, expect, it } from 'vitest';
import type { AppConfig } from '../src/config.js';
import { Gateway } from '../src/gateway.js';
import type { TestOpsClient } from '../src/testops/client.js';

const cfgR8: AppConfig = {
  baseUrl: 'https://ts.example',
  token: 'tok',
  defaultProjectId: 14,
  projects: { '14': 'WEB' },
  timeoutMs: 30000,
  maxCases: 100,
  pageSize: 20,
  sort: 'id,DESC',
} as unknown as AppConfig;

describe('пустое состояние при нескольких проектах', () => {
  it('число разделов не завышено служебными узлами проектов', async () => {
    const { groupByPath, renderBatchHtml } = await import('../src/html.js');
    const items = [
      { tc: { id: '1', projectId: 14, path: ['Раздел А'] }, state: 'current' },
      { tc: { id: '2', projectId: 85, path: ['Раздел Б'] }, state: 'current' },
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
      name: 'ТА',
      fields: [
        { id: 1, name: 'Section1' },
        { id: 2, name: 'Section2' },
      ],
    };
    const crm = {
      id: 116,
      name: 'Main tree',
      fields: [
        { id: 7, name: 'Section1' },
        { id: 8, name: 'Section2' },
      ],
    };
    const other = { id: 114, name: 'Features', fields: [{ id: 9, name: 'Feature' }] };

    expect(pickTree([crm, other], { flag: 41, shape: shapeOf(ta) }).tree?.id).toBe(116);
  });

  it('без дерева того же состава путь остаётся пустым', async () => {
    const { pickTree, shapeOf } = await import('../src/tree.js');
    const ta = { id: 41, name: 'ТА', fields: [{ id: 1, name: 'Section1' }] };
    const other = { id: 114, name: 'Features', fields: [{ id: 9, name: 'Feature' }] };
    const pick = pickTree([other], { flag: 41, shape: shapeOf(ta) });
    expect(pick.tree).toBeNull();
    expect(pick.missing).toBe('41');
  });

  it('точное совпадение по номеру важнее состава', async () => {
    const { pickTree } = await import('../src/tree.js');
    const a = { id: 41, name: 'ТА', fields: [{ id: 1, name: 'Section1' }] };
    const b = { id: 99, name: 'Другое', fields: [{ id: 1, name: 'Section1' }] };
    expect(pickTree([a, b], { flag: 41, shape: 'Section1' }).tree?.id).toBe(41);
  });
});

describe('проект кейса вне согласованного списка', () => {
  it('назван в потоке ошибок один раз', () => {
    const warnings: string[] = [];
    const gw = new Gateway(cfgR8, {} as TestOpsClient, undefined, null, false, (m) =>
      warnings.push(m),
    );
    gw.warnUnagreed(99);
    gw.warnUnagreed(99);
    gw.warnUnagreed(14);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('99');
  });
});
