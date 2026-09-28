import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { ConfigError } from './errors.js';

export type ProfileSource = 'flag' | 'env' | 'config' | 'default';

export interface ProfileSelection {
  stateDir: string;
  commonConfigFile: string;
  profileName: string | null;
  profileDir: string;
  profileFile: string;
  credentialsFile: string;
  source: ProfileSource;
}

export interface ProfileFlags {
  profile?: string;
}

export function homeDirFrom(env: NodeJS.ProcessEnv): string {
  const fromEnv = process.platform === 'win32' ? env.USERPROFILE : env.HOME;
  return fromEnv || homedir();
}

export function stateDir(env: NodeJS.ProcessEnv = process.env): string {
  return join(homeDirFrom(env), '.tt-testops');
}

export function commonConfigFile(env: NodeJS.ProcessEnv = process.env): string {
  return join(stateDir(env), 'config.json');
}

export function profileDirFor(name: string, env: NodeJS.ProcessEnv = process.env): string {
  return join(stateDir(env), 'profiles', name);
}

export function filesForProfile(profileDir: string): { profileFile: string; credentialsFile: string } {
  return {
    profileFile: join(profileDir, 'profile.json'),
    credentialsFile: join(profileDir, 'credentials.json'),
  };
}

export function readCommonConfig(env: NodeJS.ProcessEnv): Record<string, unknown> | null {
  const path = commonConfigFile(env);
  if (!existsSync(path)) return null;
  let data: unknown;
  try {
    data = JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    throw new ConfigError(`Общий файл настроек повреждён (не JSON): ${path}`);
  }
  if (typeof data !== 'object' || data === null || Array.isArray(data)) {
    throw new ConfigError(`Общий файл настроек должен быть объектом JSON: ${path}`);
  }
  return data as Record<string, unknown>;
}

function readCommonProfileName(env: NodeJS.ProcessEnv): string | null {
  const profile = readCommonConfig(env)?.profile;
  return typeof profile === 'string' && profile !== '' ? profile : null;
}

function namedProfileDir(name: string, selectedBy: string, env: NodeJS.ProcessEnv): string {
  const profileDir = profileDirFor(name, env);
  if (name !== 'default' && !existsSync(profileDir)) {
    throw new ConfigError(`Профиль «${name}» из ${selectedBy} не найден: ${profileDir}`);
  }
  return profileDir;
}

export function resolveProfile(flags: ProfileFlags, env: NodeJS.ProcessEnv): ProfileSelection {
  const common = commonConfigFile(env);
  const shared = { stateDir: stateDir(env), commonConfigFile: common };

  if (flags.profile) {
    const profileDir = profileDirFor(flags.profile, env);
    if (!existsSync(profileDir)) {
      throw new ConfigError(`Профиль «${flags.profile}» не найден: ${profileDir}`);
    }
    return { ...shared, ...filesForProfile(profileDir), profileName: flags.profile, profileDir, source: 'flag' };
  }

  if (env.TT_TESTOPS_PROFILE) {
    const name = env.TT_TESTOPS_PROFILE;
    const profileDir = namedProfileDir(name, 'переменной TT_TESTOPS_PROFILE', env);
    return { ...shared, ...filesForProfile(profileDir), profileName: name, profileDir, source: 'env' };
  }

  const fromCommon = readCommonProfileName(env);
  if (fromCommon) {
    const profileDir = namedProfileDir(fromCommon, `поля profile файла ${common}`, env);
    return { ...shared, ...filesForProfile(profileDir), profileName: fromCommon, profileDir, source: 'config' };
  }

  const profileDir = profileDirFor('default', env);
  return { ...shared, ...filesForProfile(profileDir), profileName: 'default', profileDir, source: 'default' };
}
