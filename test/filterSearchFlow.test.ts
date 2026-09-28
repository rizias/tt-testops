import { describe, expect, it } from 'vitest';
import { parseFlags } from '../src/args.js';
import type { AppConfig } from '../src/config.js';
import { Gateway } from '../src/gateway.js';
import { handleLink, handleList } from '../src/listCommand.js';
import { sourcesOf } from '../src/querySources.js';
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
  defaultProjectId: 3,
  projects: {},
  people: {},
  trees: {},
  profileDir: '/tmp/tt-test-profile',
};

function fakeJwt(): string {
  return `h.${Buffer.from(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 3600 })).toString('base64url')}.s`;
}

class SearchPort implements TestOpsPort {
  urls: string[] = [];
  constructor(private readonly total = 0) {}
  async postForm(): Promise<PortResponse> {
    return resp(200, { access_token: fakeJwt() });
  }
  async get(url: string): Promise<PortResponse> {
    this.urls.push(url);
    return resp(200, { content: [], totalElements: this.total, last: true });
  }
}

const encode = (list: unknown[]) =>
  encodeURIComponent(Buffer.from(JSON.stringify(list), 'utf8').toString('base64'));

function paramsOf(url: string): URLSearchParams {
  return new URLSearchParams(url.slice(url.indexOf('?') + 1));
}

function searchOf(url: string): unknown {
  const raw = paramsOf(url).get('search');
  return raw ? JSON.parse(Buffer.from(raw, 'base64').toString('utf8')) : null;
}

function gatewayOver(port: TestOpsPort): Gateway {
  return new Gateway(cfg, new TestOpsClient(cfg, port), undefined, null, () => {});
}

const TAG = { id: 'tag', value: [11, 12], label: ['<тег-1>', '<тег-2>'], type: 'longArray' };
const FIELD = { id: 'cfv.1', value: [21], label: ['<Значение>'], type: 'longArray' };
const CONTENT = { id: 'content', value: 'открыть форму', type: 'string' };

describe('ссылка на фильтр → запрос к серверу', () => {
  it('теги, значение поля и содержимое уходят серверу как есть, в исходном порядке', async () => {
    const port = new SearchPort(5);
    const link = `https://x.test/project/7/test-cases?treeId=4&search=${encode([TAG, FIELD, CONTENT])}`;
    const [count] = await gatewayOver(port).countSources(sourcesOf(parseFlags([link])));
    expect(count).toEqual({ project: 7, count: 5 });
    expect(port.urls[0]?.startsWith('https://x.test/api/v2/project/7/test-case/flat?')).toBe(true);
    expect(searchOf(port.urls[0] ?? '')).toEqual([TAG, FIELD, CONTENT]);
  });

  it('сохранённый фильтр уходит параметром filterId без search', async () => {
    const port = new SearchPort(2);
    const link = 'https://x.test/project/7/test-cases?filterId=9';
    await gatewayOver(port).countSources(sourcesOf(parseFlags([link])));
    const params = paramsOf(port.urls[0] ?? '');
    expect(params.get('filterId')).toBe('9');
    expect(params.has('search')).toBe(false);
  });

  it('пустой список условий — ошибка «нет запроса», сервер не спрошен', () => {
    const link = `https://x.test/project/7/test-cases?search=${encode([])}`;
    expect(() => sourcesOf(parseFlags([link]))).toThrow(/В ссылке нет запроса/);
  });

  it('единственное aql с пустым значением — та же ошибка', () => {
    const link = `https://x.test/project/7/test-cases?search=${encode([{ id: 'aql', value: '', type: 'string' }])}`;
    expect(() => sourcesOf(parseFlags([link]))).toThrow(/В ссылке нет запроса/);
  });

  it('нечисловой filterId — ошибка, называющая filterId', () => {
    const link = 'https://x.test/project/7/test-cases?filterId=abc';
    expect(() => sourcesOf(parseFlags([link]))).toThrow(/filterId/);
  });

  it('id in [...] вместе с условием ссылки идёт поиском в проекте, а не напрямую', async () => {
    const port = new SearchPort(1);
    const aql = { id: 'aql', value: 'id in [101, 102]', type: 'string' };
    const link = `https://x.test/project/7/test-cases?search=${encode([aql, TAG])}`;
    const [count] = await gatewayOver(port).countSources(sourcesOf(parseFlags([link])));
    expect(count).toEqual({ project: 7, count: 1 });
    expect(searchOf(port.urls[0] ?? '')).toEqual([aql, TAG]);
  });

  it('второе условие aql уходит серверу обычным условием и не теряется', async () => {
    const port = new SearchPort(0);
    const first = { id: 'aql', value: 'automation = true', type: 'string' };
    const second = { id: 'aql', value: 'tag = "<тег>"', type: 'string' };
    const link = `https://x.test/project/7/test-cases?search=${encode([first, second])}`;
    await gatewayOver(port).countSources(sourcesOf(parseFlags([link])));
    expect(searchOf(port.urls[0] ?? '')).toEqual([first, second]);
  });

  it('дерево из ссылки даёт предупреждение с новой причиной', () => {
    const link = `https://x.test/project/7/test-cases?treeId=4&search=${encode([TAG])}`;
    const warnings: string[] = [];
    const write = process.stderr.write.bind(process.stderr);
    process.stderr.write = ((chunk: string) => {
      warnings.push(String(chunk));
      return true;
    }) as typeof process.stderr.write;
    try {
      sourcesOf(parseFlags([link]));
    } finally {
      process.stderr.write = write;
    }
    expect(warnings.join('')).toContain(
      'Фильтр по дереву кейсов (treeId=4) не перенесён: дерево задаёт только путь кейсов.',
    );
  });
});

