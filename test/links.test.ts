import { describe, expect, it } from 'vitest';
import { buildFilterLink, isFilterLink, parseFilterLink } from '../src/links.js';

const FILTER_LINK =
  'https://testops.example/project/14/test-cases?treeId=41&search=W3siaWQiOiAiYXFsIiwgInZhbHVlIjogImF1dG9tYXRpb24gPSBmYWxzZSBhbmQgdGFnID0gXCLQotC10LNcIiIsICJ0eXBlIjogInN0cmluZyJ9XQ%3D%3D';

const searchParam = (conditions: unknown): string =>
  encodeURIComponent(Buffer.from(JSON.stringify(conditions), 'utf8').toString('base64'));

describe('isFilterLink', () => {
  it('treats http(s) strings as links and everything else as AQL', () => {
    expect(isFilterLink(FILTER_LINK)).toBe(true);
    expect(isFilterLink('http://x.test/project/1/test-cases')).toBe(true);
    expect(isFilterLink('  https://x.test/a  ')).toBe(true);
    expect(isFilterLink('tag = "Smoke"')).toBe(false);
    expect(isFilterLink('cf["Section1"] = "Раздел А"')).toBe(false);
    expect(isFilterLink('')).toBe(false);
  });
});

describe('parseFilterLink', () => {
  it('extracts the AQL and the project id from a TestOps link', () => {
    const got = parseFilterLink(FILTER_LINK);
    expect(got.rql).toBe('automation = false and tag = "Тег"');
    expect(got.projectId).toBe(14);
  });

  it('warns about the tree filter instead of silently dropping it', () => {
    const got = parseFilterLink(FILTER_LINK);
    expect(got.warnings.join(' ')).toContain('дерев');
  });

  it('warns about unknown conditions but still returns the query', () => {
    const url = `https://x.test/project/7/test-cases?search=${searchParam([
      { id: 'aql', value: 'tag = "Smoke"', type: 'string' },
      { id: 'status', value: 'Active', type: 'string' },
    ])}`;
    const got = parseFilterLink(url);
    expect(got.rql).toBe('tag = "Smoke"');
    expect(got.projectId).toBe(7);
    expect(got.warnings.join(' ')).toContain('status');
  });

  it('reports what it found when the link carries no query', () => {
    const url = `https://x.test/project/7/test-cases?treeId=41&search=${searchParam([
      { id: 'status', value: 'Active', type: 'string' },
    ])}`;
    expect(() => parseFilterLink(url)).toThrowError(/нет запроса[\s\S]*status/);
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
    const link = buildFilterLink('https://x.test', 14, 'tag = "Smoke"');
    expect(link.startsWith('https://x.test/project/14/test-cases?search=')).toBe(true);
  });

  it('tolerates a trailing slash in the base url', () => {
    const link = buildFilterLink('https://x.test/', 14, 'tag = "Smoke"');
    expect(link.startsWith('https://x.test/project/14/test-cases?search=')).toBe(true);
  });

  it.each([
    'tag = "Smoke"',
    'automation = false and tag = "Тег исполнителя"',
    'cf["Section1"] = "Раздел Б"',
    'cf["Раздел"] = "Кейсы: «ёлки», 100% — тест" and automation = true',
    'id in [10002, 10001]',
  ])('round trips %s', (rql) => {
    const parsed = parseFilterLink(buildFilterLink('https://x.test', 14, rql));
    expect(parsed.rql).toBe(rql);
    expect(parsed.projectId).toBe(14);
    expect(parsed.warnings).toEqual([]);
  });
});
