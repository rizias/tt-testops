import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { SETTINGS_FIELDS } from '../src/settingsSchema.js';

function readmeVars(): Set<string> {
  const text = readFileSync(join(process.cwd(), 'README.md'), 'utf8');
  const matches = text.match(/TT_TESTOPS_[A-Z0-9_]+/g) ?? [];
  return new Set(matches);
}

function schemaVars(): Set<string> {
  const vars = SETTINGS_FIELDS.map((f) => f.envVar).filter((v): v is string => v !== undefined);
  return new Set([...vars, 'TT_TESTOPS_PROFILE']);
}

describe('переменные окружения в README совпадают со схемой полей', () => {
  it('README не называет лишних переменных TT_TESTOPS_*', () => {
    const readme = readmeVars();
    const schema = schemaVars();
    const extra = [...readme].filter((v) => !schema.has(v));
    expect(extra).toEqual([]);
  });

  it('README называет все переменные TT_TESTOPS_* полей и TT_TESTOPS_PROFILE', () => {
    const readme = readmeVars();
    const schema = schemaVars();
    const missing = [...schema].filter((v) => !readme.has(v));
    expect(missing).toEqual([]);
  });
});
