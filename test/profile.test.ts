import { rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { defaultProfile, loadProfile } from '../src/profile.js';

describe('loadProfile (external format config)', () => {
  it('returns the default profile when no path is given', () => {
    expect(loadProfile()).toBe(defaultProfile);
  });

  it('deep-merges an override file: change headings, hide a field, keep the rest', () => {
    const p = join(tmpdir(), '_tt_profile.json');
    writeFileSync(
      p,
      JSON.stringify({
        sections: { scenario: '## Шаги' },
        customFields: { hide: ['Smoke'] },
      }),
    );
    const prof = loadProfile(p);
    expect(prof.sections.scenario).toBe('## Шаги');
    expect(prof.sections.description).toBe('### Описание');
    expect(prof.customFields.hide).toEqual(['Smoke']);
    expect(prof.meta.statusLabel).toBe('Статус');
    rmSync(p);
  });


  it('раздел переименовывается профилем', () => {
    const p = join(tmpdir(), '_tt_profile_own.json');
    writeFileSync(p, JSON.stringify({ sections: { description: '### Что проверяем' } }));
    expect(loadProfile(p).sections.description).toBe('### Что проверяем');
    rmSync(p);
  });

  it('throws when the profile file is missing', () => {
    expect(() => loadProfile(join(tmpdir(), '_tt_none_profile.json'))).toThrow();
  });
});
