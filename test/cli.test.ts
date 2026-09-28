import { rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseFlags } from '../src/args.js';
import { sourcesOf } from '../src/querySources.js';
import { buildFilterLink } from '../src/links.js';

describe('разбор аргументов командной строки', () => {
  it.each(['--project', '--rql', '--rql-file', '--limit', '--out', '--format', '--for'])(
    'флаг %s требует значение',
    (flag) => {
      expect(() => parseFlags([flag])).toThrow(new RegExp(flag));
      expect(() => parseFlags([flag, '--refresh'])).toThrow(new RegExp(flag));
    },
  );

  it('не принимает следующий флаг за значение rql', () => {
    expect(() => parseFlags(['--rql', '--project', '1'])).toThrow(/--rql.*нужно значение/);
  });

  it.each(['abc', '-1', '0'])('отвергает --limit %s', (value) => {
    expect(() => parseFlags(['--limit', value])).toThrow(/целым числом больше нуля/);
  });
});

describe('запрос, прочитанный из файла', () => {
  it('лишается пробелов по краям, но не меняется внутри', () => {
    const path = join(tmpdir(), '_tt_rql.txt');
    writeFileSync(path, '\n  tag = "Smoke" and automation = false  \n\n', 'utf8');
    expect(sourcesOf(parseFlags(['--rql-file', path, '--project', '1']))[0]?.rql).toBe(
      'tag = "Smoke" and automation = false',
    );
    rmSync(path);
  });
});

describe('сборка источников из аргументов', () => {
  it('связывает позиционный запрос вместе с --rql', () => {
    const flags = parseFlags(['--project', '2', '--rql', 'A', '--project', '1', 'B']);
    expect(sourcesOf(flags)).toEqual([
      { project: '2', rql: 'A' },
      { project: '1', rql: 'B' },
    ]);
  });

  it('отказывается от двух позиционных запросов для одного проекта', () => {
    const flags = parseFlags(['--project', '1', 'A', 'B']);
    expect(() => sourcesOf(flags)).toThrow(/Проектов 1, а запросов 2/);
  });

  it('разбирает две ссылки до связывания и берёт проекты из них', () => {
    const first = buildFilterLink('https://x.test', 2, { rql: 'A' });
    const second = buildFilterLink('https://x.test', 1, { rql: 'B' });
    expect(sourcesOf(parseFlags([first, second]))).toEqual([
      { project: '2', rql: 'A', conditions: [] },
      { project: '1', rql: 'B', conditions: [] },
    ]);
  });

  it('явный проект перекрывает проект из ссылки', () => {
    const link = buildFilterLink('https://x.test', 2, { rql: 'A' });
    expect(sourcesOf(parseFlags(['--project', '1', link]))).toEqual([
      { project: '1', rql: 'A', conditions: [] },
    ]);
  });

  it('сохраняет проект ссылки до явного проекта и связывает следующий запрос с явным', () => {
    const link = buildFilterLink('https://x.test', 2, { rql: 'A' });
    expect(sourcesOf(parseFlags([link, '--project', '1', 'B']))).toEqual([
      { project: '2', rql: 'A', conditions: [] },
      { project: '1', rql: 'B' },
    ]);
  });

  it('отказывается от двух проектов без запроса', () => {
    const flags = parseFlags(['--project', '1', '--project', '2']);
    expect(() => sourcesOf(flags)).toThrow(/Проектов 2, а запросов 0/);
  });
});
