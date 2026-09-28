import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { parseFlags } from '../src/args.js';
import { AttachmentStore } from '../src/attachmentStore.js';
import { handleAttachments } from '../src/caseCommand.js';
import type { AppConfig } from '../src/config.js';
import { Gateway } from '../src/gateway.js';
import { TestOpsClient } from '../src/testops/client.js';
import type { PortResponse, TestOpsPort } from '../src/testops/port.js';

const BASE = 'https://x.test';

const cfg: AppConfig = {
  baseUrl: BASE,
  token: 'tok',
  defaultProjectId: 1,
  projects: {},
  people: {},
  trees: {},
  profileDir: '',
};

const fakeJwt = `h.${Buffer.from(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 3600 })).toString('base64url')}.s`;

const json = (status: number, body: unknown): PortResponse => ({
  status,
  ok: status >= 200 && status < 300,
  json: async () => body,
  text: async () => JSON.stringify(body),
});

const PNG = Buffer.from('89504e470d0a1a0a', 'hex');

const picture = (bytes: Buffer, type = 'image/png'): PortResponse => ({
  status: 200,
  ok: true,
  json: async () => ({}),
  text: async () => '',
  arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer,
  headers: { get: (name: string) => (name.toLowerCase() === 'content-type' ? type : null) },
});

const bytesOf = (id: number) => Buffer.concat([PNG, Buffer.from([id])]);
const sharedBytesOf = (id: number) => Buffer.concat([PNG, Buffer.from([0xff, id])]);

type Steps = Record<number, number[]>;

class CasePort implements TestOpsPort {
  urls: string[] = [];
  failing = new Map<number, number>();
  drops = new Map<number, number>();
  types = new Map<number, string>();
  descriptions: Record<number, string> = {};
  constructor(public steps: Steps) {}
  async postForm(): Promise<PortResponse> {
    return json(200, { access_token: fakeJwt });
  }
  async get(url: string): Promise<PortResponse> {
    this.urls.push(url);
    const shared = /\/api\/sharedstep\/attachment\/(\d+)\/content/.exec(url);
    if (shared) return picture(sharedBytesOf(Number(shared[1])));
    const att = /\/api\/testcase\/attachment\/(\d+)\/content/.exec(url);
    if (att) return this.attachment(Number(att[1]));
    const ov = /\/api\/testcase\/(\d+)\/overview/.exec(url);
    if (ov) return json(200, this.overview(Number(ov[1])));
    const st = /\/api\/testcase\/(\d+)\/step/.exec(url);
    if (st) return json(200, this.stepsOf(this.steps[Number(st[1])] ?? []));
    if (url.includes('/api/tree')) return json(200, { content: [] });
    return json(404, {});
  }
  private overview(id: number): unknown {
    return { id, projectId: 1, name: `Кейс ${id}`, hasManualScenario: true, description: this.descriptions[id] };
  }
  private attachment(id: number): PortResponse {
    const drops = this.drops.get(id) ?? 0;
    if (drops > 0) {
      this.drops.set(id, drops - 1);
      throw new Error('связь оборвалась');
    }
    const status = this.failing.get(id);
    return status ? json(status, {}) : picture(bytesOf(id), this.types.get(id));
  }
  private stepsOf(ids: number[]): unknown {
    const scenarioSteps: Record<number, unknown> = {};
    const attachments: Record<number, unknown> = {};
    ids.forEach((att, i) => {
      scenarioSteps[i + 1] = { body: `Шаг ${i + 1}`, attachmentId: att };
      const type = this.types.get(att) ?? 'image/png';
      attachments[att] = { id: att, name: `картинка-${att}.png`, contentType: type };
    });
    return { root: { children: ids.map((_, i) => i + 1) }, scenarioSteps, attachments };
  }
  asked(id: number): number {
    return this.urls.filter((u) => u.includes(`/api/testcase/attachment/${id}/content`)).length;
  }
}

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'tt-case-files-'));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

const gatewayOver = (port: CasePort, warnings: string[] = []) =>
  new Gateway(cfg, new TestOpsClient(cfg, port), undefined, new AttachmentStore(dir), (m) => warnings.push(m));

const caseDir = (id: number) => join(dir, 'attachments', `case-${id}`);
const mdPath = (id: number, name: string) => join(caseDir(id), name).replace(/\\/g, '/');
const attUrl = (id: number) => `${BASE}/api/testcase/attachment/${id}/content`;

