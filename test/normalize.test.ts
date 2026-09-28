import { describe, expect, it } from 'vitest';
import type { RawCase, RawCustomField } from '../src/model.js';
import { normalizeCase } from '../src/normalize.js';
import { defaultProfile } from '../src/profile.js';
import type { ProjectTree } from '../src/tree.js';

const caseWith = (customFields: RawCustomField[]): RawCase => ({
  overview: { id: 1, name: 'X', status: { name: 'Active' }, customFields },
  steps: null,
});

const field = (id: number, name: string, value: string): RawCustomField => ({
  name: value,
  customField: { id, name },
});

const tree: ProjectTree = {
  id: 7,
  name: 'Рабочее',
  fields: [
    { id: 10, name: 'Уровень 1' },
    { id: 31, name: 'Уровень 2' },
    { id: 12, name: 'Уровень 3' },
  ],
};

describe('путь собирается из рабочего дерева', () => {
  it('уровни идут в порядке дерева, а не в порядке ответа', () => {
    const tc = normalizeCase(
      caseWith([
        field(12, 'Уровень 3', 'Третий'),
        field(10, 'Уровень 1', 'Первый'),
        field(31, 'Уровень 2', 'Второй'),
      ]),
      defaultProfile,
      tree,
    );
    expect(tc.path).toEqual(['Первый', 'Второй', 'Третий']);
    expect(tc.attributes).toEqual([]);
  });

  it('поля другого дерева в путь не попадают и остаются атрибутами', () => {
    const tc = normalizeCase(
      caseWith([
        field(10, 'Уровень 1', 'Первый'),
        field(-1, 'Поле0', 'Тема'),
        field(-2, 'Feature', 'Возможность'),
      ]),
      defaultProfile,
      tree,
    );
    expect(tc.path).toEqual(['Первый']);
    expect(tc.attributes).toEqual([
      { name: 'Поле0', value: 'Тема' },
      { name: 'Feature', value: 'Возможность' },
    ]);
  });

  it('пустой уровень пропускается, порядок остальных сохраняется', () => {
    const tc = normalizeCase(
      caseWith([field(10, 'Уровень 1', 'Первый'), field(12, 'Уровень 3', 'Третий')]),
      defaultProfile,
      tree,
    );
    expect(tc.path).toEqual(['Первый', 'Третий']);
  });

  it('признак singleSelect больше ни на что не влияет', () => {
    const tc = normalizeCase(
      caseWith([
        { name: 'Первый', customField: { id: 10, name: 'Уровень 1', singleSelect: true } },
        { name: 'Да', customField: { id: 99, name: 'Дым', singleSelect: false } },
      ]),
      defaultProfile,
      tree,
    );
    expect(tc.path).toEqual(['Первый']);
    expect(tc.attributes).toEqual([{ name: 'Дым', value: 'Да' }]);
  });
});

describe('рабочего дерева нет', () => {
  it('путь пуст, все поля показаны атрибутами', () => {
    const tc = normalizeCase(
      caseWith([field(10, 'Уровень 1', 'Первый'), field(99, 'Дым', 'Да')]),
      defaultProfile,
      null,
    );
    expect(tc.path).toEqual([]);
    expect(tc.attributes).toEqual([
      { name: 'Уровень 1', value: 'Первый' },
      { name: 'Дым', value: 'Да' },
    ]);
  });
});

describe('оформление касается атрибутов, но не пути', () => {
  const cf = [
    field(99, 'Дым', 'Да'),
    field(98, 'Важность', 'P1'),
    field(10, 'Уровень 1', 'Первый'),
  ];

  it('скрытие и переименование применяются к атрибутам', () => {
    expect(
      normalizeCase(
        caseWith(cf),
        { ...defaultProfile, customFields: { hide: ['Дым'], rename: {}, order: [] } },
        tree,
      ).attributes,
    ).toEqual([{ name: 'Важность', value: 'P1' }]);

    expect(
      normalizeCase(
        caseWith(cf),
        {
          ...defaultProfile,
          customFields: { hide: [], rename: { Дым: 'Смоук' }, order: ['Важность', 'Дым'] },
        },
        tree,
      ).attributes,
    ).toEqual([
      { name: 'Важность', value: 'P1' },
      { name: 'Смоук', value: 'Да' },
    ]);
  });

  it('скрытое поле уровня всё равно остаётся в пути', () => {
    const tc = normalizeCase(
      caseWith(cf),
      { ...defaultProfile, customFields: { hide: ['Уровень 1'], rename: {}, order: [] } },
      tree,
    );
    expect(tc.path).toEqual(['Первый']);
    expect(tc.attributes.some((a) => a.name === 'Уровень 1')).toBe(false);
  });
});
