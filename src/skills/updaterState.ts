import fs from 'node:fs';
import path from 'node:path';

export type TargetId = 'project' | 'custom';

export interface TargetOption {
  id: TargetId;
  roots: string[];
}

export interface ChosenTarget {
  id: TargetId;
  root?: string;
}

export interface Ask {
  chooseTargets(request: { skills: string[]; options: TargetOption[] }): Promise<ChosenTarget[]>;
  confirm(request: { message: string; paths: string[] }): Promise<boolean>;
}

export type SkipReason = 'foreign-files' | 'unavailable' | 'failed';

export interface SkippedPath {
  path: string;
  reason: SkipReason;
  files?: string[];
  message?: string;
}

export interface InstallReport {
  skills: string[];
  installed: string[];
  skipped: SkippedPath[];
  pruned: string[];
}

export interface RefreshReport {
  refreshed: string[];
  skipped: SkippedPath[];
}

export interface InstalledCopy {
  path: string;
  files: string[];
}

export interface RegistryEntry {
  version: string;
  skills: Record<string, InstalledCopy[]>;
  unavailable?: Record<string, number>;
}

export type Registry = Record<string, RegistryEntry>;

export interface InstallOptions {
  pkgName: string;
  version: string;
  templates: string;
  stateDir: string;
  ask: Ask;
  projectDir: string;
}

export interface RefreshOptions {
  pkgName: string;
  version: string;
  templates: string;
  stateDir: string;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const SKILLS_SUFFIXES = ['.claude/skills', '.codex/skills', '.agents/skills'];
const PROJECT_SUFFIXES = ['.claude/skills', '.agents/skills'];

export const toSlash = (value: string): string => value.replace(/\\/g, '/');

export function samePath(left: string, right: string): boolean {
  const a = path.resolve(left);
  const b = path.resolve(right);
  return process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b;
}

export const findPathKey = (paths: Record<string, number>, target: string): string | undefined =>
  Object.keys(paths).find((key) => samePath(key, target));

export const note = (message: string): void => {
  process.stderr.write(`\x1b[2m${message}\x1b[0m\n`);
};

const registryPath = (stateDir: string): string =>
  path.join(path.resolve(stateDir), 'skills-registry.json');

const readJsonFile = <T>(file: string, fallback: T): T => {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8')) as T;
  } catch {
    return fallback;
  }
};

const writeJsonFile = (file: string, value: unknown): void => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const staging = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(staging, JSON.stringify(value, null, 2), 'utf8');
  fs.renameSync(staging, file);
};

export const readRegistry = (stateDir: string): Registry =>
  readJsonFile<Registry>(registryPath(stateDir), {});

export const writeRegistry = (stateDir: string, registry: Registry): void =>
  writeJsonFile(registryPath(stateDir), registry);

export const recordInstall = (
  registry: Registry,
  pkgName: string,
  version: string,
  skill: string,
  dest: string,
  files: string[],
): void => {
  const entry = registry[pkgName] ?? { version, skills: {} };
  const copies = (entry.skills[skill] ?? []).filter((copy) => !samePath(copy.path, toSlash(dest)));
  copies.push({ path: toSlash(dest), files: [...files].sort() });
  entry.skills[skill] = copies.sort((a, b) => a.path.localeCompare(b.path));
  entry.version = version;
  registry[pkgName] = entry;
};

export const recordedFiles = (
  registry: Registry,
  pkgName: string,
  skill: string,
  dest: string,
): string[] =>
  registry[pkgName]?.skills[skill]?.find((copy) => samePath(copy.path, toSlash(dest)))?.files ?? [];

export const conflictMessage = (pkgName: string, dest: string, files: readonly string[]): string =>
  `${pkgName}: ${dest} was not updated because these files already exist there and were not placed by this program: ${files.join(', ')}. They are the user's own files. Report this conflict to the user and let the user decide what to do with these files.`;

export const pathKey = (value: string): string =>
  process.platform === 'win32' ? value.toLowerCase() : value;

export const isSafeRelative = (relative: string): boolean =>
  relative !== '' &&
  !relative.includes(':') &&
  relative.split('/').every((part) => part !== '' && part !== '.' && part !== '..');

const under = (base: string, suffixes: string[]): string[] =>
  suffixes.map((suffix) => path.join(base, ...suffix.split('/')));

const projectBases = (projectDir: string): string[] =>
  under(path.resolve(projectDir), PROJECT_SUFFIXES);

const customBase = (input: string): string => {
  const resolved = path.resolve(input);
  const asSlash = toSlash(resolved).replace(/\/+$/, '').toLowerCase();
  const isSkillsDir = SKILLS_SUFFIXES.some((suffix) => asSlash.endsWith(`/${suffix}`));
  return isSkillsDir ? resolved : path.join(resolved, '.claude', 'skills');
};

const targetOptions = (projectDir: string): TargetOption[] => [
  { id: 'project', roots: projectBases(projectDir) },
  { id: 'custom', roots: [] },
];

export const basesFor = (choice: ChosenTarget, projectDir: string): string[] => {
  if (choice.id === 'project') return projectBases(projectDir);
  return choice.root === undefined ? [] : [customBase(choice.root)];
};

export { DAY_MS, targetOptions };
