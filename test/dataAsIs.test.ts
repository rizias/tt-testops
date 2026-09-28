import { describe, expect, it } from 'vitest';
import type { AppConfig } from '../src/config.js';
import { type ResolveDeps, resolveToTestCase } from '../src/contentResolver.js';
import { Gateway } from '../src/gateway.js';
import { renderCaseHtml } from '../src/html.js';
import type { RawCase } from '../src/model.js';
import { auditCase } from '../src/audit.js';
import { normalizeCase } from '../src/normalize.js';
import { defaultProfile } from '../src/profile.js';
import { renderBatch, renderCase } from '../src/render.js';
import { TestOpsClient } from '../src/testops/client.js';
import type { PortResponse, TestOpsPort } from '../src/testops/port.js';

const resp = (status: number, body: unknown): PortResponse => ({
  status,
  ok: status >= 200 && status < 300,
  json: async () => body,
  text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
});

const fakeJwt = `h.${Buffer.from(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 3600 })).toString('base64url')}.s`;

const cfg: AppConfig = {
  baseUrl: 'https://x.test',
  token: 'tok',
  defaultProjectId: 1,
  projects: {},
  people: {},
  trees: {},
  profileDir: '/tmp/tt-test-profile',
};

class PagedPort implements TestOpsPort {
  urls: string[] = [];
  constructor(private readonly pages: unknown[][]) {}
  async postForm(): Promise<PortResponse> {
    return resp(200, { access_token: fakeJwt });
  }
  async get(url: string): Promise<PortResponse> {
    this.urls.push(url);
    const page = Number(new URL(url).searchParams.get('page'));
    return resp(200, { content: this.pages[page] ?? [], totalPages: this.pages.length });
  }
}

const pageOf = (url: string): string | null => new URL(url).searchParams.get('page');

describe('справочники берутся по всем страницам', () => {
  it('слои: обе страницы запрошены, все слои в ответе', async () => {
    const port = new PagedPort([
      [
        { id: 1, name: 'UI' },
        { id: 2, name: 'API' },
      ],
      [{ id: 3, name: 'Unit' }],
    ]);
    const layers = await new TestOpsClient(cfg, port).fetchLayers();
    expect(layers.map((l) => l.name)).toEqual(['UI', 'API', 'Unit']);
    expect(port.urls.filter((u) => u.includes('/api/testlayer')).map(pageOf)).toEqual(['0', '1']);
  });

  it('значения поля по тексту: обе страницы запрошены, все значения в ответе', async () => {
    const port = new PagedPort([
      [{ name: 'Альфа', testCasesCount: 1 }],
      [{ name: 'Бета', testCasesCount: 5 }],
    ]);
    const values = await new TestOpsClient(cfg, port).searchFieldValues(1, 10, 'а');
    expect(values).toEqual([
      { name: 'Бета', testCasesCount: 5 },
      { name: 'Альфа', testCasesCount: 1 },
    ]);
    expect(port.urls.filter((u) => u.includes('/api/cfv')).map(pageOf)).toEqual(['0', '1']);
  });
});

describe('список доступных значений приводится целиком', () => {
  it('двадцать пять значений названы все, без «и ещё»', async () => {
    const names = Array.from({ length: 25 }, (_, i) => `Значение ${i + 1}`);
    const client = {
      searchAll: async () => ({ hits: [], total: 0 }),
      fetchCustomFields: async () => [{ id: 10, name: 'Раздел' }],
      fetchFieldValues: async () => names.map((name) => ({ name, testCasesCount: 1 })),
    } as unknown as TestOpsClient;
    const gw = new Gateway(cfg, client, undefined, null, () => {});
    const error = await gw.getTestCasesList([{ rql: 'cf["Раздел"] = "Нет такого"' }]).catch((e: Error) => e);
    expect(String(error)).toContain('Значение 25');
    expect(String(error)).not.toContain('и ещё');
  });
});

const COMMENT_MS = 1_700_000_000_000;
const COMMENT_AT = '2023-11-14T22:13:20.000Z';

const rawCase = (overview: Record<string, unknown>, extra: Record<string, unknown> = {}): RawCase =>
  ({ overview: { id: 7, name: 'Кейс', projectId: 1, ...overview }, steps: null, ...extra }) as unknown as RawCase;

describe('комментарий: дата со временем как пришла', () => {
  const raw = rawCase({}, { comments: [{ id: 1, firstName: 'Анна', body: 'текст', createdDate: COMMENT_MS }] });

  it('в Markdown автор и дата со временем', () => {
    expect(renderCase(normalizeCase(raw, defaultProfile), defaultProfile)).toContain(
      `**Анна · ${COMMENT_AT}**`,
    );
  });

  it('на странице автор и дата со временем', () => {
    const page = renderCaseHtml({ tc: normalizeCase(raw, defaultProfile), state: 'current' }, defaultProfile, new Map());
    expect(page).toContain(`Анна · ${COMMENT_AT}`);
  });

  it('автор без имени выводится пустым, без подстановки', () => {
    const tc = normalizeCase(rawCase({}, { comments: [{ id: 2, body: 'x', createdDate: COMMENT_MS }] }), defaultProfile);
    expect(renderCase(tc, defaultProfile)).toContain(`\n**${COMMENT_AT}**\n\nx`);
  });
});

