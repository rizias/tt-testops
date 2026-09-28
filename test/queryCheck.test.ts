import { describe, expect, it } from 'vitest';
import { extractCfConditions, findSimilar, idsOnly } from '../src/queryCheck.js';

describe('extractCfConditions', () => {
  it('finds a single equality condition', () => {
    expect(extractCfConditions('cf["Поле1"] = "Раздел А"')).toEqual([
      { field: 'Поле1', value: 'Раздел А' },
    ]);
  });

  it('finds several conditions joined by and/or', () => {
    const rql = 'cf["Поле1"] = "Раздел А" and automation = false or cf["Поле0"] = "SSO"';
    expect(extractCfConditions(rql)).toEqual([
      { field: 'Поле1', value: 'Раздел А' },
      { field: 'Поле0', value: 'SSO' },
    ]);
  });

  it('tolerates spacing around the operator', () => {
    expect(extractCfConditions('cf["Поле0"]="SSO"')).toEqual([{ field: 'Поле0', value: 'SSO' }]);
  });

  it('returns nothing when the query has no custom-field equality', () => {
    expect(extractCfConditions('tag = "Smoke" and automation = false')).toEqual([]);
  });

  it('in [...] проверяется по каждому значению', () => {
    expect(extractCfConditions('cf["Поле1"] in ["A", "B"]')).toEqual([
      { field: 'Поле1', value: 'A' },
      { field: 'Поле1', value: 'B' },
    ]);
  });

  it('у прочих условий проверяется только имя поля', () => {
    expect(extractCfConditions('cf["Поле1"] != "Раздел А"')).toEqual([
      { field: 'Поле1', value: '' },
    ]);
    expect(extractCfConditions('not cf["Поле1"] = "Раздел А"')).toEqual([
      { field: 'Поле1', value: '' },
    ]);
  });
});

describe('findSimilar', () => {
  const sections = ['Поле1', 'Знaчение  Б (B)', 'Значение А', 'Значение В'];

  it('matches when only the case differs', () => {
    expect(findSimilar('поле1', sections)).toEqual(['Поле1']);
    expect(findSimilar('ЗНАЧЕНИЕ А', sections)).toEqual(['Значение А']);
  });

  it('matches across extra and edge whitespace', () => {
    expect(findSimilar('  Значение А  ', sections)).toEqual(['Значение А']);
  });

  it('matches a latin letter standing in for a cyrillic one', () => {
    expect(findSimilar('Значение Б (B)', sections)).toEqual(['Знaчение  Б (B)']);
  });

  it('matches the other direction too', () => {
    expect(findSimilar('Пoле1', sections)).toEqual(['Поле1']);
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
    expect(idsOnly('cf["Поле1"] = "Раздел А"')).toBeNull();
  });

  it('пустой список не признаётся', () => {
    expect(idsOnly('id in []')).toBeNull();
  });
});
