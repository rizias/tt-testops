import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { type ResolveDeps, resolveToTestCase } from '../src/contentResolver.js';
import { caseBody } from '../src/htmlCase.js';
import type { RawCase } from '../src/model.js';
import { defaultProfile, loadProfile } from '../src/profile.js';
import { renderCase } from '../src/render.js';
import { TestOpsClient } from '../src/testops/client.js';
import type { PortResponse, TestOpsPort } from '../src/testops/port.js';

async function caseDetails(client: TestOpsClient, id: string) {
  const overview = await client.fetchOverview(id);
  return overview ? client.fetchCaseFromOverview(overview) : null;
}

const deps: ResolveDeps = { fetchAttachment: async () => '', baseUrl: 'https://ts.example' };

const resp = (status: number, body: unknown): PortResponse => ({
  status,
  ok: status >= 200 && status < 300,
  json: async () => body,
  text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
});

const fakeJwt = `h.${Buffer.from(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 3600 })).toString('base64url')}.s`;

class MapPort implements TestOpsPort {
  calls: string[] = [];
  constructor(private readonly map: Record<string, PortResponse>) {}
  async postForm(): Promise<PortResponse> {
    return resp(200, { access_token: fakeJwt });
  }
  async get(url: string): Promise<PortResponse> {
    this.calls.push(url);
    for (const [fragment, response] of Object.entries(this.map)) {
      if (url.includes(fragment)) return response;
    }
    return resp(404, {});
  }
}

const cfg = {
  baseUrl: 'https://x.test',
  token: 'tok',
  projects: {},
  people: {},
  trees: {},
  profileDir: '/tmp/tt-test-profile',
} as never;

function autotestCase(runScenario: unknown): RawCase {
  return {
    overview: {
      id: 5001,
      projectId: 1,
      name: 'Автотест без ручных шагов',
      status: { name: 'Active' },
      automated: true,
      hasManualScenario: false,
      scenario: { steps: [], attachments: [] },
    },
    steps: null,
    runScenario,
    comments: [],
  } as unknown as RawCase;
}

const RUN = {
  steps: [
    {
      name: 'Открыть форму',
      expectedResult: 'Форма открыта',
      attachments: [{ id: 9, name: 'shot.png', contentType: 'image/png' }],
    },
    { name: 'Ввести данные', steps: [{ name: 'Скрыто точками' }] },
  ],
};

describe('сценарий из тестового результата: Markdown побайтно', () => {
  it('строка «Нет шагов», шаги с отступом 4 пробела, ожидаемый результат, без вложений', async () => {
    const tc = await resolveToTestCase(autotestCase(RUN), defaultProfile, deps);
    expect(renderCase(tc, defaultProfile)).toBe(
      '# **Автотест без ручных шагов** (ID: 5001)\n' +
        '- **Проект:** `1`\n' +
        '- **Статус:** `Active`\n' +
        '- **Тип:** `Автоматизированный`\n' +
        '\n' +
        '### Сценарий\n' +
        '> ⚠️ **Нет шагов** (сценарий взят из автотеста)\n' +
        '1. Открыть форму\n' +
        '\n' +
        '    **Ожидаемый результат:** Форма открыта\n' +
        '2. Ввести данные\n' +
        '\n' +
        '    1. Скрыто точками\n',
    );
  });

  it('тестовый результат без шагов — обычный пустой сценарий', async () => {
    const tc = await resolveToTestCase(autotestCase({ steps: [] }), defaultProfile, deps);
    expect(tc.scenarioSource).toBe('empty');
    expect(tc.scenarioLines).toEqual(['> ⚠️ **Нет шагов** (Сценарий пуст)']);
  });
});

describe('сценарий из тестового результата: HTML', () => {
  it('строка стоит над списком, первый пункт — первый шаг', async () => {
    const tc = await resolveToTestCase(autotestCase(RUN), defaultProfile, deps);
    const html = caseBody({ tc, state: 'empty' }, defaultProfile, new Map());
    const banner = html.indexOf('(сценарий взят из автотеста)');
    const list = html.indexOf('<ol class="steps"><li data-n="1.">Открыть форму');
    expect(banner).toBeGreaterThan(-1);
    expect(list).toBeGreaterThan(banner);
  });
});

describe('когда тестовый результат не запрашивается', () => {
  it('ошибка получения своих шагов: сообщение об ошибке, запроса тестового результата нет', async () => {
    const port = new MapPort({ '/overview': resp(200, { id: 7, hasManualScenario: true }) });
    const raw = await caseDetails(new TestOpsClient(cfg, port), '7');
    expect(port.calls.some((u) => u.includes('scenariofromrun'))).toBe(false);
    const tc = await resolveToTestCase(raw as RawCase, defaultProfile, deps);
    expect(tc.scenarioLines).toEqual([
      '> ⚠️ **Нет шагов** (Сценарий пуст)',
      '',
      '_Ошибка получения шагов или пустой ответ API_',
    ]);
  });
});

describe('профиль без ключа autotestScenario', () => {
  it('строка берётся из профиля по умолчанию', () => {
    const dir = mkdtempSync(join(tmpdir(), 'tt-profile-'));
    try {
      const file = join(dir, 'format.json');
      writeFileSync(file, JSON.stringify({ steps: { numbered: true } }));
      expect(loadProfile(file).warnings.autotestScenario).toBe(
        '> ⚠️ **Нет шагов** (сценарий взят из автотеста)',
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
