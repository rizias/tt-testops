import { describe, expect, it } from 'vitest';
import type { AppConfig } from '../src/config.js';
import { type ResolveDeps, resolveToTestCase } from '../src/contentResolver.js';
import { Gateway } from '../src/gateway.js';
import { type EmbeddedAssets, renderRich } from '../src/html.js';
import type { RawCase, RichNode } from '../src/model.js';
import { defaultProfile, type FormatProfile } from '../src/profile.js';
import type { AttachmentResult, TestOpsClient } from '../src/testops/client.js';

const resolveScenario = async (raw: RawCase, p: FormatProfile, deps: ResolveDeps) =>
  (await resolveToTestCase(raw, p, deps)).scenarioLines;

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
      overview: { id: 1, projectId: 1, hasManualScenario: false, scenario: { steps: [] } },
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
    expect(renderRich(node, assets)).toContain('src="data:image/png;base64,AAA"');
  });
});

describe('картинка живёт только в размеченном дереве шага', () => {
  it('её вложение скачивается и встраивается в HTML', async () => {
    const bytes = Buffer.from('байты-501');
    const raw = {
      overview: { id: 7, projectId: 1, name: 'Кейс', hasManualScenario: true },
      steps: {
        root: { children: [1] },
        scenarioSteps: {
          1: {
            body: 'Шаг',
            bodyJson: {
              type: 'paragraph',
              content: [{ type: 'image', attrs: { src: '/api/testcase/attachment/501/content' } }],
            },
          },
        },
        attachments: {},
      },
      comments: [],
    } as unknown as RawCase;
    const client = {
      fetchOverview: async () => raw.overview,
      fetchCaseFromOverview: async () => raw,
      fetchTrees: async () => [],
      fetchRelations: async () => [],
      fetchAttachment: async (id: number): Promise<AttachmentResult> =>
        id === 501
          ? { ok: true, bytes, contentType: 'image/png' }
          : { ok: false, reason: 'нет', transient: false },
    } as unknown as TestOpsClient;
    const cfg: AppConfig = {
      baseUrl: 'https://ts.example',
      token: 'tok',
      defaultProjectId: 1,
      projects: {},
      people: {},
      trees: {},
      profileDir: '',
    };
    const html = await new Gateway(cfg, client, undefined, null, () => undefined).getTestCaseHtml('7');
    expect(html).toContain(`src="data:image/png;base64,${bytes.toString('base64')}"`);
  });
});
