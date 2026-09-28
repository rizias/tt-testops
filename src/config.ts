import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join } from 'node:path';
import { ConfigError } from './errors.js';
import { type ProfileFlags, type ProfileSelection, resolveProfile } from './settingsPaths.js';
import { fieldByKey, getByPath, SETTINGS_FIELDS, type FieldSource, type SettingsField } from './settingsSchema.js';

export interface AppConfig {
  baseUrl: string;
  token: string;
  defaultProjectId?: number;
  projects: Record<string, string>;
  people: Record<string, string>;
  trees: Record<string, number | string>;
  profileDir: string;
  profileFile?: string;
  formatFile?: string;
}

export interface FieldResolution {
  field: SettingsField;
  value: unknown;
  source: FieldSource;
  filePath: string;
}

function readJson(path: string, describe: string): Record<string, unknown> | null {
  if (!existsSync(path)) return null;
  let raw: string;
  try {
    raw = new TextDecoder('utf-8', { fatal: true }).decode(readFileSync(path));
  } catch {
    throw new ConfigError(`${describe} не в кодировке UTF-8: ${path}. Пересохраните файл в UTF-8.`);
  }
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    throw new ConfigError(`${describe} повреждён (не JSON): ${path}`);
  }
  if (typeof data !== 'object' || data === null || Array.isArray(data)) {
    throw new ConfigError(`${describe} должен быть JSON-объектом: ${path}`);
  }
  return data as Record<string, unknown>;
}

export function setNested(target: Record<string, unknown>, path: string, value: unknown): void {
  const parts = path.split('.');
  let node = target;
  parts.forEach((part, i) => {
    if (i === parts.length - 1) {
      node[part] = value;
      return;
    }
    node[part] = node[part] && typeof node[part] === 'object' ? node[part] : {};
    node = node[part] as Record<string, unknown>;
  });
}

function allowedTree(paths: string[]): Record<string, unknown> {
  const root: Record<string, unknown> = {};
  for (const path of paths) setNested(root, path, true);
  return root;
}

function checkUnknownKeys(
  data: Record<string, unknown>,
  allowed: Record<string, unknown>,
  filePath: string,
  prefix = '',
): void {
  for (const key of Object.keys(data)) {
    const node = allowed[key];
    const full = prefix ? `${prefix}.${key}` : key;
    if (node === undefined) {
      process.stderr.write(`Предупреждение: неизвестное поле ${full} в ${filePath}\n`);
      continue;
    }
    const value = data[key];
    if (node !== true && typeof value === 'object' && value !== null && !Array.isArray(value)) {
      checkUnknownKeys(value as Record<string, unknown>, node as Record<string, unknown>, filePath, full);
    }
  }
}

const PROFILE_PATHS = SETTINGS_FIELDS.filter((f) => f.key !== 'token').map((f) => f.path);
const CREDENTIALS_PATHS = [fieldByKey('token').path];

function resolvePathValue(value: string, fileDir: string): string {
  if (value.startsWith('~')) return join(homedir(), value.slice(1));
  return isAbsolute(value) ? value : join(fileDir, value);
}

function numberFromEnv(field: SettingsField, raw: string): number {
  if (!/^-?\d+$/.test(raw)) {
    throw new ConfigError(`${field.envVar} должен быть целым числом, получено: ${raw}`);
  }
  return Number(raw);
}

function validateFileValue(field: SettingsField, value: unknown, filePath: string): void {
  if (field.type === 'number') {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      throw new ConfigError(`Поле ${field.path} должно быть числом: ${filePath}`);
    }
  } else if (field.type === 'string' && typeof value !== 'string') {
    throw new ConfigError(`Поле ${field.path} должно быть строкой: ${filePath}`);
  }
}

function asStringMap(value: unknown): Record<string, string> {
  if (typeof value !== 'object' || value === null) return {};
  return value as Record<string, string>;
}

function asTreeMap(value: unknown, filePath: string): Record<string, number | string> {
  const raw = asStringMap(value) as unknown as Record<string, unknown>;
  const out: Record<string, number | string> = {};
  for (const [k, v] of Object.entries(raw)) {
    const valid = (typeof v === 'number' && Number.isInteger(v)) || (typeof v === 'string' && v.trim() !== '');
    if (!valid) {
      throw new ConfigError(
        `Поле trees.${k} в ${filePath}: нужно название дерева разделов, его идентификатор или "none". Названия деревьев покажет tt-testops trees --project ${k}.`,
      );
    }
    out[k] = v as number | string;
  }
  return out;
}

