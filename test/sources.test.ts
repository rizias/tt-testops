import { describe, expect, it } from 'vitest';
import { buildSources } from '../src/sources.js';

const q = (text: string, afterProject: number) => ({ text, afterProject });

describe('пары «проект + запрос»', () => {
  it('один проект и один запрос дают один источник', () => {
    expect(buildSources(['14'], [q('tag = "Smoke"', 0)])).toEqual([
      { project: '14', rql: 'tag = "Smoke"' },
    ]);
  });

  it('без проекта и без запроса остаётся один источник по умолчанию', () => {
    expect(buildSources([], [])).toEqual([{ project: undefined, rql: '' }]);
  });

  it('запрос относится к ближайшему проекту слева', () => {
    const sources = buildSources(
      ['85', '14'],
      [q('cf["Epic"] = "Раздел Б"', 0), q('cf["Section1"] = "Раздел А"', 1)],
    );
    expect(sources).toEqual([
      { project: '85', rql: 'cf["Epic"] = "Раздел Б"' },
      { project: '14', rql: 'cf["Section1"] = "Раздел А"' },
    ]);
  });

  it('один запрос раздаётся всем проектам', () => {
    expect(buildSources(['14', '85'], [q('tag = "Smoke"', -1)])).toEqual([
      { project: '14', rql: 'tag = "Smoke"' },
      { project: '85', rql: 'tag = "Smoke"' },
    ]);
  });

  it('несходящиеся количества называются числами', () => {
    expect(() => buildSources(['1', '2', '3'], [q('a', 0), q('b', 1)])).toThrow(
      /Проектов 3, а запросов 2/,
    );
  });

  it('проект без запроса назван поимённо', () => {
    expect(() => buildSources(['85', '14'], [q('a', 0), q('b', 0)])).toThrow(/14/);
  });

  it('запрос раньше первого проекта при нескольких запросах — ошибка', () => {
    expect(() => buildSources(['85', '14'], [q('a', -1), q('b', 1)])).toThrow(/--project/);
  });

  it('порядок источников повторяет порядок проектов', () => {
    const sources = buildSources(['14', '85', '85'], [q('x', -1)]);
    expect(sources.map((s) => s.project)).toEqual(['14', '85', '85']);
  });
});
