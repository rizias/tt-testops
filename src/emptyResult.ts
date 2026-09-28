import { QueryError } from './errors.js';
import {
  describeChoices,
  extractCfConditions,
  extractLayerValues,
  findSimilar,
} from './queryCheck.js';
import type { CustomField, CustomFieldValue, SearchQuery, TestLayer } from './testops/client.js';

export interface EmptyDeps {
  fetchCustomFields(projectId: number): Promise<CustomField[]>;
  fetchFieldValues(projectId: number, fieldId: number): Promise<CustomFieldValue[]>;
  fetchLayers(): Promise<TestLayer[]>;
}

function absent(wanted: string, all: string[], lead: string): string | null {
  if (all.includes(wanted)) return null;
  return [lead, describeChoices(findSimilar(wanted, all), all)].join('\n');
}

async function checkLayers(deps: EmptyDeps, values: string[]): Promise<string | null> {
  if (!values.length) return null;
  let layers: TestLayer[];
  try {
    layers = await deps.fetchLayers();
  } catch {
    return null;
  }
  const names = layers.map((l) => l.name);
  for (const value of values) {
    const error = absent(value, names, `Кейсов не найдено, потому что слоя «${value}» на сервере нет.`);
    if (error) return error;
  }
  return null;
}

async function checkFields(deps: EmptyDeps, rql: string, projectId: number): Promise<string | null> {
  const conditions = extractCfConditions(rql);
  if (!conditions.length) return null;
  let fields: CustomField[];
  try {
    fields = await deps.fetchCustomFields(projectId);
  } catch {
    return null;
  }
  const names = fields.map((f) => f.name);
  for (const condition of conditions) {
    const noField = absent(
      condition.field,
      names,
      `Кейсов не найдено, потому что поля «${condition.field}» в проекте ${projectId} нет.`,
    );
    if (noField) return noField;
    const field = fields.find((f) => f.name === condition.field);
    if (!field || !condition.value) continue;
    let values: CustomFieldValue[];
    try {
      values = await deps.fetchFieldValues(projectId, field.id);
    } catch {
      return null;
    }
    const noValue = absent(
      condition.value,
      values.map((v) => v.name),
      `Кейсов не найдено, потому что у поля «${field.name}» нет значения «${condition.value}».`,
    );
    if (noValue) return noValue;
  }
  return null;
}

export async function explainEmpty(deps: EmptyDeps, rql: string, projectId: number): Promise<void> {
  const error =
    (await checkLayers(deps, extractLayerValues(rql))) ?? (await checkFields(deps, rql, projectId));
  if (error) throw new QueryError(error);
}

export async function countOrExplain(
  deps: EmptyDeps & { countCases(query: SearchQuery, projectId: number): Promise<number> },
  query: SearchQuery,
  projectId: number,
): Promise<number> {
  const count = await deps.countCases(query, projectId);
  if (count === 0) await explainEmpty(deps, query.rql, projectId);
  return count;
}
