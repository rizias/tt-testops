import { describe, expect, it } from 'vitest';
import { renderRawCase } from '../src/index.js';
import { defaultProfile } from '../src/profile.js';
import { renderBatch } from '../src/render.js';
import { allSamples, currentFormat, oldInlineSteps } from './fixtures.js';

const HEADER = /^# \*\*(.*?)\*\* \(ID: ([^)]+)\)$/;

function parseHeader(md: string): { title?: string; id?: string; sections: string[] } {
  const lines = md.replace(/\r\n/g, '\n').split('\n');
  const m = (lines[0] ?? '').match(HEADER);
  const sections = lines.filter((l) => l.startsWith('### ')).map((l) => l.slice(4));
  return { title: m?.[1], id: m?.[2], sections };
}

describe('round-trip canary — output parses for both consumers', () => {
  for (const raw of allSamples) {
    it(`кейс ${raw.overview.id}: шапка и разделы разбираются`, () => {
      const { title, id, sections } = parseHeader(renderRawCase(raw));
      expect(id).toBe(String(raw.overview.id));
      expect(title).toBeTruthy();
      expect(sections).toContain('Сценарий');
    });
  }

  it('пачка делится по разделителю', () => {
    const cs = [currentFormat, oldInlineSteps];
    const batch = renderBatch(cs, defaultProfile, 'https://testops.example');
    expect(batch).toContain('### 📊 Сводка по запросу');
    expect(batch).not.toContain('КОНЕЦ-КЕЙСА');
    expect(batch.match(/^# \*\*.*\*\* \(ID: /gm)).toHaveLength(cs.length);
  });

  it('PARSE_CRITICAL_KEYS frozen', () => {
    expect(defaultProfile.sections).toEqual({
      description: '### Описание',
      precondition: '### Предварительное условие',
      scenario: '### Сценарий',
      expectedResult: '### Ожидаемый результат',
    });
    expect(defaultProfile.warnings.emptyScenario).toContain('Нет шагов');
    expect(defaultProfile.steps.indent).toBe('  ');
  });
});

const CONSUMER_STEP = /^(\s*)(?:-|\d+\.)\s+(.+)$/;

function parseSteps(md: string): Array<{ nesting: number; text: string }> {
  const scenario = md.split('### Сценарий')[1]?.split('### ')[0] ?? '';
  const out: Array<{ nesting: number; text: string }> = [];
  for (const line of scenario.split('\n')) {
    const m = CONSUMER_STEP.exec(line);
    if (m) out.push({ nesting: (m[1]?.length ?? 0) / 2, text: (m[2] ?? '').trim() });
  }
  return out;
}

describe('consumer step parser handles both marker shapes', () => {
  const head = '# **Кейс** (ID: 1)\n\n### Сценарий\n';
  const numbered = `${head}1. Открыть\n  1. Проверить\n`;
  const bulleted = `${head}- Открыть\n  - Проверить\n`;

  it('reads numbered steps', () => {
    expect(parseSteps(numbered).map((s) => s.text)).toEqual(['Открыть', 'Проверить']);
  });

  it('reads bulleted steps', () => {
    expect(parseSteps(bulleted).map((s) => s.text)).toEqual(['Открыть', 'Проверить']);
  });

  it('gives the same nesting for both', () => {
    expect(parseSteps(numbered).map((s) => s.nesting)).toEqual([0, 1]);
    expect(parseSteps(numbered)).toEqual(parseSteps(bulleted));
  });

  it('numbering is what this tool actually emits by default', () => {
    expect(defaultProfile.steps.numbered).toBe(true);
  });
});
