import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { TestCase } from '../src/model.js';
import { defaultProfile, loadProfile } from '../src/profile.js';
import { renderCase } from '../src/render.js';

describe('профиль оформления проверяется', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'tt-profile-'));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('испорченное обязательное поле — отказ с именем поля', () => {
    const path = join(dir, 'profile.json');
    writeFileSync(path, JSON.stringify({ steps: { indent: 42 } }), 'utf8');
    expect(() => loadProfile(path)).toThrow(/steps\.indent/);
  });

  it('здоровый профиль принимается', () => {
    const path = join(dir, 'ok.json');
    writeFileSync(path, JSON.stringify({ showMarks: false }), 'utf8');
    expect(loadProfile(path).showMarks).toBe(false);
  });
});

describe('порядок разделов задаётся профилем', () => {
  const tc = {
    id: '1',
    name: 'Кейс',
    path: [],
    status: 'Active',
    automated: false,
    layer: 'Web',
    tags: [],
    links: [],
    linkRefs: [],
    attributes: [],
    isLegacy: false,
    declaredManual: false,
    description: 'Опис',
    precondition: 'Предус',
    expectedResult: 'Итог',
    scenarioLines: ['1. Шаг'],
  } as unknown as TestCase;

  it('по умолчанию — исторический порядок', () => {
    const out = renderCase(tc, defaultProfile);
    expect(out.indexOf('### Описание')).toBeLessThan(out.indexOf('### Сценарий'));
    expect(out.indexOf('### Сценарий')).toBeLessThan(out.indexOf('### Ожидаемый результат'));
  });

  it('переставленный порядок меняет вывод без правки кода', () => {
    const out = renderCase(tc, {
      ...defaultProfile,
      sectionOrder: ['scenario', 'description', 'precondition', 'expectedResult'],
    });
    expect(out.indexOf('### Сценарий')).toBeLessThan(out.indexOf('### Описание'));
  });
});

describe('профиль с неверным типом поля', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'tt-prof6-'));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('отвергается с именем поля', () => {
    const path = join(dir, 'p.json');
    writeFileSync(path, JSON.stringify({ contractVersion: '2.0', removeLinks: 'да' }), 'utf8');
    expect(() => loadProfile(path)).toThrow(/removeLinks/);
  });

  it('переставленный порядок под историческим контрактом отвергается', () => {
    const path = join(dir, 'order.json');
    writeFileSync(path, JSON.stringify({ sectionOrder: ['scenario', 'description'] }), 'utf8');
    expect(() => loadProfile(path)).toThrow(/sectionOrder/);
  });
});
