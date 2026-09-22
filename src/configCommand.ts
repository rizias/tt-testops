import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { resolveSettings } from './config.js';
import { ConfigError, CacheError } from './errors.js';
import {
  commonConfigFile,
  filesForProfile,
  profileDirFor,
  resolveProfile,
  stateDir,
  type ProfileFlags,
} from './settingsPaths.js';
import { SETTINGS_FIELDS } from './settingsSchema.js';
import { withLock, writeAtomic } from './stateLock.js';

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function setNested(target: Record<string, unknown>, path: string, value: unknown): void {
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

function defaultProfileJson(): Record<string, unknown> {
  const obj: Record<string, unknown> = {};
  for (const field of SETTINGS_FIELDS) {
    if (field.key === 'token' || field.default === undefined) continue;
    setNested(obj, field.path, field.default);
  }
  return obj;
}

function createExclusive(path: string, content: string, mode?: number): boolean {
  try {
    writeFileSync(path, content, mode === undefined ? { flag: 'wx' } : { flag: 'wx', mode });
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') return false;
    throw new CacheError(`Не удалось создать файл настроек: ${errorText(error)}: ${path}`);
  }
}

export async function configInit(
  profileName = 'default',
  env: NodeJS.ProcessEnv = process.env,
): Promise<{ created: string[] }> {
  return withLock(stateDir(env), () => {
    const created: string[] = [];
    const common = commonConfigFile(env);
    if (createExclusive(common, `${JSON.stringify({ profile: 'default' }, null, 2)}\n`)) {
      created.push(common);
    }
    const profileDir = profileDirFor(profileName, env);
    mkdirSync(profileDir, { recursive: true });
    const { profileFile, credentialsFile } = filesForProfile(profileDir);
    if (createExclusive(profileFile, `${JSON.stringify(defaultProfileJson(), null, 2)}\n`)) {
      created.push(profileFile);
    }
    const mode = process.platform === 'win32' ? undefined : 0o600;
    if (createExclusive(credentialsFile, `${JSON.stringify({}, null, 2)}\n`, mode)) {
      created.push(credentialsFile);
    }
    return { created };
  });
}

export async function configUse(
  profileName: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<void> {
  const profileDir = profileDirFor(profileName, env);
  if (!existsSync(profileDir)) {
    throw new ConfigError(`Профиль «${profileName}» не найден: ${profileDir}`);
  }
  await withLock(stateDir(env), () => {
    const common = commonConfigFile(env);
    let data: Record<string, unknown> = {};
    if (existsSync(common)) {
      try {
        data = JSON.parse(readFileSync(common, 'utf8'));
      } catch {
        data = {};
      }
    }
    data.profile = profileName;
    writeAtomic(stateDir(env), 'config.json', `${JSON.stringify(data, null, 2)}\n`);
  });
}

export interface ProfileListing {
  name: string;
  description?: string;
  current: boolean;
}

export function configProfiles(env: NodeJS.ProcessEnv): ProfileListing[] {
  const profilesRoot = join(stateDir(env), 'profiles');
  let names: string[] = [];
  try {
    names = readdirSync(profilesRoot, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name);
  } catch {
    names = [];
  }
  const selection = resolveProfile({}, env);
  return names.sort().map((name) => {
    let description: string | undefined;
    try {
      const data = JSON.parse(readFileSync(join(profilesRoot, name, 'profile.json'), 'utf8')) as {
        description?: unknown;
      };
      description = typeof data.description === 'string' ? data.description : undefined;
    } catch {
      description = undefined;
    }
    return { name, description, current: name === selection.profileName };
  });
}

export interface ConfigFieldView {
  key: string;
  path: string;
  value: unknown;
  source: string;
  secretSet?: boolean;
}

export interface ConfigView {
  commonConfigFile: string;
  profileName: string | null;
  profileSource: string;
  profileFile: string;
  credentialsFile: string;
  fields: ConfigFieldView[];
}

export function configView(flags: ProfileFlags, env: NodeJS.ProcessEnv): ConfigView {
  const { selection, resolutions } = resolveSettings(flags, env);
  const fields = resolutions.map((r) => ({
    key: r.field.key,
    path: r.field.path,
    value: r.field.secret ? undefined : r.value,
    source: r.source,
    ...(r.field.secret ? { secretSet: r.value !== undefined && r.value !== '' } : {}),
  }));
  return {
    commonConfigFile: selection.commonConfigFile,
    profileName: selection.profileName,
    profileSource: selection.source,
    profileFile: selection.profileFile,
    credentialsFile: selection.credentialsFile,
    fields,
  };
}

export function renderConfigText(view: ConfigView): string {
  const lines = [
    `Общий файл: ${view.commonConfigFile}`,
    `Профиль: ${view.profileName ?? '(не определён)'} (${view.profileSource})`,
    `profile.json: ${view.profileFile}`,
    `credentials.json: ${view.credentialsFile}`,
    '',
  ];
  for (const f of view.fields) {
    lines.push(
      f.secretSet !== undefined
        ? `${f.path}: ${f.secretSet ? 'задан' : 'не задан'} (${f.source})`
        : `${f.path}: ${JSON.stringify(f.value)} (${f.source})`,
    );
  }
  return lines.join('\n');
}

export function renderProfilesText(list: ProfileListing[]): string {
  if (!list.length) return 'Профилей нет.';
  return list
    .map((p) => `${p.current ? '*' : ' '} ${p.name}${p.description ? ` — ${p.description}` : ''}`)
    .join('\n');
}

