import { describe, expect, it } from 'vitest';
import { buildFilterLink, isFilterLink, parseFilterLink } from '../src/links.js';

const FILTER_LINK =
  'https://testops.example/project/1/test-cases?treeId=41&search=W3siaWQiOiAiYXFsIiwgInZhbHVlIjogImF1dG9tYXRpb24gPSBmYWxzZSBhbmQgdGFnID0gXCLQotC10LNcIiIsICJ0eXBlIjogInN0cmluZyJ9XQ%3D%3D';

const searchParam = (conditions: unknown): string =>
  encodeURIComponent(Buffer.from(JSON.stringify(conditions), 'utf8').toString('base64'));

describe('isFilterLink', () => {
  it('treats http(s) strings as links and everything else as AQL', () => {
    expect(isFilterLink(FILTER_LINK)).toBe(true);
    expect(isFilterLink('http://x.test/project/1/test-cases')).toBe(true);
    expect(isFilterLink('  https://x.test/a  ')).toBe(true);
    expect(isFilterLink('tag = "Smoke"')).toBe(false);
    expect(isFilterLink('cf["Поле1"] = "Раздел А"')).toBe(false);
    expect(isFilterLink('')).toBe(false);
  });
});

describe('parseFilterLink', () => {
  it('extracts the AQL and the project id from a TestOps link', () => {
    const got = parseFilterLink(FILTER_LINK);
    expect(got.rql).toBe('automation = false and tag = "Тег"');
    expect(got.projectId).toBe(1);
  });

  it('warns about the tree filter instead of silently dropping it', () => {
    const got = parseFilterLink(FILTER_LINK);
    expect(got.warnings.join(' ')).toContain('дерев');
  });

  it('carries non-aql conditions through without a warning', () => {
    const url = `https://x.test/project/7/test-cases?search=${searchParam([
      { id: 'aql', value: 'tag = "Smoke"', type: 'string' },
      { id: 'status', value: 'Active', type: 'string' },
    ])}`;
    const got = parseFilterLink(url);
    expect(got.rql).toBe('tag = "Smoke"');
    expect(got.projectId).toBe(7);
    expect(got.conditions).toEqual([{ id: 'status', value: 'Active', type: 'string' }]);
    expect(got.warnings).toEqual([]);
  });

  it('a link with conditions but no aql is no longer an error', () => {
    const url = `https://x.test/project/7/test-cases?treeId=41&search=${searchParam([
      { id: 'status', value: 'Active', type: 'string' },
    ])}`;
    const got = parseFilterLink(url);
    expect(got.rql).toBe('');
    expect(got.conditions).toEqual([{ id: 'status', value: 'Active', type: 'string' }]);
  });

  it('a link with only a filterId is no longer an error', () => {
    const got = parseFilterLink('https://x.test/project/7/test-cases?filterId=7');
    expect(got.rql).toBe('');
    expect(got.filterId).toBe(7);
  });

  it('reports a link without a search parameter at all', () => {
    expect(() => parseFilterLink('https://x.test/project/7/test-cases')).toThrowError(
      /нет запроса/,
    );
  });

  it('keeps going when the project segment is absent', () => {
    const url = `https://x.test/test-cases?search=${searchParam([
      { id: 'aql', value: 'tag = "Smoke"', type: 'string' },
    ])}`;
    const got = parseFilterLink(url);
    expect(got.rql).toBe('tag = "Smoke"');
    expect(got.projectId).toBeNull();
  });

  it('rejects a string that is not a URL', () => {
    expect(() => parseFilterLink('tag = "Smoke"')).toThrowError(/ссылк/i);
  });
});

describe('buildFilterLink', () => {
  it('builds a link that opens the project test cases page', () => {
    const link = buildFilterLink('https://x.test', 1, { rql: 'tag = "Smoke"' });
    expect(link.startsWith('https://x.test/project/1/test-cases?search=')).toBe(true);
  });

  it('tolerates a trailing slash in the base url', () => {
    const link = buildFilterLink('https://x.test/', 1, { rql: 'tag = "Smoke"' });
    expect(link.startsWith('https://x.test/project/1/test-cases?search=')).toBe(true);
  });

  it.each([
    'tag = "Smoke"',
    'automation = false and tag = "Тег исполнителя"',
    'cf["Поле1"] = "Раздел Б"',
    'cf["Раздел"] = "Кейсы: «ёлки», 100% — тест" and automation = true',
    'id in [10002, 10001]',
  ])('round trips %s', (rql) => {
    const parsed = parseFilterLink(buildFilterLink('https://x.test', 1, { rql }));
    expect(parsed.rql).toBe(rql);
    expect(parsed.projectId).toBe(1);
    expect(parsed.warnings).toEqual([]);
  });

  it('carries filterId through the round trip', () => {
    const link = buildFilterLink('https://x.test', 1, { rql: '', filterId: 7 });
    const parsed = parseFilterLink(link);
    expect(parsed.filterId).toBe(7);
    expect(parsed.rql).toBe('');
  });

  it('carries link conditions through the round trip in order', () => {
    const conditions = [
      { id: 'tag', value: ['Smoke'], type: 'array' },
      { id: 'cfv.1', value: 'Раздел А', type: 'string' },
    ];
    const link = buildFilterLink('https://x.test', 1, { rql: 'automation = false', conditions });
    const parsed = parseFilterLink(link);
    expect(parsed.rql).toBe('automation = false');
    expect(parsed.conditions).toEqual(conditions);
  });

  it('a --text phrase comes back as an ordinary condition, not as rql', () => {
    const link = buildFilterLink('https://x.test', 1, { rql: 'tag = "Smoke"', text: 'фраза' });
    const parsed = parseFilterLink(link);
    expect(parsed.rql).toBe('tag = "Smoke"');
    expect(parsed.conditions).toEqual([{ id: 'content', value: 'фраза', type: 'string' }]);
  });
});
