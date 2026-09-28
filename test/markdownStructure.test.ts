import { Node, Parser } from 'commonmark';
import { describe, expect, it } from 'vitest';
import { type ResolveDeps, resolveToTestCase } from '../src/contentResolver.js';
import type { RawCase, RawStepData, Scenario } from '../src/model.js';
import { defaultProfile, type FormatProfile } from '../src/profile.js';
import { renderCase } from '../src/render.js';
import { scenarioLines } from '../src/scenarioMarkdown.js';
import { currentFormat } from './fixtures.js';
import { editorLines, step, stepsOf } from './scenarioFixtures.js';

const resolveScenario = async (raw: RawCase, p: FormatProfile, deps: ResolveDeps) =>
  (await resolveToTestCase(raw, p, deps)).scenarioLines;

interface ListItem {
  text: string;
  lists: ListBlock[];
}
interface ListBlock {
  ordered: boolean;
  delimiter: string | null;
  items: ListItem[];
}

function inlineText(node: Node): string {
  let out = '';
  for (let child = node.firstChild; child; child = child.next) {
    out += child.type === 'text' || child.type === 'code' ? (child.literal ?? '') : inlineText(child);
  }
  return out;
}

function extractItem(item: Node): ListItem {
  const lists: ListBlock[] = [];
  let text = '';
  for (let node = item.firstChild; node; node = node.next) {
    if (node.type === 'list') lists.push(extractList(node));
    else if (node.type === 'paragraph' || node.type === 'heading') text += inlineText(node);
  }
  return { text, lists };
}

function extractList(list: Node): ListBlock {
  const items: ListItem[] = [];
  for (let item = list.firstChild; item; item = item.next) items.push(extractItem(item));
  return { ordered: list.listType === 'ordered', delimiter: list.listDelimiter ?? null, items };
}

function topLevel(markdown: string): Node[] {
  const doc = new Parser().parse(markdown);
  const out: Node[] = [];
  for (let node = doc.firstChild; node; node = node.next) out.push(node);
  return out;
}

function topLists(markdown: string): ListBlock[] {
  return topLevel(markdown)
    .filter((n) => n.type === 'list')
    .map(extractList);
}

function codeBlocks(markdown: string): Node[] {
  const doc = new Parser().parse(markdown);
  const out: Node[] = [];
  const walker = doc.walker();
  let event = walker.next();
  while (event) {
    if (event.entering && event.node.type === 'code_block') out.push(event.node);
    event = walker.next();
  }
  return out;
}

const deps: ResolveDeps = {
  baseUrl: 'https://ts.example',
  fetchAttachment: async () => '',
};

describe('сценарии из test/fixtures.ts: структура совпадает с TestOps', () => {
  it('структурированные шаги: вложенность без лишних блоков кода', async () => {
    const lines = (await resolveScenario(currentFormat, defaultProfile, deps)).join('\n');
    expect(codeBlocks(lines)).toHaveLength(0);
    const [top] = topLists(lines);
    expect(top?.items.map((i) => i.text)).toEqual(['Открыть форму входа', 'Ввести пароль']);
    expect(top?.items[1]?.lists[0]?.items.map((i) => i.text)).toEqual(['Пароль скрыт точками']);
  });
});

describe('список ожидаемого результата не сливается со списком вложенных шагов', () => {
  it('у шага и пункты, и вложенные шаги — это два разных списка', () => {
    const scenario: Scenario = stepsOf(
      step('Шаг', {
        expected: { kind: 'items', items: [step('пункт один'), step('пункт два')] },
        children: [step('вложенный шаг')],
      }),
    );
    const md = scenarioLines(scenario, defaultProfile).join('\n');
    const item = topLists(md)[0]?.items[0];
    expect(item?.lists).toHaveLength(2);
    expect(item?.lists[0]?.items.map((i) => i.text)).toEqual(['пункт один', 'пункт два']);
    expect(item?.lists[1]?.items.map((i) => i.text)).toEqual(['вложенный шаг']);
    expect(item?.lists[0]?.delimiter).not.toBe(item?.lists[1]?.delimiter);
  });
});