describe('записи кейса не отбрасываются из-за пустых полей', () => {
  const raw = rawCase(
    {
      customFields: [{ name: '', customField: { id: 5, name: 'Поле' } }],
      issues: [{ summary: 'без ключа и адреса' }],
      members: [{ role: { name: 'Owner' } }],
    },
    { relations: [{ type: 'related', target: { name: 'без номера' } }] },
  );

  it('Markdown: строки без значения нет, задача — по summary, связь без номера — текстом', () => {
    const md = renderCase(normalizeCase(raw, defaultProfile), defaultProfile, [], 'https://x.test');
    expect(md).not.toContain('**Поле:**');
    expect(md).toContain('без ключа и адреса');
    expect(md).toContain('related без номера');
    expect(md).toContain(`- **${defaultProfile.meta.ownerLabel}:**  (Owner)`);
    expect(md).not.toContain('test-cases/)');
  });

  it('HTML: строки без значения нет, задача — по summary, связь без номера — без ссылки', () => {
    const page = renderCaseHtml({ tc: normalizeCase(raw, defaultProfile), state: 'current' }, defaultProfile, new Map(), 'https://x.test');
    expect(page).not.toContain('<dt>Поле</dt>');
    expect(page).toContain('<div class="rel">без ключа и адреса</div>');
    expect(page).toContain('<div class="rel rel_case"><span class="pill">related</span>без номера</div>');
  });
});

describe('сценарий из одних пустых шагов редактора', () => {
  const raw = {
    overview: { id: 3, projectId: 1, name: 'Кейс', hasManualScenario: true },
    steps: {
      root: { children: [1, 2] },
      scenarioSteps: { 1: { body: '' }, 2: { body: '  ' } },
      attachments: {},
      sharedSteps: {},
    },
    comments: [],
  } as unknown as RawCase;

  it('считается пустым: пометка', async () => {
    const tc = await resolveToTestCase(raw, defaultProfile, { baseUrl: '', fetchAttachment: async () => '' });
    expect(auditCase(tc, raw).map((f) => f.message)).toContain('Пустой сценарий');
  });
});

describe('пустое имя кейса выводится пустым', () => {
  it('в сводке пачки нет подстановки', () => {
    const raw = rawCase({ name: undefined });
    const out = renderBatch([raw], defaultProfile, 'https://x.test', [normalizeCase(raw, defaultProfile)], () => null, {});
    expect(out).toContain('- [**7**](https://x.test/project/1/test-cases/7)\n');
    expect(out).not.toContain('No Name');
  });
});

describe('поле-уровень с несколькими значениями', () => {
  it('в уровень пути идут все значения через запятую', () => {
    const raw = rawCase({
      customFields: [
        { name: 'Первый', customField: { id: 1, name: 'Раздел' } },
        { name: 'Второй', customField: { id: 1, name: 'Раздел' } },
      ],
    });
    const tree = { id: 9, name: 'Дерево', fields: [{ id: 1, name: 'Раздел' }] };
    expect(renderCase(normalizeCase(raw, defaultProfile, tree), defaultProfile)).toContain(
      `- **${defaultProfile.meta.pathLabel}:** \`Первый, Второй\``,
    );
  });
});

describe('несколько вложений описания и ожидаемого у шага старого формата', () => {
  const md = (id: number, name: string) => ({ id, name, contentType: 'text/markdown' });
  const deps: ResolveDeps = {
    baseUrl: 'https://x.test',
    fetchAttachment: async (id) => ({ 1: 'описание раз', 2: 'описание два', 3: 'итог раз', 4: 'итог два' })[id] ?? '',
  };

  it('выводятся все, в порядке файлов', async () => {
    const raw = {
      overview: {
        id: 2,
        name: 'Кейс',
        hasManualScenario: false,
        scenario: {
          attachments: [],
          steps: [
            {
              name: 'Шаг',
              attachments: [
                md(1, 'description_1.md'),
                md(2, 'description_2.md'),
                md(3, 'expected_1.md'),
                md(4, 'expected_2.md'),
              ],
            },
          ],
        },
      },
      steps: null,
    } as unknown as RawCase;
    const lines = (await resolveToTestCase(raw, defaultProfile, deps)).scenarioLines.join('\n');
    expect(lines.indexOf('описание раз')).toBeGreaterThan(-1);
    expect(lines.indexOf('описание два')).toBeGreaterThan(lines.indexOf('описание раз'));
    expect(lines.indexOf('итог раз')).toBeGreaterThan(-1);
    expect(lines.indexOf('итог два')).toBeGreaterThan(lines.indexOf('итог раз'));
  });
});
