import { describe, expect, it } from 'vitest';
import { parseFlags, projectsInPlay, treesFromLinks } from '../src/args.js';
import type { AppConfig } from '../src/config.js';
import { Gateway } from '../src/gateway.js';
import { caseId, testOpsUrl } from '../src/htmlCase.js';
import { parseFilterLink } from '../src/links.js';
import type { TestCase } from '../src/model.js';
import { extractCfConditions } from '../src/queryCheck.js';
import type { TestOpsClient } from '../src/testops/client.js';

const cfgR12: AppConfig = {
  baseUrl: 'https://ts.example',
  token: 'tok',
  defaultProjectId: 14,
  projects: { '14': 'WEB' },
  timeoutMs: 30000,
  maxCases: 100,
  pageSize: 20,
  sort: 'id,DESC',
} as unknown as AppConfig;

const linkOf = (project: number, tree: number): string => {
  const search = encodeURIComponent(
    Buffer.from(
      JSON.stringify([{ id: 'aql', value: 'tag = "Smoke"', type: 'string' }]),
      'utf8',
    ).toString('base64'),
  );
  return `https://ts.example/project/${project}/test-cases?treeId=${tree}&search=${search}`;
};

describe('условия запроса по кастомным полям', () => {
  it('значение с запятой внутри кавычек остаётся одним значением', () => {
    const got = extractCfConditions('cf["Раздел"] in ["Первый, второй", "Третий"]');
    expect(got.map((c) => c.value)).toEqual(['Первый, второй', 'Третий']);
  });

  it('отрицание перед in не даёт сверять значения', () => {
    const got = extractCfConditions('not cf["Раздел"] in ["Нет такого"]');
    expect(got.filter((c) => c.value)).toEqual([]);
  });

  it('отрицание со скобкой тоже распознаётся', () => {
    const got = extractCfConditions('not (cf["Раздел"] = "Нет такого")');
    expect(got.filter((c) => c.value)).toEqual([]);
  });

  it('обычное равенство по-прежнему сверяется', () => {
    const got = extractCfConditions('cf["Раздел"] = "Первый"');
    expect(got).toEqual([{ field: 'Раздел', value: 'Первый' }]);
  });
});

describe('похожесть имени поля', () => {
  it('латинская буква вместо кириллической распознаётся в строчных', async () => {
    const { findSimilar } = await import('../src/queryCheck.js');
    expect(findSimilar('Bажность', ['Важность', 'Слой'])).toContain('Важность');
    expect(findSimilar('Hомер', ['Номер'])).toContain('Номер');
    expect(findSimilar('Tема', ['Тема'])).toContain('Тема');
    expect(findSimilar('Kомпонент', ['Компонент'])).toContain('Компонент');
    expect(findSimilar('Mодуль', ['Модуль'])).toContain('Модуль');
  });

  it('непохожее не притягивается', async () => {
    const { findSimilar } = await import('../src/queryCheck.js');
    expect(findSimilar('Важность', ['Слой', 'Компонент'])).toEqual([]);
  });
});

describe('ссылка без условия запроса', () => {
  it('в ошибке названы и условия, и параметры адреса', async () => {
    const { parseFilterLink } = await import('../src/links.js');
    const search = encodeURIComponent(
      Buffer.from(JSON.stringify([{ id: 'status', value: 'Active' }]), 'utf8').toString('base64'),
    );
    const link = `https://ts.example/project/14/test-cases?treeId=41&search=${search}`;
    expect(() => parseFilterLink(link)).toThrow(/status/);
    expect(() => parseFilterLink(link)).toThrow(/treeId/);
  });
});

describe('неприменённые проекты при выборке по идентификаторам', () => {
  it('названы одним сообщением, а не по одному на список', async () => {
    const warnings: string[] = [];
    const client = {
      fetchOverview: async (id: string) =>
        ({ id: Number(id), projectId: 14, lastModifiedDate: 1 }) as never,
      fetchCaseFromOverview: async (ov: { id: number }) =>
        ({ overview: ov, steps: null, comments: [] }) as never,
      fetchTrees: async () => [],
    } as unknown as TestOpsClient;
    const gw = new Gateway(cfgR12, client, undefined, null, false, (m) => warnings.push(m));
    await gw.searchCasesJson([
      { project: '14', rql: 'id in [1]' },
      { project: '85', rql: 'id in [2]' },
    ]);
    const about = warnings.filter((w) => w.includes('не применял'));
    expect(about).toHaveLength(1);
    expect(about[0]).toContain('14');
    expect(about[0]).toContain('85');
  });
});

describe('дерево из ссылки', () => {
  const link = (project: number, tree: number) => {
    const search = Buffer.from(
      JSON.stringify([{ id: 'aql', value: 'automation = false', type: 'string' }]),
      'utf8',
    ).toString('base64');
    return `https://ts.example/project/${project}/test-cases?treeId=${tree}&search=${encodeURIComponent(search)}`;
  };

  it('у каждого проекта своё дерево, а не первое найденное', () => {
    const trees = treesFromLinks({
      _: [],
      projects: [],
      queries: [
        { kind: 'inline', value: link(14, 41), afterProject: -1 },
        { kind: 'inline', value: link(85, 153), afterProject: -1 },
      ],
    });
    expect(trees).toEqual({ '14': 41, '85': 153 });
  });
});

describe('дерево из ссылки принадлежит проекту, в котором пойдёт запрос', () => {
  it('явный --project становится ключом дерева', () => {
    const f = parseFlags(['--project', '14', '--rql', linkOf(85, 7)]);
    expect(treesFromLinks(f)).toEqual({ '14': 7 });
  });

  it('без явного проекта ключом остаётся проект ссылки', () => {
    const f = parseFlags(['--rql', linkOf(85, 7)]);
    expect(treesFromLinks(f)).toEqual({ '85': 7 });
  });
});

describe('проект, пришедший только из ссылки', () => {
  it('попадает в список проверяемых проектов', () => {
    const f = parseFlags(['--rql', linkOf(85, 7)]);
    expect(projectsInPlay(f)).toEqual(['85']);
  });

  it('без запросов проверяется проект по умолчанию', () => {
    expect(projectsInPlay(parseFlags([]))).toEqual([undefined]);
  });
});

describe('ссылка на кейс без проекта', () => {
  it('не строится вовсе, а не ведёт в пустоту', () => {
    const tc = { id: '10001', projectId: null } as unknown as TestCase;
    expect(testOpsUrl(tc, 'https://ts.example')).toBeNull();
    const html = caseId(tc, 'https://ts.example');
    expect(html).toBe('<span class="id">10001</span>');
    expect(html).not.toContain('/project//');
  });

  it('с проектом строится как прежде', () => {
    const tc = { id: '10001', projectId: 14 } as unknown as TestCase;
    expect(testOpsUrl(tc, 'https://ts.example')).toBe(
      'https://ts.example/project/14/test-cases/10001',
    );
  });
});

describe('непереносимые части ссылки', () => {
  it('названы все параметры, а не только дерево', () => {
    const search = encodeURIComponent(
      Buffer.from(
        JSON.stringify([{ id: 'aql', value: 'tag = "Smoke"', type: 'string' }]),
        'utf8',
      ).toString('base64'),
    );
    const link = `https://ts.example/project/14/test-cases?treeId=41&sort=id&layout=grid&search=${search}`;
    const warnings = parseFilterLink(link).warnings.join(' ');
    expect(warnings).toContain('treeId=41');
    expect(warnings).toContain('sort');
    expect(warnings).toContain('layout');
  });
});
