import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CLI_HOME, PACKAGE_SKILL, run, sandbox } from './cliRunner.js';

const VERSION = JSON.parse(readFileSync(join(process.cwd(), 'package.json'), 'utf8')).version;

function seedInstalledSkill(home: string, project: string): string {
  const destination = join(project, '.claude', 'skills', 'tt-testops');
  mkdirSync(destination, { recursive: true });
  const copy = join(destination, 'SKILL.md');
  const stale = readFileSync(PACKAGE_SKILL, 'utf8').replace(
    /tt-testops-skill-version: [^\n]+/,
    'tt-testops-skill-version: 0.0.0',
  );
  writeFileSync(copy, stale, 'utf8');
  const installed = [{ path: destination.replace(/\\/g, '/'), files: ['SKILL.md'] }];
  const registry = { version: '0.0.0', skills: { 'tt-testops': installed } };
  mkdirSync(join(home, '.tt-testops'), { recursive: true });
  const registryJson = JSON.stringify({ '@rizias/tt-testops': registry });
  writeFileSync(join(home, '.tt-testops', 'skills-registry.json'), registryJson, 'utf8');
  return copy;
}

const hashFile = (file: string): string =>
  createHash('sha256').update(readFileSync(file)).digest('hex');

function treeSnapshot(dir: string): string {
  const lines: string[] = [];
  const walk = (current: string, prefix: string): void => {
    for (const entry of readdirSync(current, { withFileTypes: true }).sort((a, b) =>
      a.name.localeCompare(b.name),
    )) {
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) walk(join(current, entry.name), relative);
      else lines.push(`${relative} ${hashFile(join(current, entry.name))}`);
    }
  };
  walk(dir, '');
  return lines.join('\n');
}

describe('установка скилла через команду init', () => {
  let project: string;
  beforeEach(() => {
    project = mkdtempSync(join(tmpdir(), 'tt-cli-skill-'));
  });
  afterEach(() => {
    rmSync(project, { recursive: true, force: true });
  });

  it('кладёт файл скилла только в каталог claude и пишет реестр', () => {
    const r = run(['init', project, '--for', 'claude']);
    expect(r.code).toBe(0);
    expect(existsSync(join(project, '.claude/skills/tt-testops/SKILL.md'))).toBe(true);
    expect(existsSync(join(project, '.agents/skills/tt-testops/SKILL.md'))).toBe(false);
    expect(JSON.parse(r.stdout).installed).toContain(
      join(project, '.claude/skills/tt-testops').replace(/\\/g, '/'),
    );
    const registry = JSON.parse(
      readFileSync(join(CLI_HOME, '.tt-testops', 'skills-registry.json'), 'utf8'),
    );
    expect(registry['@rizias/tt-testops'].version).toBe(VERSION);
    expect(registry['@rizias/tt-testops'].skills['tt-testops'][0].path).toContain(
      '.claude/skills/tt-testops',
    );
  });

  it('без флага и терминала не меняет существующую копию', () => {
    const noTtyHome = mkdtempSync(join(sandbox, 'no-tty-home-'));
    const noTtyProject = mkdtempSync(join(sandbox, 'no-tty-project-'));
    seedInstalledSkill(noTtyHome, noTtyProject);
    const before = [treeSnapshot(noTtyHome), treeSnapshot(noTtyProject)];
    try {
      const r = run(['init', noTtyProject], { HOME: noTtyHome, USERPROFILE: noTtyHome });
      expect(r.code).toBe(1);
      expect(r.stderr).toContain('--for');
      expect([treeSnapshot(noTtyHome), treeSnapshot(noTtyProject)]).toEqual(before);
    } finally {
      rmSync(noTtyProject, { recursive: true, force: true });
      rmSync(noTtyHome, { recursive: true, force: true });
    }
  });

  it('init с флагом синхронизирует старую копию в другом проекте', () => {
    const home = mkdtempSync(join(sandbox, 'init-sync-home-'));
    const staleProject = mkdtempSync(join(sandbox, 'init-sync-stale-'));
    const freshProject = mkdtempSync(join(sandbox, 'init-sync-fresh-'));
    const staleCopy = seedInstalledSkill(home, staleProject);
    try {
      const r = run(['init', freshProject, '--for', 'claude'], { HOME: home, USERPROFILE: home });
      expect(r.code).toBe(0);
      expect(readFileSync(staleCopy, 'utf8')).toBe(readFileSync(PACKAGE_SKILL, 'utf8'));
    } finally {
      rmSync(home, { recursive: true, force: true });
      rmSync(staleProject, { recursive: true, force: true });
      rmSync(freshProject, { recursive: true, force: true });
    }
  });

  it('обычная команда синхронизирует старую копию с файлом пакета', () => {
    const home = mkdtempSync(join(sandbox, 'setup-home-'));
    const setupProject = mkdtempSync(join(sandbox, 'setup-project-'));
    const copy = seedInstalledSkill(home, setupProject);
    try {
      const r = run(['setup', setupProject], { HOME: home, USERPROFILE: home });
      expect(r.code).toBe(0);
      expect(readFileSync(copy, 'utf8')).toBe(readFileSync(PACKAGE_SKILL, 'utf8'));
    } finally {
      rmSync(home, { recursive: true, force: true });
      rmSync(setupProject, { recursive: true, force: true });
    }
  });
});
