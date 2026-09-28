import { describe, expect, it } from 'vitest';
import { scenarioStateOf } from '../src/audit.js';
import { type ResolveDeps, resolveToTestCase } from '../src/contentResolver.js';
import { renderRich } from '../src/htmlRich.js';
import { renderCaseHtml } from '../src/html.js';
import type { RawCase, RichNode, TestCase } from '../src/model.js';
import { defaultProfile } from '../src/profile.js';

const deps = (bodies: Record<number, string | null> = {}): ResolveDeps => ({
  baseUrl: 'https://ts.example',
  fetchAttachment: async (id) => {
    const body = bodies[id];
    if (body === undefined || body === null) throw new Error('нет вложения');
    return body;
  },
});

const html = (tc: TestCase): string => {
  const page = renderCaseHtml({ tc, state: 'current' }, defaultProfile, new Map());
  return page.slice(page.indexOf('<section class="block scenario">'));
};
const stepLists = (text: string): number => (text.match(/<ol class="steps">/g) ?? []).length;

const editorCase = (steps: Record<string, unknown>, children: number[], extra = {}): RawCase =>
  ({
    overview: { id: 1, name: 'Кейс', hasManualScenario: true, scenario: { steps: [] } },
    steps: { root: { children }, scenarioSteps: steps, attachments: {}, ...extra },
  }) as unknown as RawCase;

const legacyCase = (steps: unknown[], attachments: unknown[] = []): RawCase =>
  ({
    overview: { id: 2, name: 'Кейс', hasManualScenario: false, scenario: { attachments, steps } },
    steps: null,
  }) as unknown as RawCase;

const md = (id: number, name: string) => ({ id, name, contentType: 'text/markdown' });

describe('новый редактор', () => {
  it('вложение шага стоит внутри шага, ожидаемый результат — под шагом', async () => {
    const raw = editorCase(
      {
        1: { body: 'Открыть форму', attachmentId: 9, expectedResultId: 2 },
        2: { body: 'Expected Result', children: [3] },
        3: { body: 'Форма открыта' },
      },
      [1],
      { attachments: { 9: { id: 9, name: 'форма.png', contentType: 'image/png' } } },
    );
    const out = html(await resolveToTestCase(raw, defaultProfile, deps()));
    expect(stepLists(out)).toBe(1);
    expect(out).toMatch(/<li data-n="1\.">Открыть форму<div class="stepExtra"><img [^>]*>/);
    expect(out).toContain('<ol class="expList"><li data-n="1.">Форма открыта</li></ol>');
  });

  it('развёрнутый текст вложения — внутри шага, а не вложенные шаги', async () => {
    const raw = editorCase({ 1: { body: 'Проверить ответ', attachmentId: 7 } }, [1], {
      attachments: { 7: { id: 7, name: 'ответ.txt', contentType: 'text/plain' } },
    });
    const tc = await resolveToTestCase(raw, defaultProfile, deps({ 7: 'строка один\nстрока два' }));
    const out = html(tc);
    expect(stepLists(out)).toBe(1);
    expect(out).toContain('строка один<br>строка два');
  });

  it('общий шаг выводится с подписью, его шаги — вложенным списком', async () => {
    const raw = editorCase({ 1: { sharedStepId: 5 } }, [1], {
      sharedSteps: { 5: { body: 'Вход', children: [11, 12] } },
      sharedStepScenarioSteps: { 11: { body: 'Ввести логин' }, 12: { body: 'Ввести пароль' } },
    });
    const out = html(await resolveToTestCase(raw, defaultProfile, deps()));
    expect(out).toContain('<li data-n="1."><strong>Общий шаг: Вход</strong><ol class="steps">');
    expect(out).toContain('<li data-n="1.">Ввести логин</li><li data-n="2.">Ввести пароль</li>');
  });

  it('шаг с текстом «Ожидаемый результат» остаётся шагом', async () => {
    const raw = editorCase({ 1: { body: 'Открыть' }, 2: { body: 'Ожидаемый результат' } }, [1, 2]);
    const out = html(await resolveToTestCase(raw, defaultProfile, deps()));
    expect(out).toContain('<li data-n="2.">Ожидаемый результат</li>');
    expect(out).not.toContain('expLabel');
  });

  it('узел без текста получает номер, чтобы вложенный шаг остался в правильном списке', async () => {
    const raw = editorCase(
      { 1: { body: '', children: [2] }, 2: { body: 'Вложенный' }, 3: { body: 'Следующий' } },
      [1, 3],
    );
    const tc = await resolveToTestCase(raw, defaultProfile, deps());
    expect(tc.scenarioLines).toEqual(['1.', '    1. Вложенный', '2. Следующий']);
    expect(html(tc)).toContain(
      '<li data-n="1."><ol class="steps"><li data-n="1.">Вложенный</li></ol></li><li data-n="2.">Следующий</li>',
    );
  });
});

