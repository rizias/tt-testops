import { describe, expect, it } from 'vitest';
import type { AppConfig } from '../src/config.js';
import { TestOpsClient } from '../src/testops/client.js';
import type { PortResponse, TestOpsPort } from '../src/testops/port.js';

const resp = (status: number, body: unknown): PortResponse => ({
  status,
  ok: status >= 200 && status < 300,
  json: async () => body,
  text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
});

const cfg: AppConfig = {
  baseUrl: 'https://x.test',
  token: 'tok',
  projects: {},
  people: {},
  trees: {},
  profileDir: '/tmp/tt-test-profile',
};

class RecordingPort implements TestOpsPort {
  urls: string[] = [];
  async postForm(): Promise<PortResponse> {
    return resp(200, { access_token: fakeJwt() });
  }
  async get(url: string): Promise<PortResponse> {
    this.urls.push(url);
    return resp(200, { content: [], totalElements: 0 });
  }
}

function fakeJwt(): string {
  return `h.${Buffer.from(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 3600 })).toString('base64url')}.s`;
}

function decodedSearch(url: string): unknown {
  const params = new URLSearchParams(url.slice(url.indexOf('?') + 1));
  const raw = params.get('search');
  return raw ? JSON.parse(Buffer.from(raw, 'base64').toString('utf8')) : null;
}

describe('запрос поиска: адрес и параметры', () => {
  it('идёт на /api/v2/project/{проект}/test-case/flat', async () => {
    const port = new RecordingPort();
    await new TestOpsClient(cfg, port).searchAll({ rql: 'tag = "Smoke"' }, 1, 10);
    const asked = port.urls[0] ?? '';
    expect(asked.startsWith('https://x.test/api/v2/project/1/test-case/flat?')).toBe(true);
  });

  it('несёт deleted=false, page и сортировку по имени по возрастанию', async () => {
    const port = new RecordingPort();
    await new TestOpsClient(cfg, port).searchAll({ rql: 'tag = "Smoke"' }, 1, 20);
    const params = new URLSearchParams((port.urls[0] ?? '').split('?')[1]);
    expect(params.get('deleted')).toBe('false');
    expect(params.get('page')).toBe('0');
    expect(params.get('sort')).toBe('name,asc');
  });

  it('плоский AQL уходит единственным условием aql', async () => {
    const port = new RecordingPort();
    await new TestOpsClient(cfg, port).searchAll({ rql: 'tag = "Smoke"' }, 1, 20);
    expect(decodedSearch(port.urls[0] ?? '')).toEqual([
      { id: 'aql', value: 'tag = "Smoke"', type: 'string' },
    ]);
  });

  it('условия ссылки без aql передаются как есть и в исходном порядке', async () => {
    const port = new RecordingPort();
    const conditions = [
      { id: 'tag', value: ['Smoke'], type: 'array' },
      { id: 'cfv.1', value: 'Раздел А', type: 'string' },
      { id: 'content', value: 'фраза', type: 'string' },
    ];
    await new TestOpsClient(cfg, port).searchAll({ rql: '', conditions }, 1, 20);
    expect(decodedSearch(port.urls[0] ?? '')).toEqual(conditions);
  });

  it('aql, условия ссылки и content идут в этом порядке', async () => {
    const port = new RecordingPort();
    const conditions = [{ id: 'tag', value: ['Smoke'], type: 'array' }];
    await new TestOpsClient(cfg, port).searchAll(
      { rql: 'automation = false', conditions, text: 'фраза' },
      1,
      20,
    );
    expect(decodedSearch(port.urls[0] ?? '')).toEqual([
      { id: 'aql', value: 'automation = false', type: 'string' },
      { id: 'tag', value: ['Smoke'], type: 'array' },
      { id: 'content', value: 'фраза', type: 'string' },
    ]);
  });

  it('одна фраза без запроса — единственное условие content', async () => {
    const port = new RecordingPort();
    await new TestOpsClient(cfg, port).searchAll({ rql: '', text: 'фраза' }, 1, 20);
    expect(decodedSearch(port.urls[0] ?? '')).toEqual([
      { id: 'content', value: 'фраза', type: 'string' },
    ]);
  });

  it('filterId уходит отдельным параметром вместе с условиями', async () => {
    const port = new RecordingPort();
    await new TestOpsClient(cfg, port).searchAll({ rql: '', filterId: 7 }, 1, 20);
    const params = new URLSearchParams((port.urls[0] ?? '').split('?')[1]);
    expect(params.get('filterId')).toBe('7');
    expect(params.has('search')).toBe(false);
  });

  it('пустой список условий — параметр search не передаётся', async () => {
    const port = new RecordingPort();
    await new TestOpsClient(cfg, port).searchAll({ rql: '' }, 1, 20);
    const params = new URLSearchParams((port.urls[0] ?? '').split('?')[1]);
    expect(params.has('search')).toBe(false);
  });
});

