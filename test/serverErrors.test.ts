import { describe, expect, it } from 'vitest';
import { parseFlags } from '../src/args.js';
import { type AppConfig, resolveProject } from '../src/config.js';
import { ApiError } from '../src/errors.js';
import { Gateway } from '../src/gateway.js';
import type { RawCase, RawOverview } from '../src/model.js';
import { TestOpsClient } from '../src/testops/client.js';
import { apiError } from '../src/testops/http.js';
import type { PortResponse, TestOpsPort } from '../src/testops/port.js';
import { listedIds } from './listedCases.js';

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

const cfgR11: AppConfig = {
  baseUrl: 'https://ts.example',
  token: 'tok',
  defaultProjectId: 1,
  projects: { '1': 'WEB' },
} as unknown as AppConfig;

const cfgR3 = {
  baseUrl: 'https://x.test',
  token: 't',
  projects: { '1': 'WEB', '2': 'проект1' },
  people: {},
  trees: {},
} as unknown as AppConfig;

const cfgR6: AppConfig = {
  baseUrl: 'https://ts.example',
  token: 'tok',
  defaultProjectId: 1,
  projects: { '1': 'WEB' },
} as unknown as AppConfig;

const rawOf = (id: number): RawCase =>
  ({
    overview: { id, projectId: 1, name: `Кейс ${id}`, lastModifiedDate: 1 },
    steps: null,
    comments: [],
  }) as unknown as RawCase;

function clientThatThrows(failing: number, error: Error): TestOpsClient {
  return {
    countCases: async () => 0,
    fetchOverview: async (id: string) => {
      if (Number(id) === failing) throw error;
      return rawOf(Number(id)).overview;
    },
    fetchCaseFromOverview: async (ov: RawOverview) => rawOf(Number(ov.id)),
    fetchCustomFields: async () => [],
    fetchTrees: async () => [],
  } as unknown as TestOpsClient;
}

const cfgR9: AppConfig = {
  baseUrl: 'https://ts.example',
  token: 'tok',
  defaultProjectId: 1,
  projects: { '1': 'WEB' },
} as unknown as AppConfig;

describe('запрос доходит до сервера дословно', () => {
  it('AQL и проект уходят в параметрах без переписывания', async () => {
    const rql = 'cf["Раздел"] = "А" and automation = false';
    const port = new RecordingPort((url) =>
      url.includes('test-case/flat') ? resp(200, { content: [], totalElements: 0 }) : resp(200, {}),
    );
    await new TestOpsClient(cfg, port).searchAll({ rql }, 2, 10);
    const asked = port.urls.find((u) => u.includes('test-case/flat')) ?? '';
    expect(asked).toContain('/api/v2/project/2/test-case/flat');
    const params = new URLSearchParams(asked.slice(asked.indexOf('?') + 1));
    const decoded = JSON.parse(Buffer.from(params.get('search') ?? '', 'base64').toString('utf8'));
    expect(decoded).toEqual([{ id: 'aql', value: rql, type: 'string' }]);
  });
});

describe('доступа к одиночному кейсу нет', () => {
  it('403 обрывает вызов, а не выглядит как отсутствие кейса', async () => {
    const client = {
      countCases: async () => 0,
      fetchOverview: async () => {
        throw new ApiError('нет доступа', 403, 'u', 'auth');
      },
    } as unknown as TestOpsClient;
    const gw = new Gateway(cfgR11, client, undefined, null, () => {});
    await expect(gw.getTestCase('1')).rejects.toThrow(/нет доступа/);
  });
});

describe('ошибки называют причину, а не только код', () => {
  it('нет доступа', () => {
    expect(apiError(401, 'https://x.test/api/y').message).toContain('нет доступа');
  });

  it('объект не найден', () => {
    expect(apiError(404, 'https://x.test/api/y').message).toContain('не найден');
  });

  it('сервер не смог ответить', () => {
    const e = apiError(502, 'https://x.test/api/y');
    expect(e.message).toContain('сервер не смог ответить');
    expect(e.message).toContain('502');
  });
});

describe('неизвестный проект', () => {
  it('в ошибке перечислены известные проекты', () => {
    expect(() => resolveProject(cfgR3, 'Неизвестный')).toThrow(/WEB \(1\)/);
  });
});

describe('неизвестный формат', () => {
  it('отвергается сразу, с перечислением доступных', () => {
    expect(() => parseFlags(['--format', 'xml'])).toThrow(/markdown, html, raw/);
  });

  it('известный формат принимается', () => {
    expect(parseFlags(['--format', 'html']).format).toBe('html');
  });
});

