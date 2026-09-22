import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { extensionFor, saveEmbedded } from '../src/attachmentFiles.js';
import { CaseCache } from '../src/cache.js';
import type { AppConfig } from '../src/config.js';
import { Gateway } from '../src/gateway.js';
import type { RawCase, RawOverview } from '../src/model.js';
import type { TestOpsClient } from '../src/testops/client.js';

const cfg: AppConfig = {
  baseUrl: 'https://testops.example',
  token: 'tok',
  defaultProjectId: 14,
  projects: {},
  people: {},
  trees: {},
  timeoutMs: 30000,
  maxCases: 100,
  pageSize: 20,
  sort: 'id,DESC',
} as unknown as AppConfig;

const PIXEL = Buffer.from('89504e470d0a1a0a', 'hex');

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'tt-att-files-'));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('имя файла говорит, чем его открыть', () => {
  it('тип содержимого превращается в расширение', () => {
    expect(extensionFor('image/png')).toBe('.png');
    expect(extensionFor('image/jpeg; charset=binary')).toBe('.jpg');
    expect(extensionFor('text/markdown')).toBe('.md');
    expect(extensionFor('application/octet-stream')).toBe('.bin');
  });

  it('встроенные вложения ложатся файлами по номеру', () => {
    const assets = new Map([
      [7, `data:image/png;base64,${PIXEL.toString('base64')}`],
      [9, 'data:text/markdown;base64,0YLQtdC60YHRgg=='],
    ]);
    const saved = saveEmbedded(assets, dir);

    expect(saved.map((s) => s.id)).toEqual([7, 9]);
    expect(readdirSync(dir).sort()).toEqual(['7.png', '9.md']);
    expect(readFileSync(join(dir, '7.png')).equals(PIXEL)).toBe(true);
    expect(readFileSync(join(dir, '9.md'), 'utf8')).toBe('текст');
  });

  it('пустой список каталога не создаёт', () => {
    const empty = join(dir, 'нет-вложений');
    expect(saveEmbedded(new Map(), empty)).toEqual([]);
    expect(readdirSync(dir)).toEqual([]);
  });
});

describe('кейс отдаётся вместе с вложениями', () => {
  const overview = {
    id: 10001,
    projectId: 14,
    name: 'Кейс с картинкой',
    lastModifiedDate: 1,
    hasManualScenario: false,
    scenario: { steps: [{ name: 'Шаг' }] },
    expectedResult: '![вид](/api/testcase/attachment/555/content)',
  } as unknown as RawOverview;

  const client = {
    fetchOverview: async () => overview,
    fetchCaseFromOverview: async (ov: RawOverview) =>
      ({ overview: ov, steps: null, comments: [] }) as unknown as RawCase,
    fetchTrees: async () => [],
    fetchAttachment: async () => ({ ok: true, bytes: PIXEL, contentType: 'image/png' }),
    fetchAttachmentContent: async () => '',
  } as unknown as TestOpsClient;

  it('файлы кладутся в указанный каталог, пути возвращаются', async () => {
    const gw = new Gateway(
      cfg,
      client,
      undefined,
      new CaseCache(join(dir, 'cache')),
      false,
      () => {},
    );
    const saved = await gw.saveAttachments('10001', join(dir, 'выгрузка'));

    expect(saved).toEqual([{ id: 555, path: join(dir, 'выгрузка', '555.png') }]);
    expect(readFileSync(join(dir, 'выгрузка', '555.png')).equals(PIXEL)).toBe(true);
  });

  it('без каталога файлы ложатся в хранилище профиля, рядом с кейсом', async () => {
    const cache = new CaseCache(join(dir, 'cache'));
    const gw = new Gateway(cfg, client, undefined, cache, false, () => {});
    const saved = await gw.saveAttachments('10001');

    expect(saved?.[0]?.path).toBe(join(cache.filesRoot(), 'case-10001', '555.png'));
  });

  it('кейса нет — ответа нет, каталог не создан', async () => {
    const missing = {
      fetchOverview: async () => null,
      fetchTrees: async () => [],
    } as unknown as TestOpsClient;
    const gw = new Gateway(
      cfg,
      missing,
      undefined,
      new CaseCache(join(dir, 'cache')),
      false,
      () => {},
    );

    expect(await gw.saveAttachments('404', join(dir, 'пусто'))).toBeNull();
    expect(readdirSync(dir)).not.toContain('пусто');
  });
});
