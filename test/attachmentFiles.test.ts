import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { extensionFor } from '../src/attachmentFiles.js';
import { AttachmentStore } from '../src/attachmentStore.js';
import type { AppConfig } from '../src/config.js';
import { Gateway } from '../src/gateway.js';
import type { RawCase, RawOverview } from '../src/model.js';
import type { TestOpsClient } from '../src/testops/client.js';

const cfg: AppConfig = {
  baseUrl: 'https://testops.example',
  token: 'tok',
  defaultProjectId: 1,
  projects: {},
  people: {},
  trees: {},
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
});

describe('кейс отдаётся вместе с вложениями', () => {
  const overview = {
    id: 10001,
    projectId: 1,
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
      new AttachmentStore(join(dir, 'profile')),
      () => {},
    );
    const saved = await gw.saveAttachments('10001', join(dir, 'выгрузка'));

    expect(saved).toEqual([{ key: 555, path: join(dir, 'выгрузка', '555.png') }]);
    expect(readFileSync(join(dir, 'выгрузка', '555.png')).equals(PIXEL)).toBe(true);
  });

  it('без каталога файлы ложатся в хранилище профиля, рядом с кейсом', async () => {
    const store = new AttachmentStore(join(dir, 'profile'));
    const gw = new Gateway(cfg, client, undefined, store, () => {});
    const saved = await gw.saveAttachments('10001');

    expect(saved).toEqual([{ key: 555, path: join(dir, 'profile', 'attachments', 'case-10001', '555.png') }]);
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
      new AttachmentStore(join(dir, 'profile')),
      () => {},
    );

    expect(await gw.saveAttachments('404', join(dir, 'пусто'))).toBeNull();
    expect(readdirSync(dir)).not.toContain('пусто');
  });
});
