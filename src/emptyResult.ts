import { QueryError } from './errors.js';
import {
  describeChoices,
  extractCfConditions,
  extractLayerValues,
  findSimilar,
  replaceFieldName,
  replaceValue,
} from './queryCheck.js';
import type { CustomField, CustomFieldValue, TestLayer } from './testops/client.js';

export type EmptyOutcome =
  | { kind: 'repair'; rql: string; note: string }
  | { kind: 'error'; message: string };

export interface EmptyDeps {
  fetchCustomFields(projectId: number): Promise<CustomField[]>;
  fetchFieldValues(projectId: number, fieldId: number): Promise<CustomFieldValue[]>;
  fetchLayers(): Promise<TestLayer[]>;
}

type Fix = { kind: 'field' | 'value'; field: string | null; from: string; to: string };

interface Scan {
  fixes: Fix[];
  error?: string;
}

function match(wanted: string, all: string[]): { exact: boolean; similar: string[] } {
  if (all.includes(wanted)) return { exact: true, similar: [] };
  return { exact: false, similar: findSimilar(wanted, all) };
}

async function scanLayers(deps: EmptyDeps, values: string[]): Promise<Scan | null> {
  if (!values.length) return { fixes: [] };
  let layers: TestLayer[];
  try {
    layers = await deps.fetchLayers();
  } catch {
    return null;
  }
  const names = layers.map((l) => l.name);
  const fixes: Fix[] = [];
  for (const value of values) {
    const { exact, similar } = match(value, names);
    if (exact) continue;
    if (similar.length === 1 && similar[0] !== undefined) {
      fixes.push({ kind: 'value', field: null, from: value, to: similar[0] });
      continue;
    }
    return {
      fixes,
      error: [
        `Кейсов не найдено, потому что слоя «${value}» на сервере нет.`,
        describeChoices(similar, names),
      ].join('\n'),
    };
  }
  return { fixes };
}

async function scanFields(deps: EmptyDeps, rql: string, projectId: number): Promise<Scan | null> {
  const conditions = extractCfConditions(rql);
  if (!conditions.length) return { fixes: [] };
  let fields: CustomField[];
  try {
    fields = await deps.fetchCustomFields(projectId);
  } catch {
    return null;
  }
  const names = fields.map((f) => f.name);
  const fixes: Fix[] = [];
  for (const condition of conditions) {
    const byName = match(condition.field, names);
    let fieldName = condition.field;
    if (!byName.exact) {
      const only = byName.similar.length === 1 ? byName.similar[0] : undefined;
      if (only === undefined) {
        return {
          fixes,
          error: [
            `Кейсов не найдено, потому что поля «${condition.field}» в проекте ${projectId} нет.`,
            describeChoices(byName.similar, names),
          ].join('\n'),
        };
      }
      fixes.push({ kind: 'field', field: null, from: condition.field, to: only });
      fieldName = only;
    }
    const field = fields.find((f) => f.name === fieldName);
    if (!field || !condition.value) continue;
    let values: CustomFieldValue[];
    try {
      values = await deps.fetchFieldValues(projectId, field.id);
    } catch {
      return null;
    }
    const all = values.map((v) => v.name);
    const byValue = match(condition.value, all);
    if (byValue.exact) continue;
    if (byValue.similar.length === 1 && byValue.similar[0] !== undefined) {
      fixes.push({
        kind: 'value',
        field: field.name,
        from: condition.value,
        to: byValue.similar[0],
      });
      continue;
    }
    return {
      fixes,
      error: [
        `Кейсов не найдено, потому что у поля «${field.name}» нет значения «${condition.value}».`,
        describeChoices(byValue.similar, all),
      ].join('\n'),
    };
  }
  return { fixes };
}

function applied(rql: string, fixes: Fix[]): string {
  let out = rql;
  for (const fix of fixes) {
    out =
      fix.kind === 'field'
        ? replaceFieldName(out, fix.from, fix.to)
        : replaceValue(out, fix.field, fix.from, fix.to);
  }
  return out;
}

export async function countWithRepair(
  deps: EmptyDeps & { countCases(rql: string, projectId: number): Promise<number> },
  rql: string,
  projectId: number,
  onWarn: (message: string) => void,
): Promise<number> {
  const count = await deps.countCases(rql, projectId);
  if (count > 0) return count;
  const outcome = await inspectEmpty(deps, rql, projectId);
  if (!outcome) return 0;
  if (outcome.kind === 'error') throw new QueryError(outcome.message);
  onWarn(outcome.note);
  return deps.countCases(outcome.rql, projectId);
}

export async function inspectEmpty(
  deps: EmptyDeps,
  rql: string,
  projectId: number,
): Promise<EmptyOutcome | null> {
  const scans: Scan[] = [];
  for (const scan of [
    await scanLayers(deps, extractLayerValues(rql)),
    await scanFields(deps, rql, projectId),
  ]) {
    if (scan !== null) scans.push(scan);
  }
  if (!scans.length) return null;
  const error = scans.find((s) => s.error)?.error;
  if (error) return { kind: 'error', message: error };
  const fixes = scans.flatMap((s) => s.fixes);
  if (!fixes.length) return null;
  return {
    kind: 'repair',
    rql: applied(rql, fixes),
    note: `запрос исправлен: ${fixes.map((f) => `«${f.from}» → «${f.to}»`).join('; ')}`,
  };
}
