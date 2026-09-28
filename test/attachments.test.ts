import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AttachmentStore } from '../src/attachmentStore.js';
import type { AppConfig } from '../src/config.js';
import { type ResolveDeps, resolveToTestCase } from '../src/contentResolver.js';
import { lostMark } from '../src/scenarioMarkdown.js';
import { Gateway } from '../src/gateway.js';
import { renderMarkdown } from '../src/html.js';
import type { RawCase } from '../src/model.js';
import { defaultProfile, type FormatProfile } from '../src/profile.js';
import { editorLines } from './scenarioFixtures.js';
import { TestOpsClient } from '../src/testops/client.js';
import type { PortResponse, TestOpsPort } from '../src/testops/port.js';

const resolveScenario = async (raw: RawCase, p: FormatProfile, deps: ResolveDeps) =>
  (await resolveToTestCase(raw, p, deps)).scenarioLines;

const jwtWithExp = (secondsFromNow: number): string =>
  `h.${Buffer.from(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + secondsFromNow })).toString('base64url')}.s`;

const resp = (status: number, body: unknown): PortResponse => ({
  status,
  ok: status >= 200 && status < 300,
  json: async () => body,
  text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
});

const cfg: AppConfig = {
  baseUrl: 'https://x.test',
  token: 'секрет',
  defaultProjectId: 1,
  projects: {},
  people: {},
  trees: {},
} as unknown as AppConfig;

class RecordingPort implements TestOpsPort {
  urls: string[] = [];
  forms: Array<{ url: string; form: Record<string, string> }> = [];
  tokens = 0;
  constructor(
    private readonly reply: (url: string) => PortResponse,
    private readonly ttlSeconds = 3600,
  ) {}
  async postForm(url: string, form: Record<string, string>): Promise<PortResponse> {
    this.tokens++;
    this.forms.push({ url, form });
    return resp(200, { access_token: jwtWithExp(this.ttlSeconds) });
  }
  async get(url: string): Promise<PortResponse> {
    this.urls.push(url);
    return this.reply(url);
  }
}

const deps = (fetchAttachment: (id: number) => Promise<string>, warns: string[]) => ({
  fetchAttachment,
  baseUrl: 'https://ts.example',
  onWarn: (m: string) => warns.push(m),
});

const legacyCase = (steps: unknown): RawCase =>
  ({
    overview: { id: 30233, projectId: 1, hasManualScenario: false, scenario: { steps } },
    steps: null,
    comments: [],
  }) as unknown as RawCase;

describe('вложение общего шага', () => {
  it('запрашивается по своему адресу, а не по адресу обычного', async () => {
    const port = new RecordingPort(() =>
      resp(200, { content: [], id: 1, projectId: 1, hasManualScenario: false }),
    );
    await new TestOpsClient(cfg, port).fetchAttachment(9, true);
    expect(port.urls.some((u) => u.includes('/api/sharedstep/attachment/9/content'))).toBe(true);
    expect(port.urls.some((u) => u.includes('/api/testcase/attachment/9/content'))).toBe(false);
  });
});

describe('сохранённое вложение не перекачивается', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'tt-att-'));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('вторая сборка представления не идёт за ним в TestOps', async () => {
    const store = new AttachmentStore(dir);
    let asked = 0;
    const client = {
      fetchOverview: async () => ({
        id: 1,
        projectId: 1,
        name: 'Кейс',
        lastModifiedDate: 1,
        description: '![в](/api/testcase/attachment/9/content)',
      }),
      fetchCaseFromOverview: async (ov: unknown) => ({
        overview: ov,
        steps: null,
        comments: [],
      }),
      fetchAttachment: async () => {
        asked++;
        return { ok: true, bytes: Buffer.from('x'), contentType: 'image/png' };
      },
      fetchTrees: async () => [],
    } as unknown as import('../src/testops/client.js').TestOpsClient;

    const gw = new Gateway(cfg, client, undefined, store, () => {});
    await gw.getTestCaseHtml('1');
    await gw.getTestCaseHtml('1');
    expect(asked).toBe(1);
  });
});

describe('вложение общего шага в сценарии', () => {
  it('ссылка ведёт на адрес общего шага', () => {
    const lines = editorLines(
      [1],
      {
        root: { children: [1] },
        scenarioSteps: { 1: { sharedStepId: 9 } },
        sharedSteps: { 9: { body: 'Общий шаг', children: [2] } },
        sharedStepScenarioSteps: { 2: { body: 'Внутренний шаг', attachmentId: 7 } },
        sharedStepAttachments: { 7: { id: 7, name: 'схема.png', contentType: 'image/png' } },
        attachments: {},
      } as never,
      defaultProfile,
    );
    const text = lines.join('\n');
    expect(text).toContain('/api/sharedstep/attachment/7/content');
    expect(text).not.toContain('/api/testcase/attachment/7/content');
  });
});