describe('старый формат', () => {
  it('описание списком — под именем шага, ожидаемый результат под ним', async () => {
    const raw = legacyCase([
      {
        name: 'Step 0',
        attachments: [md(21, 'description_0.md'), md(22, 'expected_0.md')],
      },
      { name: 'Закрыть форму' },
    ]);
    const tc = await resolveToTestCase(
      raw,
      defaultProfile,
      deps({ 21: '1. Выбрать клиента\n2. Нажать кнопку', 22: '1. Появилось сообщение\n2. Открылась страница' }),
    );
    expect(tc.scenarioLines).toEqual([
      '1. Step 0',
      '   1. Выбрать клиента',
      '   2. Нажать кнопку',
      '',
      '    **Ожидаемый результат:**',
      '',
      '    1. Появилось сообщение',
      '    2. Открылась страница',
      '2. Закрыть форму',
    ]);
    const out = html(tc);
    expect(stepLists(out)).toBe(1);
    expect(out).toContain('<li data-n="1.">Step 0<div class="stepExtra"><ol><li>Выбрать клиента</li><li>Нажать кнопку</li></ol>');
    expect(out).toContain('</div></div></li><li data-n="2.">Закрыть форму</li></ol>');
  });

  it('многострочное описание — под именем шага', async () => {
    const raw = legacyCase([{ name: 'Step 0', attachments: [md(31, 'description_0.md')] }]);
    const tc = await resolveToTestCase(raw, defaultProfile, deps({ 31: 'первая\nвторая\nтретья' }));
    const out = html(tc);
    expect(stepLists(out)).toBe(1);
    expect(out).toContain('<li data-n="1.">Step 0<div class="stepExtra">');
    expect(out).toContain('первая<br>вторая<br>третья');
  });

  it('перенос автора внутри пункта виден, как в TestOps', async () => {
    const raw = legacyCase([
      { name: 'Step 0', attachments: [md(32, 'description_0.md'), md(33, 'expected_0.md')] },
    ]);
    const tc = await resolveToTestCase(
      raw,
      defaultProfile,
      deps({ 32: 'Нажать', 33: '1. Появилось сообщение "Заявка \n  отправлена"\n2. Редирект' }),
    );
    expect(html(tc)).toContain('<li>Появилось сообщение &quot;Заявка<br>  отправлена&quot;</li>');
  });

  it('маркированное описание — список под именем шага, номер как в Markdown', async () => {
    const raw = legacyCase([
      { name: 'Step 0', attachments: [md(41, 'description_0.md')] },
      { name: 'Второй шаг' },
    ]);
    const tc = await resolveToTestCase(raw, defaultProfile, deps({ 41: '- пункт один\n- пункт два' }));
    expect(tc.scenarioLines).toEqual(['1. Step 0', '   - пункт один', '   - пункт два', '2. Второй шаг']);
    const out = html(tc);
    expect(out).toContain('<li data-n="1.">Step 0<div class="stepExtra"><ul><li>пункт один</li><li>пункт два</li></ul>');
    expect(out).toContain('<li data-n="2.">Второй шаг</li>');
  });

  it('картинка, файл и потерянное вложение — внутри шага', async () => {
    const raw = legacyCase([
      {
        name: 'Шаг',
        attachments: [
          md(51, 'description_0.md'),
          { id: 52, name: 'экран.png', contentType: 'image/png' },
          { id: 53, name: 'отчёт.xlsx', contentType: 'application/vnd.ms-excel' },
        ],
      },
    ]);
    const tc = await resolveToTestCase(raw, defaultProfile, deps({ 51: null }));
    expect(tc.scenarioLines).toEqual([
      '1. Шаг',
      '   _вложение 51 недоступно_',
      '   ![экран.png](https://ts.example/api/testcase/attachment/52/content)',
      '   [отчёт.xlsx](https://ts.example/api/testcase/attachment/53/content)',
    ]);
    const out = html(tc);
    expect(stepLists(out)).toBe(1);
    expect(out).toContain('<div class="stepExtra"><em>вложение 51 недоступно</em></div>');
    expect(out).toMatch(/<div class="stepExtra"><img [^>]*alt="экран\.png"/);
    expect(out).toContain('>отчёт.xlsx</a></div>');
  });

  it('поле ожидаемого результата шага выводится всеми строками, имя шага остаётся', async () => {
    const raw = legacyCase([
      { name: 'Отключить пины «EOI»', expectedResult: 'Пропадают пины «EOI»\nОстаются ЖК «В продаже»' },
    ]);
    const tc = await resolveToTestCase(raw, defaultProfile, deps());
    expect(tc.scenarioLines).toEqual([
      '1. Отключить пины «EOI»',
      '',
      '    **Ожидаемый результат:**',
      '',
      '    Пропадают пины «EOI»',
      '    Остаются ЖК «В продаже»',
    ]);
  });

  it('пустой шаг получает номер и пустой текст, как и в Markdown', async () => {
    const raw = legacyCase([{ name: '' }, { name: 'Шаг' }]);
    const tc = await resolveToTestCase(raw, defaultProfile, deps());
    expect(tc.scenarioLines).toEqual(['1.', '2. Шаг']);
    expect(html(tc)).toContain('<ol class="steps"><li data-n="1."></li><li data-n="2.">Шаг</li></ol>');
  });

  it('customSteps.md на шаге — его текст под шагом без номера, как description_N.md', async () => {
    const raw = legacyCase([{ name: 'Открыть карточку', attachments: [md(91, 'customSteps.md')] }]);
    const table = '| Проверить |\n|---|\n| один ЖК |\n| несколько ЖК |';
    const tc = await resolveToTestCase(raw, defaultProfile, deps({ 91: table }));
    expect(tc.scenarioSource).toBe('inlineSteps');
    expect(tc.scenarioLines).toEqual([
      '1. Открыть карточку',
      '   | Проверить |',
      '   |---|',
      '   | один ЖК |',
      '   | несколько ЖК |',
    ]);
    const out = html(tc);
    expect(stepLists(out)).toBe(1);
    expect(out).toMatch(/<li data-n="1\.">Открыть карточку<div class="stepExtra"><table>[\s\S]*<td>один ЖК<\/td>/);
  });

  it('недоступный customSteps.md на шаге — пометка внутри шага', async () => {
    const raw = legacyCase([{ name: 'Шаг', attachments: [md(92, 'customSteps.md')] }]);
    const tc = await resolveToTestCase(raw, defaultProfile, deps());
    expect(html(tc)).toContain('<li data-n="1.">Шаг<div class="stepExtra"><em>вложение 92 недоступно</em></div></li>');
  });

});

