import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config.js';

let home: string;

afterEach(() => {
  if (home) rmSync(home, { recursive: true, force: true });
});

function baseHome(): { home: string; dir: string } {
  home = mkdtempSync(join(tmpdir(), 'tt-errors-home-'));
  const dir = join(home, '.tt-testops', 'profiles', 'default');
  mkdirSync(dir, { recursive: true });
  return { home, dir };
}

function envFor(h: string, extra: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  return { HOME: h, USERPROFILE: h, ...extra } as NodeJS.ProcessEnv;
}

describe('повреждённые файлы настроек', () => {
  it('битый JSON в profile.json завершается ошибкой с путём файла', () => {
    const { dir } = baseHome();
    writeFileSync(join(dir, 'profile.json'), '{ не json', 'utf8');
    writeFileSync(join(dir, 'credentials.json'), '{}', 'utf8');
    expect(() => loadConfig({}, envFor(home))).toThrow(join(dir, 'profile.json'));
  });

  it('неизвестное поле в profile.json завершается ошибкой с путём файла', () => {
    const { dir } = baseHome();
    writeFileSync(
      join(dir, 'profile.json'),
      JSON.stringify({ servers: { testops: { baseUrl: 'https://testops.example' } }, лишнее: 1 }),
      'utf8',
    );
    writeFileSync(join(dir, 'credentials.json'), JSON.stringify({ testops: { token: 'secret-token-value' } }), 'utf8');
    expect(() => loadConfig({}, envFor(home))).toThrow(join(dir, 'profile.json'));
  });

  it('неверный тип поля завершается ошибкой с путём файла', () => {
    const { dir } = baseHome();
    writeFileSync(
      join(dir, 'profile.json'),
      JSON.stringify({ servers: { testops: { baseUrl: 'https://testops.example' } }, limits: { maxCases: 'много' } }),
      'utf8',
    );
    writeFileSync(join(dir, 'credentials.json'), JSON.stringify({ testops: { token: 'secret-token-value' } }), 'utf8');
    expect(() => loadConfig({}, envFor(home))).toThrow(join(dir, 'profile.json'));
  });

  it('поле trees с названием дерева принимается, с иным видом значения — ошибка с путём файла', () => {
    const { dir } = baseHome();
    const profile = (trees: unknown) =>
      writeFileSync(
        join(dir, 'profile.json'),
        JSON.stringify({ servers: { testops: { baseUrl: 'https://testops.example' } }, trees }),
        'utf8',
      );
    writeFileSync(join(dir, 'credentials.json'), JSON.stringify({ testops: { token: 'secret-token-value' } }), 'utf8');

    profile({ '7': 'Разделы', '8': 41, '9': 'none' });
    expect(loadConfig({}, envFor(home)).trees).toEqual({ '7': 'Разделы', '8': 41, '9': 'none' });

    profile({ '7': true });
    expect(() => loadConfig({}, envFor(home))).toThrow(join(dir, 'profile.json'));
    expect(() => loadConfig({}, envFor(home))).toThrow('trees.7');
  });

  it('значение вне диапазона в файле завершается ошибкой с путём файла', () => {
    const { dir } = baseHome();
    writeFileSync(
      join(dir, 'profile.json'),
      JSON.stringify({ servers: { testops: { baseUrl: 'https://testops.example' } }, limits: { concurrency: 0 } }),
      'utf8',
    );
    writeFileSync(join(dir, 'credentials.json'), JSON.stringify({ testops: { token: 'secret-token-value' } }), 'utf8');
    expect(() => loadConfig({}, envFor(home))).toThrow(join(dir, 'profile.json'));
  });

  it('файл не в UTF-8 завершается ошибкой с путём файла', () => {
    const { dir } = baseHome();
    writeFileSync(join(dir, 'profile.json'), Buffer.from([0x7b, 0x22, 0xff, 0xfe, 0x22, 0x7d]));
    writeFileSync(join(dir, 'credentials.json'), JSON.stringify({ testops: { token: 'secret-token-value' } }), 'utf8');
    expect(() => loadConfig({}, envFor(home))).toThrow(join(dir, 'profile.json'));
  });

  it('обязательное поле не задано — сообщение называет переменную и путь поля в файле', () => {
    const { dir } = baseHome();
    writeFileSync(join(dir, 'profile.json'), '{}', 'utf8');
    writeFileSync(join(dir, 'credentials.json'), JSON.stringify({ testops: { token: 'secret-token-value' } }), 'utf8');
    expect(() => loadConfig({}, envFor(home))).toThrow(
      /TT_TESTOPS_SERVER_TESTOPS_BASE_URL.*servers\.testops\.baseUrl/s,
    );
  });

  it('сервер без записи токена в credentials.json — сообщение называет путь файла', () => {
    const { dir } = baseHome();
    writeFileSync(
      join(dir, 'profile.json'),
      JSON.stringify({ servers: { testops: { baseUrl: 'https://testops.example' } } }),
      'utf8',
    );
    writeFileSync(join(dir, 'credentials.json'), '{}', 'utf8');
    expect(() => loadConfig({}, envFor(home))).toThrow(join(dir, 'credentials.json'));
  });
});