export function resolveField(
  field: SettingsField,
  fileData: Record<string, unknown> | null,
  filePath: string,
  env: NodeJS.ProcessEnv,
): FieldResolution {
  if (field.envVar !== undefined && env[field.envVar] !== undefined) {
    const raw = env[field.envVar] as string;
    const value = field.type === 'number' ? numberFromEnv(field, raw) : raw;
    return { field, value, source: 'env', filePath };
  }
  const fromFile = fileData ? getByPath(fileData, field.path) : undefined;
  if (fromFile !== undefined) {
    validateFileValue(field, fromFile, filePath);
    const value =
      field.key === 'formatFile' && typeof fromFile === 'string'
        ? resolvePathValue(fromFile, dirname(filePath))
        : fromFile;
    return { field, value, source: 'file', filePath };
  }
  return { field, value: field.default, source: 'default', filePath };
}

function requireField(resolution: FieldResolution): unknown {
  const { field, filePath } = resolution;
  if (resolution.value === undefined && field.required) {
    throw new ConfigError(
      `Поле не задано: переменная ${field.envVar ?? '(нет)'} или поле ${field.path} файла ${filePath}.`,
    );
  }
  return resolution.value;
}

export interface ResolvedSettings {
  selection: ProfileSelection;
  resolutions: FieldResolution[];
}

export function resolveSettings(flags: ProfileFlags, env: NodeJS.ProcessEnv): ResolvedSettings {
  const selection = resolveProfile(flags, env);
  const profileData = readJson(selection.profileFile, 'Файл profile.json');
  const credentialsData = readJson(selection.credentialsFile, 'Файл credentials.json');
  if (profileData) checkUnknownKeys(profileData, allowedTree(PROFILE_PATHS), selection.profileFile);
  if (credentialsData) {
    checkUnknownKeys(credentialsData, allowedTree(CREDENTIALS_PATHS), selection.credentialsFile);
  }

  const resolutions = SETTINGS_FIELDS.map((field) =>
    field.key === 'token'
      ? resolveField(field, credentialsData, selection.credentialsFile, env)
      : resolveField(field, profileData, selection.profileFile, env),
  );
  return { selection, resolutions };
}

export function fieldValue(resolutions: FieldResolution[], key: string): FieldResolution {
  const found = resolutions.find((r) => r.field.key === key);
  if (!found) throw new Error(`Неизвестное поле настроек: ${key}`);
  return found;
}

export function loadConfig(
  flags: ProfileFlags = {},
  env: NodeJS.ProcessEnv = process.env,
): AppConfig {
  const { selection, resolutions } = resolveSettings(flags, env);
  const get = (key: string): FieldResolution => fieldValue(resolutions, key);

  return {
    baseUrl: requireField(get('baseUrl')) as string,
    token: requireField(get('token')) as string,
    defaultProjectId: get('defaultProject').value as number | undefined,
    projects: asStringMap(get('projects').value),
    people: asStringMap(get('people').value),
    trees: asTreeMap(get('trees').value, selection.profileFile),
    profileDir: selection.profileDir,
    profileFile: selection.profileFile,
    formatFile: get('formatFile').value as string | undefined,
  };
}

export function resolveProject(cfg: AppConfig, override?: number | string | null): number {
  if (override === undefined || override === null || override === '') {
    if (cfg.defaultProjectId === undefined) {
      throw new ConfigError(
        'Проект не задан. Передай его флагом --project или задай TT_TESTOPS_DEFAULT_PROJECT ' +
          '(поле defaultProject в profile.json).',
      );
    }
    return cfg.defaultProjectId;
  }
  if (typeof override === 'number') return override;
  if (/^\d+$/.test(override)) return Number(override);
  for (const [id, name] of Object.entries(cfg.projects)) {
    if (name === override) return Number(id);
  }
  const known = Object.entries(cfg.projects)
    .map(([id, name]) => `${name} (${id})`)
    .join(', ');
  throw new ConfigError(
    `Проекта «${override}» нет в конфигурации. ${
      known ? `Известные: ${known}.` : 'Словарь projects пуст.'
    } Номер проекта тоже подходит: --project <номер>.`,
  );
}
