import type { RawCase } from './model.js';
import { normalizeCase } from './normalize.js';
import { defaultProfile, type FormatProfile } from './profile.js';
import { renderCase } from './render.js';

export { type AuditFinding, type AuditRules, auditCase, defaultAuditRules } from './audit.js';
export {
  absolutizeImages,
  type ResolveDeps,
  renderBatchResolved,
  renderResolved,
  resolveScenario,
  resolveToTestCase,
} from './contentResolver.js';
export { Gateway } from './gateway.js';
export { type JsonCase, toJson } from './json.js';
export type { RawCase, TestCase, TestCaseAttribute } from './model.js';
export { normalizeCase } from './normalize.js';
export { defaultProfile, type FormatProfile, loadProfile } from './profile.js';
export { idsOnly } from './queryCheck.js';
export { renderBatch, renderCase } from './render.js';
export { buildSources, type QueryToken, type Source } from './sources.js';

export function renderRawCase(raw: RawCase, profile: FormatProfile = defaultProfile): string {
  return renderCase(normalizeCase(raw, profile), profile);
}
