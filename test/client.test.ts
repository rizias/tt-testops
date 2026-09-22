import { describe, expect, it } from 'vitest';
import type { AppConfig } from '../src/config.js';
import { findFieldByName, TestOpsClient } from '../src/testops/client.js';
import type { PortResponse, TestOpsPort } from '../src/testops/port.js';

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
  defaultProjectId: 14,
  projects: {},
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

describe('TestOpsClient', () => {
  it('new format: overview + /step', async () => {
    const port = new MockPort({
      '/overview': { id: 1, hasManualScenario: true },
      '/step': { root: { children: [] } },
    });
    const r = await new TestOpsClient(cfg, port).fetchCaseDetails('1');
    expect(r?.overview.id).toBe(1);
    expect(r?.steps).toEqual({ root: { children: [] } });
  });

  it('old format: no /step request', async () => {
    const port = new MockPort({ '/overview': { id: 2, hasManualScenario: false } });
    const r = await new TestOpsClient(cfg, port).fetchCaseDetails('2');
    expect(r?.steps).toBeNull();
    expect(port.calls.some((u) => u.endsWith('/step'))).toBe(false);
  });

  it('404 overview -> null', async () => {
    const port = new MockPort({ '/overview': null });
    expect(await new TestOpsClient(cfg, port).fetchCaseDetails('3')).toBeNull();
  });

  it('search -> ids with their modification dates', async () => {
    const port = new MockPort({
      __search: {
        content: [
          { id: 5, lastModifiedDate: 111 },
          { id: 6, lastModifiedDate: 222 },
        ],
      },
    });
    expect(await new TestOpsClient(cfg, port).search('tag = "x"', 14, 20)).toEqual([
      { id: 5, lastModifiedDate: 111 },
      { id: 6, lastModifiedDate: 222 },
    ]);
  });

  it('treats a missing date as zero rather than dropping the case', async () => {
    const port = new MockPort({ __search: { content: [{ id: 7 }] } });
    expect(await new TestOpsClient(cfg, port).search('tag = "x"', 14, 20)).toEqual([
      { id: 7, lastModifiedDate: 0 },
    ]);
  });

  it('JWT is cached across requests', async () => {
    const port = new MockPort({ '/overview': { id: 7, hasManualScenario: false } });
    const c = new TestOpsClient(cfg, port);
    await c.fetchCaseDetails('7');
    await c.fetchCaseDetails('7');
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

  it('batch fails the whole call on a 5xx case body response', async () => {
    const port = new (class implements TestOpsPort {
      async postForm(): Promise<PortResponse> {
        return resp(200, { access_token: fakeJwt });
      }
      async get(): Promise<PortResponse> {
        return resp(503, {});
      }
    })();
    await expect(new TestOpsClient({ ...cfg, retries: 0 }, port).fetchBatch([1])).rejects.toThrow(
      /HTTP 503/,
    );
  });

  it('batch fails the whole call on a network error', async () => {
    const port = new (class implements TestOpsPort {
      async postForm(): Promise<PortResponse> {
        return resp(200, { access_token: fakeJwt });
      }
      async get(): Promise<PortResponse> {
        throw new Error('network down');
      }
    })();
    await expect(new TestOpsClient({ ...cfg, retries: 0 }, port).fetchBatch([1])).rejects.toThrow(
      /network down/,
    );
  });
});

const CF_BODY = [
  { id: -1, name: 'Epic' },
  { id: 10, name: 'Section1' },
  { id: 11, name: 'Section2' },
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
    const got = await new TestOpsClient(cfg, port).fetchCustomFields(14);
    expect(got.map((f) => f.name)).toEqual(['Epic', 'Section1', 'Section2']);
    expect(port.calls.some((u) => u.includes('/api/project/14/cf'))).toBe(true);
  });

  it('справочник полей приходит страницами, а не плоским списком', async () => {
    const port = new MockPort({ '/cf?page=': { content: CF_BODY } });
    const got = await new TestOpsClient(cfg, port).fetchCustomFields(14);
    expect(got.map((f) => f.name)).toEqual(['Epic', 'Section1', 'Section2']);
    expect(port.calls.some((u) => u.includes('page=0'))).toBe(true);
  });

  it('lists the values of one field, biggest first', async () => {
    const port = new MockPort({ '/api/cfv': CFV_BODY });
    const got = await new TestOpsClient(cfg, port).fetchFieldValues(14, 10);
    expect(got.map((v) => [v.name, v.testCasesCount])).toEqual([
      ['Раздел Б', 401],
      ['Раздел А', 81],
    ]);
  });
});

describe('findFieldByName', () => {
  const fields = [
    { id: -1, name: 'Epic' },
    { id: 10, name: 'Section1' },
  ];

  it('matches case-insensitively', () => {
    expect(findFieldByName(fields, 'section1').id).toBe(10);
    expect(findFieldByName(fields, '  Epic ').id).toBe(-1);
  });

  it('names the available fields when the name is unknown', () => {
    expect(() => findFieldByName(fields, 'Раздел')).toThrowError(/Раздел[\s\S]*Epic, Section1/);
  });

  it('says so when the project has no fields at all', () => {
    expect(() => findFieldByName([], 'Epic')).toThrowError(/ни одного/);
  });
});

class RejectingSearchPort implements TestOpsPort {
  calls: string[] = [];
  async postForm(): Promise<PortResponse> {
    return resp(200, { access_token: fakeJwt });
  }
  async get(url: string): Promise<PortResponse> {
    this.calls.push(url);
    if (url.includes('__search')) return resp(400, { message: 'invalid.aql' });
    if (url.includes('/cf?page=')) return resp(200, CF_BODY);
    return resp(404, {});
  }
}

describe('rejected query explains the syntax', () => {
  it('names the operators and the real fields of the project', async () => {
    const port = new RejectingSearchPort();
    const err = await new TestOpsClient(cfg, port)
      .search('Section1 = "Раздел А"', 14, 20)
      .catch((e: Error) => e);
    const msg = (err as Error).message;
    expect(msg).toContain('~=');
    expect(msg).toContain('cf[');
    expect(msg).toContain('Section1');
    expect(msg).not.toMatch(/^HTTP 400/);
  });

  it('shows the corrected form when a bare custom field name was used', async () => {
    const port = new RejectingSearchPort();
    const err = await new TestOpsClient(cfg, port)
      .search('Section1 = "Раздел А"', 14, 20)
      .catch((e: Error) => e);
    expect((err as Error).message).toContain('cf["Section1"] = "Раздел А"');
  });

  it('costs no extra request when the search succeeds', async () => {
    const port = new MockPort({ __search: { content: [{ id: 5 }] } });
    await new TestOpsClient(cfg, port).search('tag = "x"', 14, 20);
    expect(port.calls.filter((u) => u.includes('/api/cf')).length).toBe(0);
    expect(port.calls.length).toBe(1);
  });
});