describe('вложения лежат файлами в каталоге кейса', () => {
  it('list двух кейсов с картинками на разных шагах: файлы у своих кейсов, ссылки на них', async () => {
    const port = new CasePort({ 1: [11, 12], 2: [21] });
    const md = await gatewayOver(port).getTestCasesList([{ rql: 'id in [1, 2]' }]);

    expect(readdirSync(caseDir(1)).sort()).toEqual(['11.png', '12.png']);
    expect(readdirSync(caseDir(2))).toEqual(['21.png']);
    expect(readFileSync(join(caseDir(2), '21.png')).equals(Buffer.concat([PNG, Buffer.from([21])]))).toBe(true);
    expect(md).toContain(`![картинка-11.png](${mdPath(1, '11.png')} "${attUrl(11)}")`);
    expect(md).toContain(`![картинка-12.png](${mdPath(1, '12.png')} "${attUrl(12)}")`);
    expect(md).toContain(`![картинка-21.png](${mdPath(2, '21.png')} "${attUrl(21)}")`);
  });

  it('5xx три раза подряд после первой попытки: повторы, предупреждение, ссылка на адрес TestOps', async () => {
    const port = new CasePort({ 1: [11] });
    port.failing.set(11, 503);
    const warnings: string[] = [];
    const md = await gatewayOver(port, warnings).getTestCase('1');

    expect(port.asked(11)).toBe(4);
    expect(warnings).toContain('кейс 1: вложение 11 не скачалось — сервер ответил 503');
    expect(md).toContain(`![картинка-11.png](${attUrl(11)})`);
    expect(existsSync(join(caseDir(1), '11.png'))).toBe(false);
  });

  it('404 не повторяется', async () => {
    const port = new CasePort({ 1: [11] });
    port.failing.set(11, 404);
    await gatewayOver(port).getTestCase('1');
    expect(port.asked(11)).toBe(1);
  });

  it('кейс сменил картинку: старый файл удалён, новый лежит', async () => {
    const port = new CasePort({ 1: [11] });
    await gatewayOver(port).getTestCase('1');
    expect(readdirSync(caseDir(1))).toEqual(['11.png']);

    port.steps = { 1: [12] };
    await gatewayOver(port).getTestCase('1');
    expect(readdirSync(caseDir(1))).toEqual(['12.png']);
  });

  it('уже лежащий файл не перекачивается', async () => {
    const port = new CasePort({ 1: [11] });
    mkdirSync(caseDir(1), { recursive: true });
    writeFileSync(join(caseDir(1), '11.png'), PNG);

    const md = await gatewayOver(port).getTestCase('1');

    expect(port.asked(11)).toBe(0);
    expect(md).toContain(`![картинка-11.png](${mdPath(1, '11.png')} "${attUrl(11)}")`);
  });

  it('HTML встраивает байты из файла каталога кейса', async () => {
    const port = new CasePort({ 1: [11] });
    const stored = Buffer.from('сохранённые байты');
    mkdirSync(caseDir(1), { recursive: true });
    writeFileSync(join(caseDir(1), '11.png'), stored);

    const html = await gatewayOver(port).getTestCaseHtml('1');

    expect(html).toContain(`data:image/png;base64,${stored.toString('base64')}`);
    expect(port.asked(11)).toBe(0);
  });
});

describe('снимок Markdown с вложением', () => {
  it('совпадает побайтно после замены корня хранилища', async () => {
    const md = await gatewayOver(new CasePort({ 1: [11] })).getTestCase('1');
    const stable = (md ?? '').split(join(dir, 'attachments').replace(/\\/g, '/')).join('<хранилище>');
    expect(stable).toBe(
      [
        '# **Кейс 1** (ID: 1)',
        `- **Адрес в TestOps:** <${BASE}/project/1/test-cases/1>`,
        '- **Проект:** `1`',
        '- **Статус:** `  `',
        '- **Тип:** `Ручной`',
        '',
        '### Сценарий',
        `1. Шаг 1`,
        `   ![картинка-11.png](<хранилище>/case-1/11.png "${attUrl(11)}")`,
        '',
      ].join('\n'),
    );
  });
});

