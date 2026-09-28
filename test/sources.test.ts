import { describe, expect, it } from 'vitest';
import { buildSources } from '../src/sources.js';

const q = (text: string, afterProject: number) => ({ text, afterProject });

describe('пары «проект + запрос»', () => {
  it('один проект и один запрос дают один источник', () => {
    expect(buildSources(['1'], [q('tag = "Smoke"', 0)])).toEqual([
      { project: '1', rql: 'tag = "Smoke"' },
    ]);
  });

  it('без проекта и без запроса остаётся один источник по умолчанию', () => {
    expect(buildSources([], [])).toEqual([{ project: undefined, rql: '' }]);
  });

  it('запрос относится к ближайшему проекту слева', () => {
    const sources = buildSources(
      ['2', '1'],
      [q('cf["Поле0"] = "Раздел Б"', 0), q('cf["Поле1"] = "Раздел А"', 1)],
    );
    expect(sources).toEqual([
      { project: '2', rql: 'cf["Поле0"] = "Раздел Б"' },
      { project: '1', rql: 'cf["Поле1"] = "Раздел А"' },
    ]);
  });

  it('один запрос раздаётся всем проектам', () => {
    expect(buildSources(['1', '2'], [q('tag = "Smoke"', -1)])).toEqual([
      { project: '1', rql: 'tag = "Smoke"' },
      { project: '2', rql: 'tag = "Smoke"' },
    ]);
  });

  it('несходящиеся количества называются числами', () => {
    expect(() => buildSources(['1', '2', '3'], [q('a', 0), q('b', 1)])).toThrow(
      /Проектов 3, а запросов 2/,
    );
  });

  it('проект без запроса назван поимённо', () => {
    expect(() => buildSources(['2', '1'], [q('a', 0), q('b', 0)])).toThrow(/1/);
  });

  it('запрос раньше первого проекта при нескольких запросах — ошибка', () => {
    expect(() => buildSources(['2', '1'], [q('a', -1), q('b', 1)])).toThrow(/--project/);
  });

  it('порядок источников повторяет порядок проектов', () => {
    const sources = buildSources(['1', '2', '2'], [q('x', -1)]);
    expect(sources.map((s) => s.project)).toEqual(['1', '2', '2']);
  });
});
