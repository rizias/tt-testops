import { describe, expect, it } from 'vitest';
import { embedAssets } from '../src/assets.js';
import { type ResolveDeps, resolveScenario, resolveToTestCase } from '../src/contentResolver.js';
import { type EmbeddedAssets, type HtmlCase, renderRich } from '../src/html.js';
import type { RawCase, RichNode, TestCase } from '../src/model.js';
import { defaultProfile } from '../src/profile.js';
import type { TestOpsClient } from '../src/testops/client.js';

const deps = (bodies: Record<number, string> = {}): ResolveDeps => ({
  fetchAttachment: async (id) => bodies[id] ?? '',
  baseUrl: 'https://ts.example',
});

const caseWith = (scenario: unknown): RawCase =>
  ({
    overview: { id: 1, name: 'Кейс', hasManualScenario: false, scenario },
    steps: null,
  }) as unknown as RawCase;

const depsR5 = (fetchAttachment: (id: number) => Promise<string>, warns: string[]) => ({
  fetchAttachment,
  baseUrl: 'https://ts.example',
  onWarn: (m: string) => warns.push(m),
});

describe('картинка, прикреплённая к шагу старого формата', () => {
  it('становится ссылкой с полным адресом', async () => {
    const raw = caseWith({
      attachments: [],
      steps: [
        {
          name: 'Открыть форму',
          attachments: [{ id: 55, name: 'screen.png', contentType: 'image/png' }],
        },
      ],
    });

    const lines = await resolveScenario(raw, defaultProfile, deps());

    expect(lines.join('\n')).toContain(
      '![screen.png](https://ts.example/api/testcase/attachment/55/content)',
    );
  });

  it('вложение с текстом картинкой не считается', async () => {
    const raw = caseWith({
      attachments: [],
      steps: [
        {
          name: 'Шаг',
          attachments: [{ id: 60, name: 'description_1.md', contentType: 'text/markdown' }],
        },
      ],
    });

    const lines = await resolveScenario(raw, defaultProfile, deps({ 60: 'Текст из вложения' }));

    expect(lines.join('\n')).toContain('Текст из вложения');
    expect(lines.join('\n')).not.toContain('![');
  });
});

describe('картинка в комментарии', () => {
  it('получает полный адрес, как картинка шага', async () => {
    const warns: string[] = [];
    const raw = {
      overview: { id: 1, projectId: 14, hasManualScenario: false, scenario: { steps: [] } },
      steps: null,
      comments: [
        {
          id: 5,
          createdDate: 1,
          body: '![вид](/api/testcase/attachment/77/content)',
          createdBy: 'кто-то',
        },
      ],
    } as unknown as RawCase;
    const tc = await resolveToTestCase(
      raw,
      defaultProfile,
      depsR5(async () => '', warns),
    );
    expect(tc.comments[0]?.body).toBe(
      '![вид](https://ts.example/api/testcase/attachment/77/content)',
    );
  });
});

describe('картинка в размеченном тексте шага', () => {
  it('встраивается из скачанных вложений', () => {
    const node: RichNode = {
      type: 'paragraph',
      content: [{ type: 'image', attrs: { src: '/api/testcase/attachment/12/content' } }],
    };
    const assets: EmbeddedAssets = new Map([[12, 'data:image/png;base64,AAA']]);
    expect(renderRich(node, defaultProfile, assets)).toContain('src="data:image/png;base64,AAA"');
  });
});

describe('картинка живёт только в размеченном дереве шага', () => {
  it('её вложение всё равно скачивается для встраивания', async () => {
    const asked: number[] = [];
    const items = [
      {
        tc: {
          id: '7',
          description: '',
          precondition: '',
          expectedResult: '',
          scenarioLines: ['1. Шаг'],
          comments: [],
          scenarioRich: [
            {
              type: 'paragraph',
              content: [{ type: 'image', attrs: { src: '/api/testcase/attachment/501/content' } }],
            },
          ],
        } as unknown as TestCase,
        state: 'current',
      } as HtmlCase,
    ];
    await embedAssets(
      {
        client: {
          fetchAttachment: async (id: number) => {
            asked.push(id);
            return { ok: true, bytes: Buffer.from('x'), contentType: 'image/png' };
          },
        } as unknown as TestOpsClient,
        cache: null,
        onWarn: () => {},
      },
      items,
    );
    expect(asked).toEqual([501]);
  });
});
