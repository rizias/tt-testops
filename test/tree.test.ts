import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CaseCache } from '../src/cache.js';
import type { AppConfig } from '../src/config.js';
import { Gateway } from '../src/gateway.js';
import { parseFilterLink } from '../src/links.js';
import type { RawCase, RawOverview } from '../src/model.js';
import type { TestOpsClient } from '../src/testops/client.js';
import { type ProjectTree, pickTree, treePath } from '../src/tree.js';
import { parseFlags } from '../src/args.js';

const wide: ProjectTree = {
  id: 41,
  name: 'Разделы',
  fields: [
    { id: 10, name: 'Уровень 1' },
    { id: 11, name: 'Уровень 2' },
  ],
};
const behaviors: ProjectTree = {
  id: 29,
  name: 'Поведения',
  fields: [{ id: -1, name: 'Тема' }],
};

describe('какое дерево рабочее', () => {
  it('флаг вызова сильнее всего остального', () => {
    const { tree } = pickTree([wide, behaviors], { flag: 29, link: 41, config: 41 });
    expect(tree?.id).toBe(29);
  });

  it('дерево из ссылки сильнее настройки', () => {
    const { tree } = pickTree([wide, behaviors], { link: 29, config: 41 });
    expect(tree?.id).toBe(29);
  });

  it('настройка проекта применяется, когда ни флага, ни ссылки нет', () => {
    const { tree } = pickTree([wide, behaviors], { config: 29 });
    expect(tree?.id).toBe(29);
  });

  it('единственное дерево берётся молча', () => {
    const { tree, ambiguous } = pickTree([wide], {});
    expect(tree?.id).toBe(41);
    expect(ambiguous).toBe(false);
  });

  it('деревьев нет — пути нет, и это не спорный случай', () => {
    const { tree, ambiguous } = pickTree([], {});
    expect(tree).toBeNull();
    expect(ambiguous).toBe(false);
  });

  it('деревьев несколько без выбора — пути нет, случай спорный', () => {
    const { tree, ambiguous } = pickTree([wide, behaviors], {});
    expect(tree).toBeNull();
    expect(ambiguous).toBe(true);
  });

  it('владелец отказался от пути — спора нет', () => {
    const { tree, ambiguous } = pickTree([wide, behaviors], { config: 'none' });
    expect(tree).toBeNull();
    expect(ambiguous).toBe(false);
  });

  it('настройка указывает на дерево, которого у проекта нет', () => {
    const { tree, missing } = pickTree([wide, behaviors], { config: 999 });
    expect(tree).toBeNull();
    expect(missing).toBe('999');
  });
});

describe('путь по дереву', () => {
  it('порядок берётся из дерева, а не из ответа о кейсе', () => {
    const path = treePath(
      [
        { name: 'Второй', customField: { id: 11, name: 'Уровень 2' } },
        { name: 'Первый', customField: { id: 10, name: 'Уровень 1' } },
      ],
      wide,
    );
    expect(path).toEqual(['Первый', 'Второй']);
  });

  it('без дерева путь пуст', () => {
    expect(treePath([{ name: 'Первый', customField: { id: 10 } }], null)).toEqual([]);
  });
});

describe('дерево из ссылки', () => {
  it('разбор ссылки отдаёт дерево наравне с проектом', () => {
    const search = Buffer.from(
      JSON.stringify([{ id: 'aql', value: 'automation = false', type: 'string' }]),
      'utf8',
    ).toString('base64');
    const parsed = parseFilterLink(
      `https://ts.example/project/7/test-cases?treeId=41&search=${encodeURIComponent(search)}`,
    );
    expect(parsed.projectId).toBe(7);
    expect(parsed.treeId).toBe(41);
    expect(parsed.warnings.join(' ')).toContain('не перенесён');
  });
});

const cfg: AppConfig = {
  baseUrl: 'https://x.test',
  token: 'tok',
  defaultProjectId: 7,
  projects: { '7': 'Демо' },
  people: {},
  trees: {},
  timeoutMs: 30000,
  maxCases: 100,
  concurrency: 8,
  retries: 3,
  pageSize: 20,
  sort: 'id,DESC',
  cacheDir: '/tmp/tt-test-cache',
};

