import { describe, expect, it } from 'vitest';
import { auditCase, scenarioStateOf } from '../src/audit.js';
import type { ResolveDeps } from '../src/contentResolver.js';
import { resolveToTestCase } from '../src/contentResolver.js';
import { scenarioHtml } from '../src/htmlRichSteps.js';
import type { RawCase } from '../src/model.js';
import { defaultProfile } from '../src/profile.js';
import { renderCase } from '../src/render.js';
import { TestOpsClient } from '../src/testops/client.js';
import type { PortResponse, TestOpsPort } from '../src/testops/port.js';

async function caseDetails(client: TestOpsClient, id: string) {
  const overview = await client.fetchOverview(id);
  return overview ? client.fetchCaseFromOverview(overview) : null;
}

const fakeJwt = `h.${Buffer.from(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 3600 })).toString('base64url')}.s`;

const resp = (status: number, body: unknown): PortResponse => ({
  status,
  ok: status >= 200 && status < 300,
  json: async () => body,
  text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
});

class MapPort implements TestOpsPort {
  calls: string[] = [];
  constructor(private readonly map: Record<string, PortResponse | undefined>) {}
  async postForm(): Promise<PortResponse> {
    return resp(200, { access_token: fakeJwt });
  }
  async get(url: string): Promise<PortResponse> {
    this.calls.push(url);
    for (const [frag, response] of Object.entries(this.map)) {
      if (url.includes(frag) && response) return response;
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

describe('запрос сценария из тестового результата', () => {
  it('собственные шаги есть — запрос не идёт', async () => {
    const port = new MapPort({
      '/overview': resp(200, { id: 1, hasManualScenario: true }),
      '/step': resp(200, { root: { children: [1] }, scenarioSteps: { 1: { body: 'Шаг' } } }),
    });
    const raw = await caseDetails(new TestOpsClient(cfg, port), '1');
    expect(raw?.runScenario).toBeNull();
    expect(port.calls.some((u) => u.includes('scenariofromrun'))).toBe(false);
  });

  it('своих шагов нет — запрос идёт и результат сохраняется в теле кейса', async () => {
    const runSteps = [{ name: 'Открыть форму' }, { name: 'Ввести данные' }];
    const port = new MapPort({
      '/overview': resp(200, { id: 2, hasManualScenario: true }),
      '/step': resp(200, { root: { children: [] } }),
      scenariofromrun: resp(200, { steps: runSteps }),
    });
    const raw = await caseDetails(new TestOpsClient(cfg, port), '2');
    expect(raw?.runScenario).toEqual({ steps: runSteps });
  });

  it('шаги редактора только пустые — сценарий берётся из прогона, источник autotestRun', async () => {
    const port = new MapPort({
      '/overview': resp(200, { id: 5, hasManualScenario: true }),
      '/step': resp(200, { root: { children: [1, 2] }, scenarioSteps: { 1: { body: '' }, 2: { body: '  ' } } }),
      scenariofromrun: resp(200, { steps: [{ name: 'Шаг из прогона' }] }),
    });
    const raw = await caseDetails(new TestOpsClient(cfg, port), '5');
    if (!raw) throw new Error('кейс не получен');
    const tc = await resolveToTestCase(raw, defaultProfile, { baseUrl: '', fetchAttachment: async () => '' });
    expect(renderCase(tc, defaultProfile)).toContain(defaultProfile.warnings.autotestScenario);
    expect(renderCase(tc, defaultProfile)).toContain('1. Шаг из прогона');
  });

  it('ошибка получения собственных шагов — тестовый результат не запрашивается', async () => {
    const port = new MapPort({
      '/overview': resp(200, { id: 3, hasManualScenario: true }),
    });
    const raw = await caseDetails(new TestOpsClient(cfg, port), '3');
    expect(raw?.steps).toBeNull();
    expect(port.calls.some((u) => u.includes('scenariofromrun'))).toBe(false);
  });

  it('404 у тестового результата — пустой сценарий без предупреждения', async () => {
    const warns: string[] = [];
    const port = new MapPort({
      '/overview': resp(200, { id: 4, hasManualScenario: false, scenario: { steps: [] } }),
    });
    const client = new TestOpsClient(cfg, port, (m) => warns.push(m));
    const raw = await caseDetails(client, '4');
    expect(raw?.runScenario).toEqual({ steps: [] });
    expect(warns).toEqual([]);
  });

  it('отказ запроса тестового результата — предупреждение с номером кейса, остальные кейсы выгружаются', async () => {
    const warns: string[] = [];
    const port = new MapPort({
      '/1/overview': resp(200, { id: 1, hasManualScenario: false, scenario: { steps: [] } }),
      '/2/overview': resp(200, { id: 2, hasManualScenario: false, scenario: { steps: [] } }),
      '1/scenariofromrun': resp(500, {}),
      '2/scenariofromrun': resp(200, { steps: [{ name: 'Шаг' }] }),
    });
    const client = new TestOpsClient(cfg, port, (m) => warns.push(m));
    const out = await client.fetchBatch([1, 2]);
    expect(out).toHaveLength(2);
    const first = out.find((c) => Number(c.overview.id) === 1);
    const second = out.find((c) => Number(c.overview.id) === 2);
    expect(first).toBeDefined();
    expect(first && 'runScenario' in first).toBe(false);
    expect(second?.runScenario).toEqual({ steps: [{ name: 'Шаг' }] });
    expect(warns.join(' ')).toContain('кейс 1: сценарий из тестового результата получить не удалось');
  });
});

const deps: ResolveDeps = {
  fetchAttachment: async () => '',
  baseUrl: 'https://ts.example',
};

function caseWithRunScenario(): RawCase {
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
    runScenario: {
      steps: [{ name: 'Открыть форму' }, { name: 'Ввести данные', steps: [{ name: 'Скрыто точками' }] }],
    },
    comments: [],
  } as unknown as RawCase;
}

describe('сценарий из тестового результата в выводе', () => {
  it('источник autotestRun, строка предупреждения и шаги с вложенностью', async () => {
    const tc = await resolveToTestCase(caseWithRunScenario(), defaultProfile, deps);
    expect(tc.scenarioSource).toBe('autotestRun');
    expect(tc.scenarioLines).toEqual([
      '> ⚠️ **Нет шагов** (сценарий взят из автотеста)',
      '1. Открыть форму',
      '2. Ввести данные',
      '',
      '    1. Скрыто точками',
    ]);
  });

  it('Markdown кейса: сценарий начинается с баннера и несёт шаги под ним', async () => {
    const tc = await resolveToTestCase(caseWithRunScenario(), defaultProfile, deps);
    const out = renderCase(tc, defaultProfile);
    const scenarioIndex = out.indexOf('### Сценарий');
    const after = out.slice(scenarioIndex);
    expect(
      after.startsWith('### Сценарий\n> ⚠️ **Нет шагов** (сценарий взят из автотеста)\n1. Открыть форму'),
    ).toBe(true);
    expect(after).toContain('    1. Скрыто точками');
  });

  it('пометка «Пустой сценарий» ставится и для сценария из автотеста', async () => {
    const raw = caseWithRunScenario();
    const tc = await resolveToTestCase(raw, defaultProfile, deps);
    expect(scenarioStateOf(tc, raw)).toBe('empty');
    const findings = auditCase(tc, raw);
    expect(findings.map((f) => f.message)).toContain('Пустой сценарий');
  });

  it('HTML: шаги из автотеста — вложенный список без строки «Нет шагов»', async () => {
    const tc = await resolveToTestCase(caseWithRunScenario(), defaultProfile, deps);
    const html = scenarioHtml(tc.scenario, defaultProfile, new Map());
    const list = html.slice(html.indexOf('<ol class="steps">'));
    expect(html.indexOf('Нет шагов')).toBeLessThan(html.indexOf('<ol class="steps">'));
    expect(list).not.toContain('Нет шагов');
    expect(list.startsWith('<ol class="steps"><li data-n="1.">Открыть форму')).toBe(true);
    expect(html).toMatch(/Ввести данные[\s\S]*<ol class="steps">[\s\S]*Скрыто точками/);
  });

  it('собственные шаги важнее тестового результата, даже если он пришёл в теле', async () => {
    const raw: RawCase = {
      overview: {
        id: 5002,
        projectId: 1,
        name: 'Кейс со своими шагами',
        hasManualScenario: true,
      },
      steps: {
        root: { children: [1] },
        scenarioSteps: { 1: { body: 'Свой шаг' } },
        attachments: {},
      },
      runScenario: { steps: [{ name: 'Шаг автотеста' }] },
      comments: [],
    } as unknown as RawCase;
    const tc = await resolveToTestCase(raw, defaultProfile, deps);
    expect(tc.scenarioSource).toBe('newSteps');
    expect(tc.scenarioLines.join(' ')).not.toContain('автотеста');
  });
});