describe('номер шага от 100 не ломает вложенность', () => {
  it('сотый шаг с ожидаемым результатом остаётся в списке, а не в коде', () => {
    const steps = Array.from({ length: 100 }, (_, i) =>
      i === 99
        ? step(`Шаг ${i + 1}`, { expected: { kind: 'items', items: [step('Готово')] } })
        : step(`Шаг ${i + 1}`),
    );
    const md = scenarioLines(stepsOf(...steps), defaultProfile).join('\n');
    expect(codeBlocks(md)).toHaveLength(0);
    const top = topLists(md)[0];
    expect(top?.items).toHaveLength(100);
    expect(top?.items[99]?.lists[0]?.items.map((i) => i.text)).toEqual(['Готово']);
  });
});

describe('шаг без текста, но с вложенными шагами, получает номер', () => {
  it('как первый шаг сценария — не становится блоком кода', () => {
    const scenario = stepsOf(step('', { children: [step('Вложенный')] }), step('Следующий'));
    const md = scenarioLines(scenario, defaultProfile).join('\n');
    expect(codeBlocks(md)).toHaveLength(0);
    const top = topLists(md)[0];
    expect(top?.items).toHaveLength(2);
    expect(top?.items[0]?.text).toBe('');
    expect(top?.items[0]?.lists[0]?.items.map((i) => i.text)).toEqual(['Вложенный']);
  });
});

describe('баннер пустого сценария и строка ошибки — разные блоки', () => {
  it('строка ошибки не сливается в цитату баннера', () => {
    const scenario: Scenario = { kind: 'empty', fetchError: true };
    const md = scenarioLines(scenario, defaultProfile).join('\n');
    const [first, second] = topLevel(md);
    expect(first?.type).toBe('block_quote');
    expect(second?.type).toBe('paragraph');
  });
});

describe('адрес ссылки в Markdown', () => {
  it('адрес ссылки с пробелом остаётся одним адресом', () => {
    const tc = {
      id: '1',
      name: 'Кейс',
      path: [],
      status: 'Active',
      automated: false,
      layer: '',
      tags: [],
      attachments: [],
      linkRefs: [{ name: 'A', url: 'https://x.test/a b' }],
      issues: [],
      people: [],
      relatedCases: [],
      comments: [],
      attributes: [],
      isLegacy: false,
      description: '',
      precondition: '',
      expectedResult: '',
      scenario: stepsOf('Шаг'),
      scenarioLines: ['1. Шаг'],
      scenarioSource: 'newSteps',
    } as never;
    const md = renderCase(tc, defaultProfile);
    const doc = new Parser().parse(md);
    const walker = doc.walker();
    let event = walker.next();
    let dest = '';
    while (event) {
      if (event.entering && event.node.type === 'link') dest = event.node.destination ?? '';
      event = walker.next();
    }
    expect(decodeURI(dest)).toBe('https://x.test/a b');
  });
});

describe('пункт ожидаемого результата сохраняет свои вложенные шаги', () => {
  const data: RawStepData = {
    root: { children: [1] },
    scenarioSteps: {
      1: { body: 'Шаг', expectedResultId: 2 },
      2: { body: 'Expected Result', children: [3] },
      3: { body: 'Пункт с подпунктом', children: [4] },
      4: { body: 'Подпункт' },
    },
  };

  it('в Markdown у пункта есть собственный вложенный список', () => {
    const md = editorLines([1], data, defaultProfile).join('\n');
    const item = topLists(md)[0]?.items[0];
    const expectedList = item?.lists[0];
    expect(expectedList?.items[0]?.text).toBe('Пункт с подпунктом');
    expect(expectedList?.items[0]?.lists[0]?.items.map((i) => i.text)).toEqual(['Подпункт']);
  });
});

