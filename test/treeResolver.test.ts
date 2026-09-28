import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { AttachmentStore } from '../src/attachmentStore.js';
import type { AppConfig } from '../src/config.js';
import { TestOpsClient } from '../src/testops/client.js';
import type { PortResponse, TestOpsPort } from '../src/testops/port.js';
import type { ProjectTree } from '../src/tree.js';
import { TreeResolver } from '../src/treeResolver.js';

const resp = (status: number, body: unknown): PortResponse => ({
  status,
  ok: status >= 200 && status < 300,
  json: async () => body,
  text: async () => JSON.stringify(body),
});

const FAKE_JWT = `h.${Buffer.from(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 3600 })).toString('base64url')}.s`;

const cfg: AppConfig = {
  baseUrl: 'https://x.test',
  token: 'tok',
  projects: {},
  people: {},
  trees: {},
  profileDir: '/tmp/tt-test-profile',
};

const savedTree: ProjectTree = { id: 1, name: 'Основное', fields: [{ id: 10, name: 'Раздел' }] };

class FailingTreePort implements TestOpsPort {
  async postForm(): Promise<PortResponse> {
    return resp(200, { access_token: FAKE_JWT });
  }
  async get(): Promise<PortResponse> {
    return resp(502, {});
  }
}

function resolverOf(store: AttachmentStore | null, onWarn: (message: string) => void): TreeResolver {
  const client = new TestOpsClient(cfg, new FailingTreePort());
  return new TreeResolver(cfg, client, store, onWarn);
}

describe('список деревьев проекта при отказе сервера', () => {
  it('сохранённый список есть — используется он, с предупреждением о возможной устарелости', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'tt-tree-test-'));
    try {
      const store = new AttachmentStore(dir);
      await store.putTrees(cfg.baseUrl, 1, [savedTree]);
      const warnings: string[] = [];
      const trees = await resolverOf(store, (m) => warnings.push(m)).all(1);
      expect(trees).toEqual([savedTree]);
      expect(warnings.join('\n')).toMatch(/список деревьев проекта 1 получить не удалось/);
      expect(warnings.join('\n')).toMatch(/сохранённый.*устаревш/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('сохранённого списка нет — рабочее дерево отсутствует, кейсы остаются без пути', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'tt-tree-test-'));
    try {
      const store = new AttachmentStore(dir);
      const warnings: string[] = [];
      const resolver = resolverOf(store, (m) => warnings.push(m));
      const trees = await resolver.all(1);
      expect(trees).toEqual([]);
      expect(await resolver.working(1)).toBeNull();
      expect(warnings.join('\n')).toMatch(/список деревьев проекта 1 получить не удалось — путь кейсов пуст/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
