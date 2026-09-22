import { describe, expect, it } from 'vitest';
import type { AppConfig } from '../src/config.js';
import { Gateway } from '../src/gateway.js';
import type { TestOpsClient } from '../src/testops/client.js';

const cfg: AppConfig = {
  baseUrl: 'https://x.test',
  token: 'tok',
  defaultProjectId: 14,
  projects: { '14': 'Проект A', '85': 'проект1', '19': 'Вымышленный проект В' },
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

const SERVER = [
  { id: 14, name: 'Проект A' },
  { id: 85, name: 'проект1' },
  { id: 86, name: 'Вымышленный проект Д' },
  { id: 87, name: 'Вымышленный проект Е' },
];

const client = (fails = false): TestOpsClient =>
  ({
    fetchProjects: async () => {
      if (fails) throw new Error('unreachable');
      return SERVER;
    },
  }) as unknown as TestOpsClient;

describe('agreed project list', () => {
  it('reports every configured project with whether the server has it', async () => {
    const r = await new Gateway(cfg, client()).projects();
    expect(r.serverReachable).toBe(true);
    expect(r.agreed).toEqual([
      { id: 14, name: 'Проект A', onServer: true },

      { id: 19, name: 'Вымышленный проект В', onServer: false },
      { id: 85, name: 'проект1', onServer: true },
    ]);
  });

  it('names server projects that the configuration does not list', async () => {
    const r = await new Gateway(cfg, client()).projects();
    expect(r.notInConfig).toEqual([
      { id: 86, name: 'Вымышленный проект Д' },
      { id: 87, name: 'Вымышленный проект Е' },
    ]);
  });

  it('still reports the agreed list when the server cannot be asked', async () => {
    const r = await new Gateway(cfg, client(true)).projects();
    expect(r.serverReachable).toBe(false);
    expect(r.agreed.map((p) => p.id)).toEqual([14, 19, 85]);
    expect(r.agreed.every((p) => p.onServer === null)).toBe(true);
    expect(r.notInConfig).toEqual([]);
  });
});

describe('membership of the agreed list', () => {
  const gw = new Gateway(cfg, client());

  it('recognises a configured project by id and by name', () => {
    expect(gw.isAgreedProject(14)).toBe(true);
    expect(gw.isAgreedProject('85')).toBe(true);
    expect(gw.isAgreedProject('проект1')).toBe(true);
  });

  it('recognises a project outside the list', () => {
    expect(gw.isAgreedProject(87)).toBe(false);
  });

  it('treats the default project as configured when it is listed', () => {
    expect(gw.isAgreedProject()).toBe(true);
  });

  it('asks the network for nothing', () => {
    let called = false;
    const spy = {
      fetchProjects: async () => {
        called = true;
        return SERVER;
      },
    } as unknown as TestOpsClient;
    new Gateway(cfg, spy).isAgreedProject(87);
    expect(called).toBe(false);
  });
});