describe('постраничный обход', () => {
  it('две страницы сервера — запросы page=0 и page=1, в ответе оба кейса', async () => {
    const pages: string[] = [];
    const port = new (class implements TestOpsPort {
      async postForm(): Promise<PortResponse> {
        return resp(200, { access_token: fakeJwt() });
      }
      async get(url: string): Promise<PortResponse> {
        const params = new URLSearchParams(url.slice(url.indexOf('?') + 1));
        const page = params.get('page') ?? '';
        pages.push(page);
        return resp(200, { content: [{ id: page === '0' ? 1 : 2 }], totalElements: 2, totalPages: 2 });
      }
    })();
    const got = await new TestOpsClient(cfg, port).searchAll({ rql: 'tag = "a"' }, 1, 10);
    expect(pages).toEqual(['0', '1']);
    expect(got.hits).toEqual([{ id: 1 }, { id: 2 }]);
  });
});

describe('отвергнутый запрос', () => {
  it('400 без AQL называет условия и не говорит про синтаксис AQL', async () => {
    const port = new (class implements TestOpsPort {
      async postForm(): Promise<PortResponse> {
        return resp(200, { access_token: fakeJwt() });
      }
      async get(url: string): Promise<PortResponse> {
        if (url.includes('test-case/flat')) return resp(400, { message: 'invalid.filter' });
        if (url.includes('/cf?page=')) return resp(200, []);
        return resp(404, {});
      }
    })();
    const err = await new TestOpsClient(cfg, port)
      .searchAll({ rql: '', filterId: 7 }, 1, 20)
      .catch((e: Error) => e);
    expect((err as Error).message).toBe('TestOps отверг условия поиска.\nСохранённый фильтр: 7.');
  });
});

describe('порядок и длина запроса', () => {
  it('без сортировки в ссылке — по названию по возрастанию', async () => {
    const port = new RecordingPort();
    await new TestOpsClient(cfg, port).searchAll({ rql: 'tag = "a"' }, 1, 20);
    const params = new URLSearchParams((port.urls[0] ?? '').split('?')[1]);
    expect(params.getAll('sort')).toEqual(['name,asc']);
  });

  it('сортировка из ссылки: по номеру по убыванию, затем по названию', async () => {
    const port = new RecordingPort();
    await new TestOpsClient(cfg, port).searchAll({ rql: 'tag = "a"', sortBy: 'id', sortDirection: 'desc' }, 1, 20);
    const params = new URLSearchParams((port.urls[0] ?? '').split('?')[1]);
    expect(params.getAll('sort')).toEqual(['test_case_id,desc', 'name,asc']);
  });

  it('ответ 414 — понятное сообщение вместо кода', async () => {
    const port = new (class implements TestOpsPort {
      async postForm(): Promise<PortResponse> {
        return resp(200, { access_token: fakeJwt() });
      }
      async get(): Promise<PortResponse> {
        return resp(414, '<html>414 Request-URI Too Large</html>');
      }
    })();
    const err = await new TestOpsClient(cfg, port).searchAll({ rql: 'id in [1]' }, 1, 20).catch((e: Error) => e);
    expect((err as Error).message).toBe(
      'Запрос не составить: адрес длиннее, чем принимает сервер TestOps. Сократите набор или разбейте его на части.',
    );
  });
});