describe('обычное и общее вложение с одним номером', () => {
  it('два файла с разными байтами, каждая ссылка ведёт на свой', async () => {
    const port = new CasePort({});
    port.descriptions[1] = [
      '![обычное](/api/testcase/attachment/11/content)',
      '![общее](/api/sharedstep/attachment/11/content)',
    ].join('\n');
    const md = await gatewayOver(port).getTestCase('1');

    expect(readdirSync(caseDir(1)).sort()).toEqual(['11.png', 'shared-11.png']);
    expect(readFileSync(join(caseDir(1), '11.png')).equals(bytesOf(11))).toBe(true);
    expect(readFileSync(join(caseDir(1), 'shared-11.png')).equals(sharedBytesOf(11))).toBe(true);
    expect(md).toContain(`![обычное](${mdPath(1, '11.png')} "${attUrl(11)}")`);
    expect(md).toContain(`![общее](${mdPath(1, 'shared-11.png')} "${BASE}/api/sharedstep/attachment/11/content")`);
  });
});

describe('скачивание и ссылки', () => {
  it('связь оборвалась два раза, третья попытка удалась: файл лежит, предупреждения нет', async () => {
    const port = new CasePort({ 1: [11] });
    port.drops.set(11, 2);
    const warnings: string[] = [];
    await gatewayOver(port, warnings).getTestCase('1');

    expect(port.asked(11)).toBe(3);
    expect(readFileSync(join(caseDir(1), '11.png')).equals(bytesOf(11))).toBe(true);
    expect(warnings).toEqual([]);
  });

  it('вложение не картинка: обычная ссылка на файл с адресом заголовком', async () => {
    const port = new CasePort({ 1: [11] });
    port.types.set(11, 'application/pdf');
    const md = await gatewayOver(port).getTestCase('1');

    expect(md).toContain(`[картинка-11.png](${mdPath(1, '11.pdf')} "${attUrl(11)}")`);
    expect(md).not.toContain('![картинка-11.png]');
  });

  it('пробел в пути хранилища: путь в угловых скобках', async () => {
    const spaced = join(dir, 'с пробелом');
    const gw = new Gateway(cfg, new TestOpsClient(cfg, new CasePort({ 1: [11] })), undefined, new AttachmentStore(spaced), () => undefined);
    const md = await gw.getTestCase('1');
    const path = join(spaced, 'attachments', 'case-1', '11.png').replace(/\\/g, '/');

    expect(md).toContain(`![картинка-11.png](<${path}> "${attUrl(11)}")`);
  });

  it('attachments <id> --out <каталог>: файлы скопированы, пути напечатаны', async () => {
    const out = join(dir, 'выгрузка');
    const printed: string[] = [];
    const write = vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
      printed.push(String(chunk));
      return true;
    });
    try {
      const code = await handleAttachments(gatewayOver(new CasePort({ 1: [11, 12] })), parseFlags(['1', '--out', out]), Date.now());
      expect(code).toBe(0);
    } finally {
      write.mockRestore();
    }

    expect(readdirSync(out).sort()).toEqual(['11.png', '12.png']);
    expect(readFileSync(join(out, '12.png')).equals(bytesOf(12))).toBe(true);
    expect(printed.join('')).toBe(`${join(out, '11.png')}\n${join(out, '12.png')}\n`);
  });

  it('list --format html встраивает байты из файлов каталогов кейсов', async () => {
    const port = new CasePort({ 1: [11], 2: [21] });
    const stored = (id: number) => Buffer.from(`сохранено-${id}`);
    for (const [c, a] of [[1, 11], [2, 21]] as const) {
      mkdirSync(caseDir(c), { recursive: true });
      writeFileSync(join(caseDir(c), `${a}.png`), stored(a));
    }

    const html = await gatewayOver(port).getTestCasesHtml([{ rql: 'id in [1, 2]' }]);

    expect(html).toContain(`data:image/png;base64,${stored(11).toString('base64')}`);
    expect(html).toContain(`data:image/png;base64,${stored(21).toString('base64')}`);
    expect(port.asked(11) + port.asked(21)).toBe(0);
  });

  it('пересборка кейса не трогает файлы чужого кейса', async () => {
    const port = new CasePort({ 1: [11], 2: [21] });
    await gatewayOver(port).getTestCasesList([{ rql: 'id in [1, 2]' }]);

    port.steps = { 1: [12], 2: [21] };
    await gatewayOver(port).getTestCase('1');

    expect(readdirSync(caseDir(1))).toEqual(['12.png']);
    expect(readdirSync(caseDir(2))).toEqual(['21.png']);
  });
});
