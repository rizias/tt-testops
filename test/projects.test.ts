import { describe, expect, it } from 'vitest';
import type { AppConfig } from '../src/config.js';
import { Gateway } from '../src/gateway.js';
import type { TestOpsClient } from '../src/testops/client.js';

const cfg: AppConfig = {
  baseUrl: 'https://x.test',
  token: 'tok',
  defaultProjectId: 1,
  projects: { '1': 'Проект A', '2': 'проект1', '3': 'Вымышленный проект В' },
  people: {},
  trees: {},
  profileDir: '/tmp/tt-test-profile',
};

const SERVER = [
  { id: 1, name: 'Проект A' },
  { id: 2, name: 'проект1' },
  { id: 5, name: 'Вымышленный проект Д' },
  { id: 6, name: 'Вымышленный проект Е' },
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
      { id: 1, name: 'Проект A', onServer: true },
      { id: 2, name: 'проект1', onServer: true },
      { id: 3, name: 'Вымышленный проект В', onServer: false },
    ]);
  });

  it('names server projects that the configuration does not list', async () => {
    const r = await new Gateway(cfg, client()).projects();
    expect(r.notInConfig).toEqual([
      { id: 5, name: 'Вымышленный проект Д' },
      { id: 6, name: 'Вымышленный проект Е' },
    ]);
  });

  it('still reports the agreed list when the server cannot be asked', async () => {
    const r = await new Gateway(cfg, client(true)).projects();
    expect(r.serverReachable).toBe(false);
    expect(r.agreed.map((p) => p.id)).toEqual([1, 2, 3]);
    expect(r.agreed.every((p) => p.onServer === null)).toBe(true);
    expect(r.notInConfig).toEqual([]);
  });
});
