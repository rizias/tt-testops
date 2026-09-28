import { describe, expect, it } from 'vitest';
import type { AppConfig } from '../src/config.js';
import { findFieldByName, TestOpsClient } from '../src/testops/client.js';
import type { PortResponse, TestOpsPort } from '../src/testops/port.js';

async function caseDetails(client: TestOpsClient, id: string) {
  const overview = await client.fetchOverview(id);
  return overview ? client.fetchCaseFromOverview(overview) : null;
}

const resp = (status: number, body: unknown): PortResponse => ({
  status,
  ok: status >= 200 && status < 300,
  json: async () => body,
  text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
});

const fakeJwt = `h.${Buffer.from(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 3600 })).toString('base64url')}.s`;

class MockPort implements TestOpsPort {
  calls: string[] = [];
  tokenCalls = 0;
  constructor(private readonly map: Record<string, unknown>) {}
  async postForm(): Promise<PortResponse> {
    this.tokenCalls++;
    return resp(200, { access_token: fakeJwt });
  }
  async get(url: string): Promise<PortResponse> {
    this.calls.push(url);
    for (const [frag, body] of Object.entries(this.map)) {
      if (url.includes(frag)) return resp(body === null ? 404 : 200, body);
    }
    return resp(404, {});
  }
}

const cfg: AppConfig = {
  baseUrl: 'https://x.test',
  token: 'tok',
  defaultProjectId: 1,
  projects: {},
  people: {},
  trees: {},
  profileDir: '/tmp/tt-test-profile',
};

describe('TestOpsClient', () => {
  it('new format: overview + /step', async () => {
    const port = new MockPort({
      '/overview': { id: 1, hasManualScenario: true },
      '/step': { root: { children: [] } },
    });
    const r = await caseDetails(new TestOpsClient(cfg, port), '1');
    expect(r?.overview.id).toBe(1);
    expect(r?.steps).toEqual({ root: { children: [] } });
  });

  it('old format: no /step request', async () => {
    const port = new MockPort({ '/overview': { id: 2, hasManualScenario: false } });
    const r = await caseDetails(new TestOpsClient(cfg, port), '2');
    expect(r?.steps).toBeNull();
    expect(port.calls.some((u) => u.endsWith('/step'))).toBe(false);
  });

  it('404 overview -> null', async () => {
    const port = new MockPort({ '/overview': null });
    expect(await caseDetails(new TestOpsClient(cfg, port), '3')).toBeNull();
  });

  it('JWT is reused across requests', async () => {
    const port = new MockPort({ '/overview': { id: 7, hasManualScenario: false } });
    const c = new TestOpsClient(cfg, port);
    await caseDetails(c, '7');
    await caseDetails(c, '7');
    expect(port.tokenCalls).toBe(1);
  });

  it('batch tolerates 403 and 404 for individual cases', async () => {
    const port = new (class implements TestOpsPort {
      async postForm(): Promise<PortResponse> {
        return resp(200, { access_token: fakeJwt });
      }
      async get(url: string): Promise<PortResponse> {
        return resp(url.includes('/1/overview') ? 403 : 404, {});
      }
    })();
    await expect(new TestOpsClient(cfg, port).fetchBatch([1, 2])).resolves.toEqual([]);
  });

  it('batch warns with the case id and reason and continues on a 5xx case body response', async () => {
    const port = new (class implements TestOpsPort {
      async postForm(): Promise<PortResponse> {
        return resp(200, { access_token: fakeJwt });
      }
      async get(): Promise<PortResponse> {
        return resp(503, {});
      }
    })();
    const warnings: string[] = [];
    const out = await new TestOpsClient(cfg, port, (m) =>
      warnings.push(m),
    ).fetchBatch([1]);
    expect(out).toEqual([]);
    expect(warnings.join(' ')).toContain('кейс 1');
    expect(warnings.join(' ')).toMatch(/503|сервер/);
  });

  it('batch propagates a 401 instead of swallowing it as a warning', async () => {
    const port = new (class implements TestOpsPort {
      async postForm(): Promise<PortResponse> {
        return resp(200, { access_token: fakeJwt });
      }
      async get(): Promise<PortResponse> {
        return resp(401, {});
      }
    })();
    const warnings: string[] = [];
    await expect(
      new TestOpsClient(cfg, port, (m) => warnings.push(m)).fetchBatch([1]),
    ).rejects.toThrow();
    expect(warnings).toEqual([]);
  });
});

