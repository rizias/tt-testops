import { describe, expect, it } from 'vitest';
import type { RawStepData } from '../src/model.js';
import { defaultProfile } from '../src/profile.js';
import { editorLines } from './scenarioFixtures.js';

const data: RawStepData = {
  root: { children: [1, 2] },
  scenarioSteps: {
    '1': { body: 'Открыть главную' },
    '2': { body: 'Пролистать до блока', expectedResultId: 3 },
    '3': { body: 'Expected Result', children: [4, 5] },
    '4': { body: 'counter отображает кол-во' },
    '5': { attachmentId: 900002 },
  },
  attachments: { '900002': { id: 900002, name: 'expected_0.md', contentType: 'text/markdown' } },
};

describe('buildSteps: report-style numbering + attachments', () => {
  it('numbers each level from 1; the attachment row is its own numbered item', () => {
    const lines = editorLines([1, 2], data, defaultProfile);
    expect(lines).toEqual([
      '1. Открыть главную',
      '2. Пролистать до блока',
      '',
      '    **Ожидаемый результат**',
      '',
      '    1) counter отображает кол-во',
      '    2) [expected_0.md](/api/testcase/attachment/900002/content)',
    ]);
  });

  it('expands prefetched text-attachment content as its own numbered item', () => {
    const expanded = new Map([
      [900002, ' ![](/api/rs/testcase/attachment/900001/content) \ncounter отображает кол-во'],
    ]);
    const lines = editorLines([1, 2], data, defaultProfile, expanded);
    expect(lines).toEqual([
      '1. Открыть главную',
      '2. Пролистать до блока',
      '',
      '    **Ожидаемый результат**',
      '',
      '    1) counter отображает кол-во',
      '    2)  ![](/api/rs/testcase/attachment/900001/content) ',
      '       counter отображает кол-во',
    ]);
  });

  it('image attachment node renders under its step without a number', () => {
    const d: RawStepData = {
      root: { children: [1] },
      scenarioSteps: {
        '1': { body: 'Шаг с картинкой', children: [2] },
        '2': { attachmentId: 9 },
      },
      attachments: { '9': { id: 9, name: 'image.png', contentType: 'image/png' } },
    };
    expect(editorLines([1], d, defaultProfile)).toEqual([
      '1. Шаг с картинкой',
      '   ![image.png](/api/testcase/attachment/9/content)',
    ]);
  });

  it('image row between two steps is step 2, the next step is 3', () => {
    const d: RawStepData = {
      root: { children: [1, 2, 3] },
      scenarioSteps: {
        '1': { body: 'Выбрать выписки' },
        '2': { attachmentId: 9 },
        '3': { body: 'Нажать «Поступление»' },
      },
      attachments: { '9': { id: 9, name: 'image.png', contentType: 'image/png' } },
    };
    expect(editorLines([1, 2, 3], d, defaultProfile)).toEqual([
      '1. Выбрать выписки',
      '2. ![image.png](/api/testcase/attachment/9/content)',
      '3. Нажать «Поступление»',
    ]);
  });
});
