import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export const CLI = join(process.cwd(), 'dist', 'cli.js');
export const PACKAGE_SKILL = join(process.cwd(), 'skills', 'tt-testops', 'SKILL.md');

export interface Run {
  code: number;
  stdout: string;
  stderr: string;
}

export interface ProfileOptions {
  baseUrl?: string;
  token?: string;
  projects?: Record<string, string>;
}

export function makeProfileHome(options: ProfileOptions = {}): string {
  const home = mkdtempSync(join(tmpdir(), 'tt-cli-home-'));
  const profileDir = join(home, '.tt-testops', 'profiles', 'default');
  mkdirSync(profileDir, { recursive: true });
  writeFileSync(
    join(home, '.tt-testops', 'config.json'),
    JSON.stringify({ profile: 'default' }),
    'utf8',
  );
  writeFileSync(
    join(profileDir, 'profile.json'),
    JSON.stringify({
      servers: { testops: { baseUrl: options.baseUrl ?? 'https://ts.example' } },
      projects: options.projects ?? { '1': 'WEB' },
    }),
    'utf8',
  );
  writeFileSync(
    join(profileDir, 'credentials.json'),
    JSON.stringify({ testops: { token: options.token ?? 'токен' } }),
    'utf8',
  );
  return home;
}

export const sandbox = mkdtempSync(join(tmpdir(), 'tt-cli-env-'));
export const CLI_HOME = makeProfileHome();

export function run(args: string[], env: NodeJS.ProcessEnv = {}): Run {
  const r = spawnSync(process.execPath, [CLI, ...args], {
    encoding: 'utf8',
    env: {
      ...process.env,
      HOME: CLI_HOME,
      USERPROFILE: CLI_HOME,
      ...env,
    },
  });
  return { code: r.status ?? 1, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}