describe('--text в сочетаниях', () => {
  it('count по двум парам: оба запроса несут content', async () => {
    const port = new SearchPort(3);
    const f = parseFlags(['--project', '5', '--rql', 'tag = "a"', '--project', '6', '--rql', 'tag = "b"', '--text', 'фраза']);
    const counts = await gatewayOver(port).countSources(sourcesOf(f));
    expect(counts).toEqual([
      { project: 5, count: 3 },
      { project: 6, count: 3 },
    ]);
    expect(searchOf(port.urls[0] ?? '')).toEqual([
      { id: 'aql', value: 'tag = "a"', type: 'string' },
      { id: 'content', value: 'фраза', type: 'string' },
    ]);
    expect(searchOf(port.urls[1] ?? '')).toEqual([
      { id: 'aql', value: 'tag = "b"', type: 'string' },
      { id: 'content', value: 'фраза', type: 'string' },
    ]);
  });

  it('count по одним идентификаторам с фразой считается поиском, а не отказом', async () => {
    const port = new SearchPort(1);
    const f = parseFlags(['id in [101, 102]', '--project', '7', '--text', 'фраза']);
    const [count] = await gatewayOver(port).countSources(sourcesOf(f));
    expect(count).toEqual({ project: 7, count: 1 });
    expect(searchOf(port.urls[0] ?? '')).toEqual([
      { id: 'aql', value: 'id in [101, 102]', type: 'string' },
      { id: 'content', value: 'фраза', type: 'string' },
    ]);
  });

  it('count по фразе, которой нет, — ноль без ошибки', async () => {
    const port = new SearchPort(0);
    const f = parseFlags(['--project', '7', '--text', 'нет такой фразы']);
    const [count] = await gatewayOver(port).countSources(sourcesOf(f));
    expect(count).toEqual({ project: 7, count: 0 });
  });

  it('list по фразе, которой нет, — «кейсов не найдено»', async () => {
    const port = new SearchPort(0);
    const f = parseFlags(['--project', '7', '--text', 'нет такой фразы']);
    const result = await handleList(gatewayOver(port), f);
    if (typeof result === 'number') throw new Error('ожидался текстовый результат');
    expect(result.out).toBe('По данному запросу кейсов не найдено.');
  });

  it('пустая фраза — ошибка разбора', () => {
    expect(() => parseFlags(['--text', '   '])).toThrow('Флагу --text нужна непустая фраза для поиска.');
  });
});

describe('link', () => {
  it('по фразе печатает адрес фильтра TestOps', async () => {
    const f = parseFlags(['--project', '7', '--text', 'фраза']);
    const result = await handleLink(gatewayOver(new SearchPort()), f);
    expect(result.out.startsWith('https://x.test/project/7/test-cases?search=')).toBe(true);
  });

  it('без запроса — ошибка по-русски', async () => {
    const f = parseFlags(['--project', '7']);
    await expect(handleLink(gatewayOver(new SearchPort()), f)).rejects.toThrow(
      'Команде link нужен запрос: AQL, ссылка на фильтр TestOps или фраза --text.',
    );
  });
});