const CF_BODY = [
  { id: -1, name: 'Поле0' },
  { id: 10, name: 'Поле1' },
  { id: 11, name: 'Поле2' },
];
const CFV_BODY = {
  content: [
    { name: 'Раздел А', testCasesCount: 81 },
    { name: 'Раздел Б', testCasesCount: 401 },
  ],
};

describe('project field directory', () => {
  it('lists the custom fields of a project', async () => {
    const port = new MockPort({ '/cf?page=': CF_BODY });
    const got = await new TestOpsClient(cfg, port).fetchCustomFields(1);
    expect(got.map((f) => f.name)).toEqual(['Поле0', 'Поле1', 'Поле2']);
    expect(port.calls.some((u) => u.includes('/api/project/1/cf'))).toBe(true);
  });

  it('справочник полей приходит страницами, а не плоским списком', async () => {
    const port = new MockPort({ '/cf?page=': { content: CF_BODY } });
    const got = await new TestOpsClient(cfg, port).fetchCustomFields(1);
    expect(got.map((f) => f.name)).toEqual(['Поле0', 'Поле1', 'Поле2']);
    expect(port.calls.some((u) => u.includes('page=0'))).toBe(true);
  });

  it('lists the values of one field, biggest first', async () => {
    const port = new MockPort({ '/api/cfv': CFV_BODY });
    const got = await new TestOpsClient(cfg, port).fetchFieldValues(1, 10);
    expect(got.map((v) => [v.name, v.testCasesCount])).toEqual([
      ['Раздел Б', 401],
      ['Раздел А', 81],
    ]);
  });
});

describe('findFieldByName', () => {
  const fields = [
    { id: -1, name: 'Поле0' },
    { id: 10, name: 'Поле1' },
  ];

  it('matches case-insensitively', () => {
    expect(findFieldByName(fields, 'поле1').id).toBe(10);
    expect(findFieldByName(fields, '  Поле0 ').id).toBe(-1);
  });

  it('names the available fields when the name is unknown', () => {
    expect(() => findFieldByName(fields, 'Раздел')).toThrowError(/Раздел[\s\S]*Поле0, Поле1/);
  });

  it('says so when the project has no fields at all', () => {
    expect(() => findFieldByName([], 'Поле0')).toThrowError(/ни одного/);
  });
});

class RejectingSearchPort implements TestOpsPort {
  calls: string[] = [];
  async postForm(): Promise<PortResponse> {
    return resp(200, { access_token: fakeJwt });
  }
  async get(url: string): Promise<PortResponse> {
    this.calls.push(url);
    if (url.includes('test-case/flat')) return resp(400, { message: 'invalid.aql' });
    if (url.includes('/cf?page=')) return resp(200, CF_BODY);
    return resp(404, {});
  }
}

describe('rejected query explains the syntax', () => {
  it('names the operators and the real fields of the project', async () => {
    const port = new RejectingSearchPort();
    const err = await new TestOpsClient(cfg, port)
      .searchAll({ rql: 'Поле1 = "Раздел А"' }, 1, 20)
      .catch((e: Error) => e);
    const msg = (err as Error).message;
    expect(msg).toContain('~=');
    expect(msg).toContain('cf[');
    expect(msg).toContain('Поле1');
    expect(msg).not.toMatch(/^HTTP 400/);
  });

  it('shows the corrected form when a bare custom field name was used', async () => {
    const port = new RejectingSearchPort();
    const err = await new TestOpsClient(cfg, port)
      .searchAll({ rql: 'Поле1 = "Раздел А"' }, 1, 20)
      .catch((e: Error) => e);
    expect((err as Error).message).toContain('cf["Поле1"] = "Раздел А"');
  });

  it('costs no extra request when the search succeeds', async () => {
    const port = new MockPort({ 'test-case/flat': { content: [{ id: 5 }] } });
    await new TestOpsClient(cfg, port).searchAll({ rql: 'tag = "x"' }, 1, 20);
    expect(port.calls.filter((u) => u.includes('/api/cf')).length).toBe(0);
    expect(port.calls.length).toBe(1);
  });
});
