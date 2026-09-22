import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createAsk, type Terminal } from '../src/skills/setup.js';
import { run } from './cliRunner.js';

function scripted(answers: string[]): Terminal {
  const queue = [...answers];
  return {
    question: async () => queue.shift() ?? '',
    close: () => {},
  };
}

describe('скилл не ставится глобально', () => {
  let home: string;
  const saved = { HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE };

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'tt-init-home-'));
    process.env.HOME = home;
    process.env.USERPROFILE = home;
  });

  afterEach(() => {
    process.env.HOME = saved.HOME;
    process.env.USERPROFILE = saved.USERPROFILE;
    rmSync(home, { recursive: true, force: true });
  });

  it('проектом названа домашняя папка — отказ, каталог назван, ничего не создано', () => {
    const r = run(['init', home, '--for', 'claude,agents'], { HOME: home, USERPROFILE: home });
    expect(r.code).toBe(1);
    expect(r.stderr).toContain('Скилл не ставится глобально');
    expect(r.stderr).toContain(join(home, '.claude', 'skills'));
    expect(existsSync(join(home, '.claude'))).toBe(false);
    expect(existsSync(join(home, '.agents'))).toBe(false);
    expect(existsSync(join(home, '.tt-testops', 'skills-registry.json'))).toBe(false);
  });

  it.each(['.claude', '.agents', '.codex'])(
    'введён путь ~/%s/skills — отказ до создания файлов',
    async (dir) => {
      const ask = createAsk(scripted(['2', `~/${dir}/skills`]), join(home, 'project'));
      await expect(
        ask.chooseTargets({
          skills: ['tt-testops'],
          options: [
            { id: 'project', label: 'этот проект', roots: [] },
            { id: 'custom', label: 'путь', roots: [] },
          ],
        }),
      ).rejects.toThrow('Скилл не ставится глобально');
      expect(existsSync(join(home, dir))).toBe(false);
    },
  );

  it('каталог обычного проекта в диалоге принимается', async () => {
    const root = join(home, 'project', '.claude', 'skills');
    const ask = createAsk(scripted(['2', root]), join(home, 'project'));
    const chosen = await ask.chooseTargets({
      skills: ['tt-testops'],
      options: [
        { id: 'project', label: 'этот проект', roots: [] },
        { id: 'custom', label: 'путь', roots: [] },
      ],
    });
    expect(chosen).toEqual([{ id: 'custom', root }]);
  });
});
