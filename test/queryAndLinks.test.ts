import { describe, expect, it } from 'vitest';
import { parseFlags } from '../src/args.js';
import { treesFromLinks } from '../src/querySources.js';
import type { AppConfig } from '../src/config.js';
import { Gateway } from '../src/gateway.js';
import { caseId, caseUrl } from '../src/htmlCase.js';
import { parseFilterLink } from '../src/links.js';
import type { TestCase } from '../src/model.js';
import { extractCfConditions } from '../src/queryCheck.js';
import type { TestOpsClient } from '../src/testops/client.js';
import { listedIds } from './listedCases.js';

const cfgR12: AppConfig = {
  baseUrl: 'https://ts.example',
  token: 'tok',
  defaultProjectId: 1,
  projects: { '1': 'WEB' },
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

describe('ссылка без условия aql, но с другими условиями', () => {
  it('больше не ошибка: условие передаётся дальше как есть', async () => {
    const { parseFilterLink } = await import('../src/links.js');
    const search = encodeURIComponent(
      Buffer.from(JSON.stringify([{ id: 'status', value: 'Active' }]), 'utf8').toString('base64'),
    );
    const link = `https://ts.example/project/1/test-cases?treeId=41&search=${search}`;
    const got = parseFilterLink(link);
    expect(got.rql).toBe('');
    expect(got.conditions).toEqual([{ id: 'status', value: 'Active' }]);
    expect(got.warnings.join(' ')).toContain('treeId');
  });
});

describe('ссылка совсем без запроса', () => {
  it('называет параметры, которые в ней есть', async () => {
    const { parseFilterLink } = await import('../src/links.js');
    const link = 'https://ts.example/project/1/test-cases?treeId=41';
    expect(() => parseFilterLink(link)).toThrow(/нет запроса/);
    expect(() => parseFilterLink(link)).toThrow(/treeId/);
  });
});

describe('неприменённые проекты при выборке по идентификаторам', () => {
  it('названы одним сообщением, а не по одному на список', async () => {
    const warnings: string[] = [];
    const client = {
      countCases: async () => 0,
      fetchOverview: async (id: string) =>
        ({ id: Number(id), projectId: 1, lastModifiedDate: 1 }) as never,
      fetchCaseFromOverview: async (ov: { id: number }) =>
        ({ overview: ov, steps: null, comments: [] }) as never,
      fetchTrees: async () => [],
    } as unknown as TestOpsClient;
    const gw = new Gateway(cfgR12, client, undefined, null, (m) => warnings.push(m));
    await listedIds(gw, [
      { project: '1', rql: 'id in [1]' },
      { project: '2', rql: 'id in [2]' },
    ]);
    const about = warnings.filter((w) => w.includes('не применял'));
    expect(about).toHaveLength(1);
    expect(about[0]).toContain('1');
    expect(about[0]).toContain('2');
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
      used: [],
      queries: [
        { kind: 'inline', value: link(1, 41), afterProject: -1 },
        { kind: 'inline', value: link(2, 153), afterProject: -1 },
      ],
    });
    expect(trees).toEqual({ '1': 41, '2': 153 });
  });
});

describe('дерево из ссылки принадлежит проекту, в котором пойдёт запрос', () => {
  it('явный --project становится ключом дерева', () => {
    const f = parseFlags(['--project', '1', '--rql', linkOf(2, 7)]);
    expect(treesFromLinks(f)).toEqual({ '1': 7 });
  });

  it('без явного проекта ключом остаётся проект ссылки', () => {
    const f = parseFlags(['--rql', linkOf(2, 7)]);
    expect(treesFromLinks(f)).toEqual({ '2': 7 });
  });
});

describe('ссылка на кейс без проекта', () => {
  it('не строится вовсе, а не ведёт в пустоту', () => {
    const tc = { id: '10001', projectId: null } as unknown as TestCase;
    const html = caseId(tc, 'https://ts.example');
    expect(html).toBe('<span class="id">10001</span>');
    expect(html).not.toContain('/project//');
  });

  it('с проектом строится как прежде', () => {
    expect(caseUrl('https://ts.example', 1, '10001')).toBe(
      'https://ts.example/project/1/test-cases/10001',
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
    const link = `https://ts.example/project/1/test-cases?treeId=41&sort=id&layout=grid&search=${search}`;
    const warnings = parseFilterLink(link).warnings.join(' ');
    expect(warnings).toContain('treeId=41');
    expect(warnings).toContain('sort');
    expect(warnings).toContain('layout');
  });
});
