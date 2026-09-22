import { describe, expect, it } from 'vitest';
import { auditCase } from '../src/audit.js';
import { normalizeCase } from '../src/normalize.js';
import { defaultProfile } from '../src/profile.js';
import { currentFormat, emptyScenario, oldInlineSteps, oldRawMarkdown } from './fixtures.js';

const findings = (raw: Parameters<typeof normalizeCase>[0]) =>
  auditCase(normalizeCase(raw, defaultProfile), raw).map((f) => f.ruleId);

describe('auditCase', () => {
  it('flags a raw-markdown scenario on a case not declared manual', () => {
    expect(findings(oldRawMarkdown)).toContain('oldRawMarkdown');
  });

  it('ссылка на постороннюю систему пометкой не сопровождается', () => {
    expect(findings(oldRawMarkdown)).toEqual(['oldRawMarkdown']);
  });

  it('flags inline old-format steps the same way', () => {
    expect(findings(oldInlineSteps)).toContain('oldRawMarkdown');
  });

  it('flags a case with no scenario at all', () => {
    expect(findings(emptyScenario)).toContain('emptyScenario');
  });

  it('says nothing about the format of a healthy case', () => {
    const ids = findings(currentFormat);
    expect(ids).not.toContain('oldRawMarkdown');
    expect(ids).not.toContain('emptyScenario');
  });

  it('leaves a healthy case with no findings at all', () => {
    expect(findings(currentFormat)).toEqual([]);
  });

});
