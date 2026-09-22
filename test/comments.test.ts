import { describe, expect, it } from 'vitest';
import type { AppConfig } from '../src/config.js';
import type { RawComment } from '../src/model.js';
import { normalizeComments } from '../src/normalize.js';
import { TestOpsClient } from '../src/testops/client.js';
import type { PortResponse, TestOpsPort } from '../src/testops/port.js';

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
  defaultProjectId: 14,
  projects: {},
  people: {},
  trees: {},
  timeoutMs: 30000,
  maxCases: 100,
  pageSize: 20,
  sort: 'id,DESC',
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

describe('комментарии кейса', () => {
  it('идут от старых к новым', () => {
    const raw = [
      { id: 2, createdDate: 200, body: 'второй', createdBy: 'кто-то' },
      { id: 1, createdDate: 100, body: 'первый', createdBy: 'кто-то' },
    ] as unknown as RawComment[];
    expect(normalizeComments(raw).map((c) => c.body)).toEqual(['первый', 'второй']);
  });

  it('ошибка сервера оставляет кейс без комментариев и говорит об этом', async () => {
    const port = new RecordingPort((url) => {
      if (url.includes('/comment')) return resp(500, {});
      if (url.includes('/overview')) return resp(200, { id: 1, projectId: 14 });
      return resp(200, { content: [] });
    });
    const warnings: string[] = [];
    const raw = await new TestOpsClient({ ...cfg, retries: 0 }, port, undefined, (m) =>
      warnings.push(m),
    ).fetchCaseDetails('1');
    expect(raw?.comments).toBeNull();
    expect(warnings.join(' ')).toContain('комментарии');
  });

  it('404 означает, что комментариев нет', async () => {
    const port = new RecordingPort((url) => {
      if (url.includes('/comment')) return resp(404, {});
      if (url.includes('/overview')) return resp(200, { id: 1, projectId: 14 });
      return resp(200, { content: [] });
    });
    const raw = await new TestOpsClient(cfg, port).fetchCaseDetails('1');
    expect(raw?.comments).toBeNull();
  });
});

describe('тело комментария', () => {
  it('приводится к переводам строк LF', () => {
    const raw = [
      { id: 1, createdDate: 1, body: 'первая\r\nвторая\rтретья', createdBy: 'кто-то' },
    ] as unknown as RawComment[];
    expect(normalizeComments(raw)[0]?.body).toBe('первая\nвторая\nтретья');
  });
});
