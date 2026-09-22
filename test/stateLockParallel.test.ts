import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { CLI, run } from './cliRunner.js';

let home: string;
let counterDir: string;

afterEach(() => {
  if (home) rmSync(home, { recursive: true, force: true });
  if (counterDir) rmSync(counterDir, { recursive: true, force: true });
});

function spawnCli(args: string[], env: NodeJS.ProcessEnv): Promise<{ code: number; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [CLI, ...args], {
      env: { ...process.env, ...env },
    });
    let stderr = '';
    child.stderr.on('data', (chunk) => {
      stderr += String(chunk);
    });
    child.on('error', reject);
    child.on('close', (code) => resolve({ code: code ?? 1, stderr }));
  });
}

describe('параллельная запись общего состояния через CLI', () => {
  it('8 параллельных config init создают все профили, config.json остаётся валидным', async () => {
    home = mkdtempSync(join(tmpdir(), 'tt-lock-parallel-home-'));
    const env = { HOME: home, USERPROFILE: home };
    await run(['config', 'init'], env);

    const profileNames = Array.from({ length: 8 }, (_, i) => `p${i}`);
    const initResults = await Promise.all(
      profileNames.map((name) => spawnCli(['config', 'init', '--profile', name], env)),
    );
    for (const result of initResults) expect(result.code).toBe(0);

    for (const name of profileNames) {
      const profileFile = join(home, '.tt-testops', 'profiles', name, 'profile.json');
      const credentialsFile = join(home, '.tt-testops', 'profiles', name, 'credentials.json');
      expect(existsSync(profileFile)).toBe(true);
      expect(existsSync(credentialsFile)).toBe(true);
      expect(() => JSON.parse(readFileSync(profileFile, 'utf8'))).not.toThrow();
      expect(readFileSync(credentialsFile, 'utf8').length).toBeGreaterThan(0);
    }

    const common = join(home, '.tt-testops', 'config.json');
    expect(() => JSON.parse(readFileSync(common, 'utf8'))).not.toThrow();

    const useResults = await Promise.all(
      profileNames.map((name) => spawnCli(['config', 'use', name], env)),
    );
    for (const result of useResults) expect(result.code).toBe(0);

    const afterUse = JSON.parse(readFileSync(common, 'utf8')) as { profile: string };
    expect(profileNames).toContain(afterUse.profile);
    expect(readFileSync(common, 'utf8').length).toBeGreaterThan(0);
  }, 60_000);
});

describe('замок хранилища выдерживает параллельные процессы напрямую', () => {
  it('8 процессов по 10 приращений дают ровно 80', async () => {
    counterDir = mkdtempSync(join(tmpdir(), 'tt-lock-counter-'));
    mkdirSync(counterDir, { recursive: true });
    const fixture = join(process.cwd(), 'test', 'fixtures', 'stateLockCounter.mjs');
    const runs = Array.from({ length: 8 }, () =>
      new Promise<number>((resolve, reject) => {
        const child = spawn(process.execPath, [fixture, counterDir, '10']);
        let stderr = '';
        child.stderr.on('data', (chunk) => {
          stderr += String(chunk);
        });
        child.on('error', reject);
        child.on('close', (code) => {
          if (code !== 0) reject(new Error(`fixture failed: ${stderr}`));
          else resolve(code);
        });
      }),
    );
    await Promise.all(runs);
    const counterFile = join(counterDir, 'counter.json');
    const counter = JSON.parse(readFileSync(counterFile, 'utf8')) as { count: number };
    expect(counter.count).toBe(80);
  }, 60_000);
});
