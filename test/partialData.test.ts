import { describe, expect, it } from 'vitest';
import type { AppConfig } from '../src/config.js';
import { ApiError } from '../src/errors.js';
import type { RawCase } from '../src/model.js';
import { normalizeCase } from '../src/normalize.js';
import { defaultProfile } from '../src/profile.js';
import { TestOpsClient } from '../src/testops/client.js';
import { explainRejectedQuery } from '../src/testops/diagnosis.js';
import type { PortResponse, TestOpsPort } from '../src/testops/port.js';

async function caseDetails(client: TestOpsClient, id: string) {
  const overview = await client.fetchOverview(id);
  return overview ? client.fetchCaseFromOverview(overview) : null;
}

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

const cfgR9: AppConfig = {
  baseUrl: 'https://ts.example',
  token: 'tok',
  defaultProjectId: 1,
  projects: { '1': 'WEB' },
} as unknown as AppConfig;

describe('шаги ручного кейса ответили ошибкой сервера', () => {
  it('вызов завершается ошибкой, а не кейсом без шагов', async () => {
    const port = new RecordingPort((url) => {
      if (url.includes('/overview'))
        return resp(200, { id: 1, projectId: 1, hasManualScenario: true });
      if (url.includes('/step')) return resp(502, {});
      return resp(200, { content: [] });
    });
    await expect(
      caseDetails(new TestOpsClient(cfg, port), '1'),
    ).rejects.toBeInstanceOf(ApiError);
  });

  it('404 на шагах ошибкой не считается', async () => {
    const port = new RecordingPort((url) => {
      if (url.includes('/overview'))
        return resp(200, { id: 1, projectId: 1, hasManualScenario: true });
      if (url.includes('/step')) return resp(404, {});
      return resp(200, { content: [] });
    });
    const raw = await caseDetails(new TestOpsClient(cfg, port), '1');
    expect(raw?.steps).toBeNull();
  });
});

describe('шаги ручного кейса не пришли', () => {
  it('состояние сценария не объявляется актуальным', () => {
    const tc = normalizeCase(
      {
        overview: { id: 1, projectId: 1, hasManualScenario: true },
        steps: null,
        comments: [],
      } as unknown as RawCase,
      defaultProfile,
    );
    expect(tc.scenarioSource).toBe('empty');
    expect(tc.scenarioLines).toEqual([
      defaultProfile.warnings.emptyScenario,
      '',
      defaultProfile.warnings.stepsFetchError,
    ]);
    expect(tc.scenarioLines.join(' ')).toContain('Нет шагов');
  });
});

describe('связи кейса не получены', () => {
  it('ошибка сервера оставляет кейс без связей и говорит об этом', async () => {
    const { TestOpsClient } = await import('../src/testops/client.js');
    const port = {
      postForm: async () =>
        resp(200, {
          access_token: `h.${Buffer.from(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 3600 })).toString('base64url')}.s`,
        }),
      get: async (url: string) =>
        resp(
          url.includes('/relation') ? 502 : 200,
          url.includes('/overview') ? { id: 1, projectId: 1 } : { content: [] },
        ),
    };
    const warnings: string[] = [];
    const raw = await caseDetails(
      new TestOpsClient(cfgR9, port as never, (m) => warnings.push(m)),
      '1',
    );
    expect(raw?.relations).toBeNull();
    expect(warnings.join(' ')).toContain('связи');
  });
});

describe('справочник полей не удалось получить', () => {
  it('в подсказке сказано об этом, а не молча пусто', async () => {
    const text = await explainRejectedQuery(
      {
        fetchCustomFields: async () => {
          throw new Error('HTTP 502');
        },
      },
      'Поле1 = "Раздел А"',
      1,
    );
    expect(text).toContain('получить не удалось');
    expect(text).toContain('HTTP 502');
  });
});