describe('автотест и пустой сценарий', () => {
  it('пять уровней шагов прогона — пять вложенных списков', async () => {
    const level = (depth: number): unknown =>
      depth ? { name: `Уровень ${depth}`, steps: [level(depth - 1)] } : { name: 'Лист' };
    const raw = {
      overview: { id: 4, hasManualScenario: false, scenario: { steps: [] } },
      steps: null,
      runScenario: { steps: [level(4)] },
    } as unknown as RawCase;
    const out = html(await resolveToTestCase(raw, defaultProfile, deps()));
    expect(stepLists(out)).toBe(5);
    expect(out.indexOf('Нет шагов')).toBeLessThan(out.indexOf('<ol class="steps">'));
  });

  it('пустой сценарий с ошибкой — две строки отдельно', async () => {
    const raw = { overview: { id: 5, hasManualScenario: true }, steps: null } as unknown as RawCase;
    const out = html(await resolveToTestCase(raw, defaultProfile, deps()));
    expect(out).toContain('</blockquote><p><em>Ошибка получения шагов или пустой ответ API</em></p>');
  });
});

describe('размеченный текст', () => {
  it('текст после заголовка и блока кода не теряется', () => {
    const node: RichNode = {
      type: 'doc',
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: 'абзац' }] },
        { type: 'heading', content: [{ type: 'text', text: 'заголовок' }] },
        { type: 'codeBlock', content: [{ type: 'text', text: 'код' }] },
      ],
    };
    expect(renderRich(node)).toBe('<p class="para">абзац</p><p class="para">заголовок</p><p class="para">код</p>');
  });
});

describe('ручной кейс, у которого единственный шаг «Scenario» с customSteps.md', () => {
  const raw = {
    overview: { id: 4, name: 'Кейс', hasManualScenario: true, scenario: { steps: [] } },
    steps: {
      root: { children: [1] },
      scenarioSteps: { 1: { body: 'Scenario', children: [2] }, 2: { attachmentId: 9 } },
      attachments: { 9: { id: 9, name: 'customSteps.md', contentType: 'text/markdown' } },
    },
  } as unknown as RawCase;

  it('показан шагами, как в TestOps, а пометка старого формата сохраняется', async () => {
    const tc = await resolveToTestCase(raw, defaultProfile, deps({ 9: '1. Открыть\n2. Закрыть' }));
    expect(tc.scenarioLines).toEqual([
      '1. Scenario',
      '   1. Открыть',
      '   2. Закрыть',
    ]);
    expect(scenarioStateOf(tc, raw)).toBe('oldFormat');
  });
});

describe('customSteps.md лежит не на единственном и не на «Scenario» шаге', () => {
  it('второй из двух обычных корневых шагов — тоже старый формат', async () => {
    const raw = {
      overview: { id: 6, name: 'Кейс', hasManualScenario: true, scenario: { steps: [] } },
      steps: {
        root: { children: [1, 2] },
        scenarioSteps: {
          1: { body: 'Обычный шаг' },
          2: { body: 'Второй шаг', attachmentId: 9 },
        },
        attachments: { 9: { id: 9, name: 'customSteps.md', contentType: 'text/markdown' } },
      },
    } as unknown as RawCase;

    const tc = await resolveToTestCase(raw, defaultProfile, deps({ 9: 'текст' }));
    expect(tc.scenarioSource).toBe('newSteps');
    expect(scenarioStateOf(tc, raw)).toBe('oldFormat');
  });
});