describe('выборка по идентификаторам и ошибки сервера', () => {
  it('ответ 5xx называет кейс и причину, остальные кейсы выгружаются', async () => {
    const warnings: string[] = [];
    const gw = new Gateway(
      cfgR6,
      clientThatThrows(2, new ApiError('сервер не смог ответить', 502, 'u', 'server')),
      undefined,
      null,
      (m) => warnings.push(m),
    );
    const r = await listedIds(gw, [{ rql: 'id in [1, 2, 3]' }]);
    expect(r).toEqual(['1', '3']);
    expect(warnings.join(' ')).toContain('кейс 2');
    expect(warnings.join(' ')).toMatch(/502|сервер/);
  });

  it('сетевая ошибка тоже называет кейс и причину, остальные кейсы выгружаются', async () => {
    const warnings: string[] = [];
    const gw = new Gateway(
      cfgR6,
      clientThatThrows(2, new ApiError('до сервера не достучаться', null, 'u', 'network')),
      undefined,
      null,
      (m) => warnings.push(m),
    );
    const r = await listedIds(gw, [{ rql: 'id in [1, 2]' }]);
    expect(r).toEqual(['1']);
    expect(warnings.join(' ')).toContain('кейс 2');
    expect(warnings.join(' ')).toContain('достучаться');
  });

  it('404 пропускается с предупреждением, остальные кейсы выгружаются', async () => {
    const warnings: string[] = [];
    const gw = new Gateway(
      cfgR6,
      clientThatThrows(2, new ApiError('объект не найден', 404, 'u', 'not_found')),
      undefined,
      null,
      (m) => warnings.push(m),
    );
    const r = await listedIds(gw, [{ rql: 'id in [1, 2, 3]' }]);
    expect(r).toEqual(['1', '3']);
    expect(warnings.join(' ')).toContain('кейс 2');
  });
});

describe('запрошенного кейса нет', () => {
  it('шлюз отдаёт пустоту, а не строку вместо кейса', async () => {
    const gw = new Gateway(
      cfgR6,
      { countCases: async () => 0, fetchOverview: async () => null } as unknown as TestOpsClient,
      undefined,
      null,
      () => {},
    );
    expect(await gw.getTestCase('10001')).toBeNull();
    expect(await gw.getTestCaseHtml('10001')).toBeNull();
  });
});

describe('ответ 401 при выгрузке по идентификаторам', () => {
  it('обрывает вызов, а не превращается в «кейс не найден»', async () => {
    const client = {
      countCases: async () => 0,
      fetchOverview: async () => {
        throw new ApiError('нет доступа', 401, 'u', 'auth');
      },
    } as unknown as TestOpsClient;
    const gw = new Gateway(cfgR9, client, undefined, null, () => {});
    await expect(listedIds(gw, [{ rql: 'id in [1]' }])).rejects.toThrow(/нет доступа/);
  });

  it('ответ 403 пропускается с предупреждением', async () => {
    const warnings: string[] = [];
    const client = {
      countCases: async () => 0,
      fetchOverview: async (id: string) => {
        if (id === '2') throw new ApiError('нет доступа', 403, 'u', 'auth');
        return { id: Number(id), projectId: 1, lastModifiedDate: 1 } as unknown as RawOverview;
      },
      fetchCaseFromOverview: async (ov: RawOverview) =>
        ({ overview: ov, steps: null, comments: [] }) as unknown as RawCase,
      fetchTrees: async () => [],
    } as unknown as TestOpsClient;
    const gw = new Gateway(cfgR9, client, undefined, null, (m) => warnings.push(m));
    const r = await listedIds(gw, [{ rql: 'id in [1, 2]' }]);
    expect(r).toEqual(['1']);
    expect(warnings.join(' ')).toContain('кейс 2');
    expect(warnings.join(' ')).toContain('нет доступа');
  });

  it('ответ 403 в пакетной выгрузке называет кейс и причину, как 5xx', async () => {
    const warnings: string[] = [];
    const reported: Array<string | number> = [];
    const port = new RecordingPort((url) => {
      if (url.includes('/api/testcase/2/overview')) return resp(403, {});
      if (url.includes('/api/testcase/1/overview'))
        return resp(200, { id: 1, projectId: 1, hasManualScenario: false });
      return resp(200, { content: [], totalPages: 1 });
    });
    const client = new TestOpsClient(cfgR9, port, (m) => warnings.push(m));
    const got = await client.fetchBatch([1, 2], (id) => reported.push(id));
    expect(got.map((c) => c.overview.id)).toEqual([1]);
    expect(reported).toEqual([2]);
    expect(warnings.join(' ')).toContain('кейс 2: получить не удалось');
    expect(warnings.join(' ')).toContain('HTTP 403');
  });
});
