import { describe, expect, it } from 'vitest';
import type { AppConfig } from '../src/config.js';
import { Gateway } from '../src/gateway.js';
import type { RawCase, RawOverview } from '../src/model.js';
import { lostReport } from '../src/report.js';
import type { AttachmentResult, TestOpsClient } from '../src/testops/client.js';

const cfg: AppConfig = {
  baseUrl: 'https://x.test',
  token: 'tok',
  defaultProjectId: 14,
  projects: { '14': 'WEB' },
  people: {},
  trees: {},
  timeoutMs: 30000,
  maxCases: 100,
  concurrency: 8,
  retries: 3,
  pageSize: 20,
  sort: 'id,DESC',
  cacheDir: '/tmp/tt-test-cache',
};

const picture = (id: number) => `![вид](/api/testcase/attachment/${id}/content)`;

const WORLD: Record<number, number[]> = {
  101: [55],
  102: [61, 62],
  103: [71],
  104: [72],
  105: [73],
  106: [81],
};

const overviewOf = (id: number): RawOverview =>
  ({
    id,
    projectId: 14,
    name: `Кейс ${id}`,
    description: (WORLD[id] ?? []).map(picture).join('\n'),
    lastModifiedDate: 1000 + id,
  }) as RawOverview;

const rawOf = (id: number): RawCase =>
  ({ overview: overviewOf(id), steps: null, comments: [] }) as unknown as RawCase;

const fakeClient = (lost: Map<number, string>): TestOpsClient =>
  ({
    searchAll: async (_rql: string, _projectId: number, size: number) => {
      const all = Object.keys(WORLD).map(Number);
      return {
        hits: all.slice(0, size).map((id) => ({ id, lastModifiedDate: 1 })),
        total: all.length,
      };
    },
    fetchBatch: async (ids: number[]) => ids.map(rawOf),
    fetchCaseDetails: async (id: string) =>
      WORLD[Number(id)] === undefined ? null : rawOf(Number(id)),
    fetchOverview: async (id: string) =>
      WORLD[Number(id)] === undefined ? null : overviewOf(Number(id)),
    fetchCaseFromOverview: async (ov: RawOverview) => rawOf(Number(ov.id)),
    fetchCustomFields: async () => [],
    fetchTrees: async () => [],
    fetchAttachmentContent: async () => '',
    fetchRelations: async () => [],
    fetchAttachment: async (id: number): Promise<AttachmentResult> => {
      const reason = lost.get(id);
      if (reason) return { ok: false, reason, retriable: false };
      return { ok: true, bytes: Buffer.from([1, 2, 3]), contentType: 'image/png' };
    },
  }) as unknown as TestOpsClient;

const collect = (lost: Map<number, string>) => {
  const warnings: string[] = [];
  const gw = new Gateway(cfg, fakeClient(lost), undefined, null, false, (m) => warnings.push(m));
  return { gw, warnings };
};

describe('вложение не скачалось — выгрузка идёт дальше', () => {
  it('называет кейс, вложение и причину', async () => {
    const { gw, warnings } = collect(new Map([[55, 'сервер ответил 404']]));

    const html = await gw.getTestCaseHtml('101');

    expect(html).toContain('data-missing-attachment="55"');
    expect(warnings).toContain('кейс 101: вложение 55 не скачалось — сервер ответил 404');
  });

  it('остальные картинки на месте, работа не прервана', async () => {
    const { gw, warnings } = collect(new Map([[61, 'связь оборвалась']]));

    const html = await gw.getTestCaseHtml('102');

    expect(html).toContain('src="data:image/png;base64,');
    expect(html).toContain('data-missing-attachment="61"');
    expect(warnings).toHaveLength(1);
  });

  it('когда потерь несколько, в конце названо их число', async () => {
    const lost = new Map([
      [71, 'сервер ответил 404'],
      [72, 'связь оборвалась'],
      [73, 'сервер ответил 500'],
    ]);
    const { gw, warnings } = collect(lost);

    await gw.getTestCasesHtml([{ project: '14', rql: 'automation = false' }], 100);

    expect(warnings.filter((w) => w.includes('не скачалось —'))).toHaveLength(3);
    expect(gw.lostAttachments()).toBe(3);
    expect(lostReport(gw.lostAttachments())).toBe('не скачалось вложений: 3');
  });

  it('одна потеря итогом не сопровождается', async () => {
    const { gw, warnings } = collect(new Map([[81, 'сервер ответил 404']]));

    await gw.getTestCaseHtml('106');

    expect(warnings.some((w) => w.startsWith('не скачалось вложений'))).toBe(false);
  });
});