describe('текст шага во вложении', () => {
  it('скачивается даже при выключенной развёртке вложений', async () => {
    const asked: number[] = [];
    const lines = await resolveScenario(
      {
        overview: { id: 1, projectId: 1, hasManualScenario: true },
        steps: {
          root: { children: [1] },
          scenarioSteps: { 1: { body: '', attachmentId: 5 } },
          attachments: { 5: { id: 5, name: 'description_1.md' } },
          sharedSteps: {},
        },
        comments: [],
      } as unknown as RawCase,
      { ...defaultProfile, steps: { ...defaultProfile.steps, expandAttachments: false } },
      {
        fetchAttachment: async (id: number) => {
          asked.push(id);
          return 'Текст из вложения';
        },
        baseUrl: 'https://ts.example',
      },
    );
    expect(asked).toEqual([5]);
    expect(lines.join('\n')).toContain('Текст из вложения');
  });
});

describe('адрес вложения без markdown-обёртки', () => {
  it('всё равно приводится к полному', async () => {
    const { absolutizeImages } = await import('../src/contentResolver.js');
    expect(absolutizeImages('см. /api/testcase/attachment/42/content', 'https://ts.example')).toBe(
      'см. https://ts.example/api/testcase/attachment/42/content',
    );
  });

  it('в html-атрибуте тоже', async () => {
    const { absolutizeImages } = await import('../src/contentResolver.js');
    expect(
      absolutizeImages('<img src="/api/testcase/attachment/42/content">', 'https://ts.example'),
    ).toContain('src="https://ts.example/api/testcase/attachment/42/content"');
  });

  it('уже полный адрес не удваивается', async () => {
    const { absolutizeImages } = await import('../src/contentResolver.js');
    const full = '![в](https://ts.example/api/testcase/attachment/42/content)';
    expect(absolutizeImages(full, 'https://ts.example')).toBe(full);
  });
});

describe('вложение, которого нет в файле', () => {
  it('на месте картинки видна подпись, а не пустой квадрат', () => {
    const html = renderMarkdown('![x](/api/testcase/attachment/9/content)', new Map());
    expect(html).toContain('data-missing-attachment="9"');
    expect(html).toContain('data:image/svg+xml');
    expect(html).not.toContain('src=""');
  });
});

describe('вложение шага не скачалось', () => {
  it('выгрузка продолжается, а кейс и вложение названы', async () => {
    const warns: string[] = [];
    const lines = await resolveScenario(
      legacyCase([
        { name: 'Шаг с текстом во вложении', attachments: [{ id: 555, name: 'description_1.md' }] },
        { name: 'Второй шаг' },
      ]),
      defaultProfile,
      deps(async () => {
        throw new Error('сервер ответил 500');
      }, warns),
    );
    expect(lines.join('\n')).toContain('Второй шаг');
    expect(warns.join(' ')).toContain('кейс 30233');
    expect(warns.join(' ')).toContain('вложение 555');
  });
});

describe('вложение, которого нет в файле', () => {
  it('на заглушке виден номер вложения', () => {
    const html = renderMarkdown('![x](/api/testcase/attachment/9/content)', new Map());
    const src = /src="data:image\/svg\+xml;base64,([^"]+)"/.exec(html);
    expect(src).not.toBeNull();
    expect(Buffer.from(src?.[1] ?? '', 'base64').toString('utf8')).toContain('вложение 9');
  });
});

describe('текстовое вложение шага не скачалось', () => {
  it('на его месте видна пометка с номером', async () => {
    const lines = await resolveScenario(
      {
        overview: {
          id: 1,
          projectId: 1,
          hasManualScenario: false,
          scenario: {
            steps: [{ name: 'Шаг', attachments: [{ id: 909, name: 'description_1.md' }] }],
          },
        },
        steps: null,
        comments: [],
      } as unknown as RawCase,
      defaultProfile,
      {
        fetchAttachment: async () => {
          throw new Error('сервер ответил 500');
        },
        baseUrl: 'https://ts.example',
      },
    );
    expect(lines.join('\n')).toContain(lostMark(909));
  });
});

describe('ожидаемый результат лежит во вложении', () => {
  it('он попадает в сценарий, а не теряется', () => {
    const lines = editorLines(
      [1],
      {
        root: { children: [1] },
        scenarioSteps: {
          1: { body: 'Открыть форму', expectedResultId: 2 },
          2: { body: '', attachmentId: 5 },
        },
        attachments: { 5: { id: 5, name: 'expected_1.md', contentType: 'text/markdown' } },
        sharedSteps: {},
      } as never,
      defaultProfile,
      new Map([[5, 'Форма открылась']]),
    );
    expect(lines.join('\n')).toContain('Форма открылась');
  });
});
