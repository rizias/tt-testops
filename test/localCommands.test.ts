import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Flags } from '../src/args.js';
import { localCommand } from '../src/localCommands.js';

const mocks = vi.hoisted(() => ({ runInit: vi.fn() }));

vi.mock('../src/skills/setup.js', () => ({ runInit: mocks.runInit }));

let project: string;

beforeEach(() => {
  project = mkdtempSync(join(tmpdir(), 'tt-local-command-'));
  mocks.runInit.mockReset();
});

afterEach(() => {
  rmSync(project, { recursive: true, force: true });
});

function flags(): Flags {
  return { _: [project], projects: [], queries: [], for: 'claude' };
}

describe('localCommand init', () => {
  it('returns code 1 when a copy is skipped', async () => {
    mocks.runInit.mockResolvedValue({
      skills: ['tt-testops'],
      installed: ['copy'],
      skipped: [{ path: 'other', reason: 'failed' }],
      pruned: [],
    });

    const result = await localCommand('init', flags(), '0.1.0', 'tools');

    expect(result.code).toBe(1);
  });

  it('returns code 0 when no copy is skipped', async () => {
    mocks.runInit.mockResolvedValue({
      skills: ['tt-testops'],
      installed: ['copy'],
      skipped: [],
      pruned: [],
    });

    const result = await localCommand('init', flags(), '0.1.0', 'tools');

    expect(result.code).toBe(0);
  });
});
