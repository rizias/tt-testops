import { Parser } from 'commonmark';
import { describe, expect, it } from 'vitest';
import { defaultProfile } from '../src/profile.js';
import { renderCase } from '../src/render.js';
import { scenarioHtml } from '../src/htmlRichSteps.js';
import type { TestCase } from '../src/model.js';
import { step, stepsOf } from './scenarioFixtures.js';

const baseCase: TestCase = {
  id: '1',
  name: 'Кейс',
  path: [],
  status: 'Active',
  automated: false,
  layer: '',
  tags: [],
  attachments: [],
  linkRefs: [],
  issues: [],
  people: [],
  relatedCases: [],
  attributes: [],
  isLegacy: false,
  description: '',
  precondition: '',
  expectedResult: '',
  scenario: stepsOf('Шаг'),
  scenarioLines: ['1. Шаг'],
  scenarioSource: 'newSteps',
  comments: [],
} as unknown as TestCase;

function codeSpans(md: string): string[] {
  const walker = new Parser().parse(md).walker();
  const out: string[] = [];
  for (let event = walker.next(); event; event = walker.next()) {
    if (event.entering && event.node.type === 'code') out.push(event.node.literal ?? '');
  }
  return out;
}

const withAttribute = (name: string, value: string) =>
  renderCase({ ...baseCase, attributes: [{ name, value }] }, defaultProfile);

describe('подстановка в шаблоны профиля не понимает $&, $\', $` как спецсимволы', () => {
  it('значение вставляется как есть', () => {
    const cases: Array<[() => string | string[], string]> = [
      [() => withAttribute('Важность', 'a$&b'), '- **Важность:** `a$&b`'],
      [
        () => scenarioHtml(stepsOf(step("a$'b", { shared: true })), defaultProfile, new Map()),
        'Общий шаг: a$&#39;b',
      ],
      [() => withAttribute('X {value} Y', 'настоящее'), '- **X {value} Y:** `настоящее`'],
      [() => codeSpans(withAttribute('Поле', 'a`b')), 'a`b'],
    ];
    for (const [produce, expected] of cases) expect(produce()).toContain(expected);
  });
});
