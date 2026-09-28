import { describe, expect, it } from 'vitest';
import { renderRich } from '../src/htmlRich.js';
import { scenarioHtml } from '../src/htmlRichSteps.js';
import { resolveToTestCase } from '../src/contentResolver.js';
import type { RawCase, RawStepData, RichNode } from '../src/model.js';
import { defaultProfile } from '../src/profile.js';
import { editorHtml, editorLines } from './scenarioFixtures.js';

const data = {
  root: { children: [1] },
  scenarioSteps: {
    1: { body: 'Повторно запросить фиксацию', expectedResultId: 2 },
    2: { body: 'Expected Result', children: [3] },
    3: { body: '- HTTP 200 OK.\n- phone = "+7<номер>".\n- Номер изменился без правок в БД' },
  },
  attachments: {},
} as unknown as RawStepData;

describe('многострочный текст шага в Markdown', () => {
  it('строки продолжения идут с отступом уровня пункта плюс ширина его номера', () => {
    const lines = editorLines([1], data, defaultProfile);
    expect(lines.join('\n')).toBe(
      '1. Повторно запросить фиксацию\n' +
        '\n' +
        '    **Ожидаемый результат**\n' +
        '\n' +
        '    1) - HTTP 200 OK.\n' +
        '       - phone = "+7<номер>".\n' +
        '       - Номер изменился без правок в БД',
    );
  });
});

describe('ожидаемый результат из нескольких пунктов в HTML', () => {
  it('каждый пункт под своим номером, многострочный текст — под номером пункта', () => {
    const paragraph = (text: string) => ({ type: 'paragraph', content: [{ type: 'text', text }] });
    const twoItems = {
      root: { children: [1] },
      scenarioSteps: {
        1: { body: 'Повторно запросить фиксацию', expectedResultId: 2 },
        2: { body: 'Expected Result', children: [3, 4] },
        3: {
          body: '- HTTP 200 OK.\n- Номер изменился',
          bodyJson: { type: 'doc', content: [paragraph('- HTTP 200 OK.'), paragraph('- Номер изменился')] },
        },
        4: { body: 'еще шаг', bodyJson: { type: 'doc', content: [paragraph('еще шаг')] } },
      },
      attachments: {},
    } as unknown as RawStepData;
    const html = editorHtml([1], twoItems, defaultProfile);
    expect(html).toContain(
      '<ol class="expList"><li data-n="1."><p class="para">- HTTP 200 OK.</p><p class="para">- Номер изменился</p></li><li data-n="2."><p class="para">еще шаг</p></li></ol>',
    );
  });
});

describe('абзацы размеченного текста в HTML', () => {
  const doc: RichNode = {
    type: 'doc',
    content: [
      { type: 'paragraph', content: [{ type: 'text', text: '- HTTP 200 OK.' }] },
      { type: 'paragraph', content: [{ type: 'text', text: '- Номер изменился' }] },
    ],
  };

  it('каждый абзац — своя строка, как в TestOps', () => {
    expect(renderRich(doc)).toBe('<p class="para">- HTTP 200 OK.</p><p class="para">- Номер изменился</p>');
  });

  it('принудительный перенос внутри абзаца — перенос строки', () => {
    const withBreak: RichNode = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'первая' },
            { type: 'hardBreak' },
            { type: 'text', text: 'вторая' },
          ],
        },
      ],
    };
    expect(renderRich(withBreak)).toBe('<p class="para">первая<br>вторая</p>');
  });
});

describe('многострочный ожидаемый результат старого формата', () => {
  const files: Record<number, string> = {
    1: 'Перейти на страницу',
    2: '* Отображается список\n* Внизу списка:\n    - кнопка "Предыдущая"\n    - номера страниц',
  };
  const legacy = {
    overview: {
      id: 7,
      projectId: 1,
      name: 'Кейс',
      hasManualScenario: false,
      scenario: {
        steps: [
          {
            name: 'Step 0',
            attachments: [
              { id: 1, name: 'description_0.md', contentType: 'text/markdown' },
              { id: 2, name: 'expected_0.md', contentType: 'text/markdown' },
            ],
          },
        ],
      },
    },
    steps: null,
    runScenario: null,
    comments: [],
  } as unknown as RawCase;
  const deps = { fetchAttachment: async (id: number) => files[id] ?? '', baseUrl: 'https://x.test' };

  it('Markdown: подпись отдельной строкой, текст под ней с сохранённой вложенностью', async () => {
    const tc = await resolveToTestCase(legacy, defaultProfile, deps);
    expect(tc.scenarioLines).toEqual([
      '1. Step 0',
      '   Перейти на страницу',
      '',
      '    **Ожидаемый результат:**',
      '',
      '    * Отображается список',
      '    * Внизу списка:',
      '        - кнопка "Предыдущая"',
      '        - номера страниц',
    ]);
  });

  it('HTML: список со вложенным списком, без номеров шагов', async () => {
    const tc = await resolveToTestCase(legacy, defaultProfile, deps);
    const html = scenarioHtml(tc.scenario, defaultProfile, new Map());
    expect(html).toContain('<div class="expItem"><ul><li>Отображается список</li><li>Внизу списка:<ul>');
    expect((html.match(/<ol class="steps">/g) ?? []).length).toBe(1);
  });
});

describe('ожидаемый результат нового формата во вложении и свой шаблон подписи', () => {
  const withAttachment = {
    root: { children: [1] },
    scenarioSteps: {
      1: { body: 'Открыть', expectedResultId: 2 },
      2: { body: '', attachmentId: 5 },
    },
    attachments: { 5: { id: 5, name: 'expected.md', contentType: 'text/markdown' } },
  } as unknown as RawStepData;
  const expanded = new Map([[5, '* первое\n* второе\n    - вложенное']]);

  it('строки вложения не склеиваются, вложенность сохраняется', () => {
    const lines = editorLines([1], withAttachment, defaultProfile, expanded);
    expect(lines).toEqual([
      '1. Открыть',
      '',
      '    **Ожидаемый результат:**',
      '',
      '    * первое',
      '    * второе',
      '        - вложенное',
    ]);
  });

  it('шаблон с текстом после {text}: подпись — начало шаблона, хвост — строкой после текста', () => {
    const profile = { ...defaultProfile, steps: { ...defaultProfile.steps, expectedInline: 'Итог: {text} (конец)' } };
    const lines = editorLines([1], withAttachment, profile, expanded);
    expect(lines).toEqual([
      '1. Открыть',
      '',
      '    Итог:',
      '',
      '    * первое',
      '    * второе',
      '        - вложенное',
      '    (конец)',
    ]);
  });
});

describe('HTML со своим шаблоном подписи ожидаемого результата', () => {
  it('ожидаемый результат берётся из модели, текст под подписью выводится списком', () => {
    const profile = { ...defaultProfile, steps: { ...defaultProfile.steps, expectedInline: 'Итог: {text}' } };
    const withAttachment = {
      root: { children: [1] },
      scenarioSteps: { 1: { body: 'Открыть', expectedResultId: 2 }, 2: { body: '', attachmentId: 5 } },
      attachments: { 5: { id: 5, name: 'expected.md', contentType: 'text/markdown' } },
    } as unknown as RawStepData;
    const html = editorHtml([1], withAttachment, profile, new Map([[5, '* первое\n* второе']]));
    expect(html).toContain('<div class="exp"><div class="expLabel">Ожидаемый результат</div><div class="expItem"><ul>');
    expect(html).toContain('<li data-n="1.">Открыть');
    expect((html.match(/<li>/g) ?? []).length).toBe(2);
  });
});