const overviewOf = (id: number): RawOverview =>
  ({
    id,
    projectId: 7,
    name: `Кейс ${id}`,
    customFields: [
      { name: 'Первый', customField: { id: 10, name: 'Уровень 1' } },
      { name: 'Тема', customField: { id: -1, name: 'Тема' } },
    ],
    lastModifiedDate: 1,
  }) as RawOverview;

const rawOf = (id: number): RawCase =>
  ({ overview: overviewOf(id), steps: null, comments: [] }) as unknown as RawCase;

const clientWith = (trees: ProjectTree[], log: { calls: number }): TestOpsClient =>
  ({
    fetchOverview: async (id: string) => overviewOf(Number(id)),
    fetchCaseFromOverview: async (ov: RawOverview) => rawOf(Number(ov.id)),
    fetchAttachmentContent: async () => '',
    fetchTrees: async () => {
      log.calls++;
      return trees;
    },
  }) as unknown as TestOpsClient;

describe('список деревьев и хранилище', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'tt-trees-'));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('второй вызов берёт список из хранилища', async () => {
    const log = { calls: 0 };
    const cache = new CaseCache(dir);
    const make = () => new Gateway(cfg, clientWith([wide], log), undefined, cache, false, () => {});

    await make().getTestCase('1');
    await make().getTestCase('2');

    expect(log.calls).toBe(1);
  });

  it('флаг --refresh перечитывает список заново', async () => {
    const log = { calls: 0 };
    const cache = new CaseCache(dir);
    await new Gateway(cfg, clientWith([wide], log), undefined, cache, false, () => {}).getTestCase(
      '1',
    );
    await new Gateway(cfg, clientWith([wide], log), undefined, cache, true, () => {}).getTestCase(
      '2',
    );

    expect(log.calls).toBe(2);
  });

  it('внутри одного вызова список запрашивается один раз на проект', async () => {
    const log = { calls: 0 };
    const gw = new Gateway(cfg, clientWith([wide], log), undefined, null, false, () => {});

    await gw.getTestCase('1');
    await gw.getTestCase('2');
    await gw.getTestCase('3');

    expect(log.calls).toBe(1);
  });

  it('деревьев несколько без выбора — case останавливается с перечнем деревьев и способов', async () => {
    const gw = new Gateway(cfg, clientWith([wide, behaviors], { calls: 0 }), undefined, null, false, () => {});
    gw.useTree(null, {}, true);

    const failure = await gw.getTestCase('1').then(
      () => null,
      (error: Error) => error.message,
    );

    expect(failure).toContain('«Разделы» — уровней: 2 (Уровень 1 / Уровень 2)');
    expect(failure).toContain('«Поведения» — уровней: 1 (Тема)');
    expect(failure).toContain('--tree "Разделы"');
    expect(failure).toContain('--tree "Поведения"');
    expect(failure).toContain('--tree none');
  });

  it('list останавливается до скачивания первого кейса', async () => {
    let searched = 0;
    const client = {
      ...clientWith([wide, behaviors], { calls: 0 }),
      searchAll: async () => {
        searched++;
        return { items: [], total: 0 };
      },
    } as unknown as TestOpsClient;
    const gw = new Gateway(cfg, client, undefined, null, false, () => {});
    gw.useTree(null, {}, true);

    await expect(gw.getTestCasesList([{ project: '14', rql: 'id > 0' }])).rejects.toThrow(
      'не выбрано рабочее дерево разделов',
    );
    await expect(gw.getTestCasesHtml([{ project: '14', rql: 'id > 0' }])).rejects.toThrow(
      'не выбрано рабочее дерево разделов',
    );
    await expect(gw.searchCasesJson([{ project: '14', rql: 'id > 0' }])).rejects.toThrow(
      'не выбрано рабочее дерево разделов',
    );
    expect(searched).toBe(0);
  });

  it('--tree none: путь пуст, ни ошибки, ни предупреждения', async () => {
    const warnings: string[] = [];
    const gw = new Gateway(cfg, clientWith([wide, behaviors], { calls: 0 }), undefined, null, false, (m) =>
      warnings.push(m),
    );
    gw.useTree('none', {}, true);

    const out = await gw.getTestCase('1');

    expect(out).not.toContain('**Путь:**');
    expect(warnings).toEqual([]);
  });

  it('команде без пути дерево не нужно: ни ошибки, ни предупреждения', async () => {
    const warnings: string[] = [];
    const gw = new Gateway(cfg, clientWith([wide, behaviors], { calls: 0 }), undefined, null, false, (m) =>
      warnings.push(m),
    );
    gw.useTree(null, {}, false);

    const out = await gw.getTestCase('1');

    expect(out).not.toContain('**Путь:**');
    expect(warnings).toEqual([]);
  });
});

