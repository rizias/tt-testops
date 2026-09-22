import { describe, expect, it } from 'vitest';
import type { RawStepData } from '../src/model.js';
import { defaultProfile } from '../src/profile.js';
import { buildSteps } from '../src/stepBuilder.js';

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
  it('numbers each level from 1 and renders the attachment child as a numbered card', () => {
    const lines = buildSteps([1, 2], data, defaultProfile);
    expect(lines).toEqual([
      '1. Открыть главную',
      '2. Пролистать до блока',
      '  **Ожидаемый результат**',
      '    1. counter отображает кол-во',
      '    2. [expected_0.md](/api/testcase/attachment/900002/content)',
    ]);
  });

  it('expands prefetched text-attachment content under the card (opened preview)', () => {
    const expanded = new Map([
      [900002, ' ![](/api/rs/testcase/attachment/900001/content) \ncounter отображает кол-во'],
    ]);
    const lines = buildSteps([1, 2], data, defaultProfile, 0, expanded);
    expect(lines).toEqual([
      '1. Открыть главную',
      '2. Пролистать до блока',
      '  **Ожидаемый результат**',
      '    1. counter отображает кол-во',
      '    2. [expected_0.md](/api/testcase/attachment/900002/content)',
      '      ![](/api/rs/testcase/attachment/900001/content)',
      '      counter отображает кол-во',
    ]);
  });

  it('image attachment node renders inline as its own numbered item', () => {
    const d: RawStepData = {
      root: { children: [1] },
      scenarioSteps: {
        '1': { body: 'Шаг с картинкой', children: [2] },
        '2': { attachmentId: 9 },
      },
      attachments: { '9': { id: 9, name: 'image.png', contentType: 'image/png' } },
    };
    expect(buildSteps([1], d, defaultProfile)).toEqual([
      '1. Шаг с картинкой',
      '  1. ![image.png](/api/testcase/attachment/9/content)',
    ]);
  });
});
