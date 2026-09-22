import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { setupAdvice } from '../src/setup.js';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'tt-setup-'));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

const TOOL = 'C:/tools/tt-testops';
const advise = () => setupAdvice(dir, TOOL, '0.1.0');

describe('setup explains instead of installing', () => {
  it('separates the machine-wide command from the project-only skill', () => {
    const text = advise().lines.join('\n');
    expect(text).toContain('npm i -g');
    expect(text).toContain('глобального скилла нет');
  });

  it('says the install will ask where the skill goes', () => {
    const text = advise().lines.join('\n');
    expect(text).toContain('спросит');
    expect(text).toContain('не создаётся ни один файл');
    expect(text).not.toContain('отметит существующие');
  });

  it('names the project and the version', () => {
    const a = advise();
    expect(a.lines.join('\n')).toContain(a.project);
    expect(a.lines.join('\n')).toContain('0.1.0');
  });

  it('recognises an npm project and points at the tool folder as a dependency', () => {
    writeFileSync(join(dir, 'package.json'), '{"name":"x"}');
    const a = advise();
    expect(a.isNpmProject).toBe(true);
    expect(a.lines.join('\n')).toContain(`npm i -D file:${TOOL}`);
    expect(a.lines.join('\n')).toContain('npx tt-testops init');
  });

  it('recognises a non-npm project and calls the tool by path', () => {
    const a = advise();
    expect(a.isNpmProject).toBe(false);
    expect(a.lines.join('\n')).toContain(`node ${TOOL}/dist/cli.js`);
    expect(a.lines.join('\n')).toContain(`init ${a.project}`);
  });

  it('never proposes an archive', () => {
    const text = advise().lines.join('\n');
    expect(text).not.toContain('.tgz');
    expect(text).not.toContain('npm pack');
  });

  it('называет все поддерживаемые каталоги скилла', () => {
    const text = advise().lines.join('\n');
    for (const d of ['.claude/skills', '.agents/skills']) {
      expect(text).toContain(d);
    }
  });

  it('changes nothing on disk', () => {
    const before = mkdtempSync(join(tmpdir(), 'tt-untouched-'));
    mkdirSync(join(before, 'подпапка'));
    const a = setupAdvice(before, TOOL, '0.1.0');
    expect(a.lines.length).toBeGreaterThan(0);

    expect(() => rmSync(join(before, '.claude'), { recursive: true })).toThrow();
    rmSync(before, { recursive: true, force: true });
  });
});
