import { describe, expect, it } from 'vitest';
import { extractCfConditions, findSimilar, idsOnly, replaceValue } from '../src/queryCheck.js';

describe('extractCfConditions', () => {
  it('finds a single equality condition', () => {
    expect(extractCfConditions('cf["Section1"] = "Раздел А"')).toEqual([
      { field: 'Section1', value: 'Раздел А' },
    ]);
  });

  it('finds several conditions joined by and/or', () => {
    const rql = 'cf["Section1"] = "Раздел А" and automation = false or cf["Epic"] = "SSO"';
    expect(extractCfConditions(rql)).toEqual([
      { field: 'Section1', value: 'Раздел А' },
      { field: 'Epic', value: 'SSO' },
    ]);
  });

  it('tolerates spacing around the operator', () => {
    expect(extractCfConditions('cf["Epic"]="SSO"')).toEqual([{ field: 'Epic', value: 'SSO' }]);
  });

  it('returns nothing when the query has no custom-field equality', () => {
    expect(extractCfConditions('tag = "Smoke" and automation = false')).toEqual([]);
  });

  it('in [...] проверяется по каждому значению', () => {
    expect(extractCfConditions('cf["Section1"] in ["A", "B"]')).toEqual([
      { field: 'Section1', value: 'A' },
      { field: 'Section1', value: 'B' },
    ]);
  });

  it('у прочих условий проверяется только имя поля', () => {
    expect(extractCfConditions('cf["Section1"] != "Раздел А"')).toEqual([
      { field: 'Section1', value: '' },
    ]);
    expect(extractCfConditions('not cf["Section1"] = "Раздел А"')).toEqual([
      { field: 'Section1', value: '' },
    ]);
  });
});

describe('findSimilar', () => {
  const sections = ['Section1', 'Кaталог  (Catalog)', 'Отчёты', 'Ипотека'];

  it('matches when only the case differs', () => {
    expect(findSimilar('section1', sections)).toEqual(['Section1']);
    expect(findSimilar('ОТЧЁТЫ', sections)).toEqual(['Отчёты']);
  });

  it('matches across extra and edge whitespace', () => {
    expect(findSimilar('  Отчёты  ', sections)).toEqual(['Отчёты']);
  });

  it('matches a latin letter standing in for a cyrillic one', () => {
    expect(findSimilar('Каталог (Catalog)', sections)).toEqual(['Кaталог  (Catalog)']);
  });

  it('matches the other direction too', () => {
    expect(findSimilar('Sectiоn1', sections)).toEqual(['Section1']);
  });

  it('returns nothing when nothing is close', () => {
    expect(findSimilar('Совсем другое', sections)).toEqual([]);
  });
});

describe('запрос только по идентификаторам', () => {
  it('распознаёт список идентификаторов', () => {
    expect(idsOnly('id in [10001, 10002, 10003]')).toEqual([10001, 10002, 10003]);
  });

  it('распознаёт одиночное равенство', () => {
    expect(idsOnly('id = 10001')).toEqual([10001]);
  });

  it('не смущается регистром и пробелами', () => {
    expect(idsOnly('  ID IN [ 1 , 2 ]  ')).toEqual([1, 2]);
  });

  it('распознаёт равенства и списки, соединённые or со скобками', () => {
    expect(idsOnly('(id = 1 or (id in [2, 3]))')).toEqual([1, 2, 3]);
    expect(idsOnly('id = 1 or id = 2')).toEqual([1, 2]);
  });

  it('добавочное условие снимает признак', () => {
    expect(idsOnly('id in [10001, 10003] and automation = false')).toBeNull();
  });

  it('другой запрос не признаётся', () => {
    expect(idsOnly('cf["Section1"] = "Раздел А"')).toBeNull();
  });

  it('пустой список не признаётся', () => {
    expect(idsOnly('id in []')).toBeNull();
  });
});

describe('исправление написания не задевает соседние условия', () => {
  it('починка слоя не трогает одноимённое значение кастомного поля', () => {
    expect(replaceValue('layer = "e2e" and cf["Feature"] = "e2e"', null, 'e2e', 'E2E')).toBe(
      'layer = "E2E" and cf["Feature"] = "e2e"',
    );
  });

  it('починка значения не трогает имя поля', () => {
    expect(replaceValue('cf["Раздел"] = "Раздел"', 'Раздел', 'Раздел', 'раздел')).toBe(
      'cf["Раздел"] = "раздел"',
    );
  });
});
