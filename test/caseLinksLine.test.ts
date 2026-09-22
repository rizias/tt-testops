import { describe, expect, it } from 'vitest';
import type { CaseLink, TestCase } from '../src/model.js';
import { defaultProfile } from '../src/profile.js';
import { renderCase } from '../src/render.js';

function withLinks(linkRefs: CaseLink[]): TestCase {
  return {
    id: '1',
    name: 'Кейс',
    path: [],
    attributes: [],
    tags: [],
    links: [],
    linkRefs,
    description: '',
    precondition: '',
    expectedResult: '',
    scenarioLines: ['1. Шаг'],
    scenarioSource: 'newSteps',
  } as unknown as TestCase;
}

const linksLine = (linkRefs: CaseLink[], profile = defaultProfile): string | undefined =>
  renderCase(withLinks(linkRefs), profile)
    .split('\n')
    .find((line) => line.startsWith('- **Ссылки:**'));

describe('строка ссылок кейса в Markdown', () => {
  it('ссылка с подписью и адресом выводится ссылкой Markdown', () => {
    expect(linksLine([{ name: 'Задача', url: 'https://tracker.example/A-1' }])).toBe(
      '- **Ссылки:** [Задача](https://tracker.example/A-1)',
    );
  });

  it('ссылка без подписи выводится адресом целиком', () => {
    expect(linksLine([{ name: 'https://tracker.example/A-1', url: 'https://tracker.example/A-1' }])).toBe(
      '- **Ссылки:** https://tracker.example/A-1',
    );
  });

  it('ссылка без адреса выводится подписью', () => {
    expect(linksLine([{ name: 'Задача', url: '' }])).toBe('- **Ссылки:** Задача');
  });

  it('несколько ссылок идут через запятую в порядке сервера', () => {
    expect(
      linksLine([
        { name: 'Вторая', url: 'https://tracker.example/B-2' },
        { name: 'Первая', url: 'https://tracker.example/A-1' },
      ]),
    ).toBe('- **Ссылки:** [Вторая](https://tracker.example/B-2), [Первая](https://tracker.example/A-1)');
  });

  it('при обезличивании адрес сведён к домену', () => {
    expect(
      linksLine([{ name: 'Задача', url: 'https://tracker.example/A-1' }], {
        ...defaultProfile,
        removeLinks: true,
      }),
    ).toBe('- **Ссылки:** [Задача](https://tracker.example)');
  });

  it('у кейса без ссылок строки нет', () => {
    expect(linksLine([])).toBeUndefined();
  });
});