describe('флаг --tree', () => {
  it('принимает идентификатор дерева', () => {
    expect(parseFlags(['list', '--tree', '41']).tree).toBe(41);
  });

  it('принимает none — путь не нужен на этот вызов', () => {
    expect(parseFlags(['list', '--tree', 'none']).tree).toBe('none');
  });

  it('принимает название дерева как есть', () => {
    expect(parseFlags(['list', '--tree', 'Разделы']).tree).toBe('Разделы');
  });
});

describe('дерево выбирается по названию', () => {
  it('название из флага находит дерево без учёта регистра и крайних пробелов', () => {
    expect(pickTree([wide, behaviors], { flag: '  разделы ' }).tree).toBe(wide);
  });

  it('название из настройки проекта находит дерево', () => {
    expect(pickTree([wide, behaviors], { config: 'Поведения' }).tree).toBe(behaviors);
  });

  it('идентификатор принимается наравне с названием, в том числе строкой из цифр', () => {
    expect(pickTree([wide, behaviors], { config: 29 }).tree).toBe(behaviors);
    expect(pickTree([wide, behaviors], { flag: '41' }).tree).toBe(wide);
  });

  it('названного дерева нет — случай назван, путь молча пустым не остаётся', () => {
    const pick = pickTree([wide, behaviors], { config: 'Старое имя' });
    expect(pick.tree).toBeNull();
    expect(pick.missing).toBe('Старое имя');
  });

  it('list с несуществующим названием в настройке останавливается и называет искомое', async () => {
    const gw = new Gateway(
      { ...cfg, trees: { '7': 'Старое имя' } },
      clientWith([wide, behaviors], { calls: 0 }),
      undefined,
      null,
      false,
      () => {},
    );
    gw.useTree(null, {}, true);

    await expect(gw.getTestCasesList([{ project: '7', rql: 'id > 0' }])).rejects.toThrow(
      'дерева «Старое имя» у проекта нет',
    );
  });
});

describe('сообщение об остановке самодостаточно', () => {
  const stopMessage = async (): Promise<string> => {
    const gw = new Gateway(
      { ...cfg, profileFile: '/home/user/.tt-testops/profiles/default/profile.json' },
      clientWith([wide, behaviors], { calls: 0 }),
      undefined,
      null,
      false,
      () => {},
    );
    gw.useTree(null, {}, true);
    return gw.getTestCasesList([{ project: '7', rql: 'id > 0' }]).then(
      () => '',
      (error: Error) => error.message,
    );
  };

  it('называет проект номером и именем и причину остановки', async () => {
    const message = await stopMessage();
    expect(message).toContain('Проект 7 «Демо»: выгрузка не начата — не выбрано рабочее дерево разделов.');
  });

  it('говорит, что спросить у человека, перечисляя деревья по названиям', async () => {
    const message = await stopMessage();
    expect(message).toContain(
      'Спросить у человека: какое дерево разделов рабочее для проекта 7 «Демо» — «Разделы», «Поведения»?',
    );
  });

  it('даёт полный путь к profile.json и готовую строку поля для каждого дерева', async () => {
    const message = await stopMessage();
    expect(message).toContain('/home/user/.tt-testops/profiles/default/profile.json');
    expect(message).toContain('"trees": { "7": "Разделы" }');
    expect(message).toContain('"trees": { "7": "Поведения" }');
    expect(message).toContain('"trees": { "7": "none" }');
  });

  it('идентификаторов деревьев в готовых строках нет', async () => {
    const message = await stopMessage();
    expect(message).not.toContain('--tree 41');
    expect(message).not.toContain('"7": 41');
  });
});
