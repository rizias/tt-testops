import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CaseCache } from '../src/cache.js';

describe('хранилище', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'tt-store-'));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('структурно повреждённая запись считается отсутствующей', () => {
    const cache = new CaseCache(dir);
    mkdirSync(join(dir, 'cases'), { recursive: true });
    writeFileSync(
      join(dir, 'cases', '14-1.json'),
      JSON.stringify({ lastModifiedDate: 1, raw: { нечто: 'постороннее' } }),
      'utf8',
    );
    expect(cache.getCase(14, 1, 1)).toBeNull();
  });

  it('в занимаемом объёме учтены сохранённые деревья', () => {
    const cache = new CaseCache(dir);
    mkdirSync(join(dir, 'trees'), { recursive: true });
    writeFileSync(join(dir, 'trees', 'x.json'), 'x'.repeat(200), 'utf8');
    expect(cache.stats().bytes).toBeGreaterThanOrEqual(200);
  });
});
