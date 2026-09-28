import { findSimilar } from './queryCheck.js';
import type {
  CustomField,
  CustomFieldValue,
  SearchQuery,
  ServerProject,
  TestLayer,
} from './testops/client.js';

export interface FieldSummary {
  name: string;
  values: number;
}

export interface ProjectOverview {
  fields: FieldSummary[];
  layers: CustomFieldValue[];
}

export interface FoundValue {
  condition: string;
  cases: number;
}

export interface ProjectReport {
  serverReachable: boolean;
  serverError: string | null;
  agreed: Array<{ id: number; name: string; onServer: boolean | null }>;
  notInConfig: ServerProject[];
}

export interface ReferenceDeps {
  fetchCustomFields(projectId: number): Promise<CustomField[]>;
  fetchFieldValues(projectId: number, fieldId: number): Promise<CustomFieldValue[]>;
  fetchFieldValueCount(projectId: number, fieldId: number): Promise<number>;
  searchFieldValues(projectId: number, fieldId: number, query: string): Promise<CustomFieldValue[]>;
  fetchLayers(): Promise<TestLayer[]>;
  countCases(query: SearchQuery, projectId: number): Promise<number>;
}

export const LAYER_FIELD = 'layer';

export function isLayerField(name: string): boolean {
  return name.trim().toLowerCase() === LAYER_FIELD;
}

export async function layerUsage(
  deps: ReferenceDeps,
  projectId: number,
  only?: TestLayer[],
): Promise<CustomFieldValue[]> {
  const layers = only ?? (await deps.fetchLayers());
  const counted = await Promise.all(
    layers.map(async (l) => ({
      name: l.name,
      testCasesCount: await deps.countCases({ rql: `layer = "${l.name}"` }, projectId),
    })),
  );
  return counted.sort((a, b) => b.testCasesCount - a.testCasesCount);
}

export async function projectOverview(
  deps: ReferenceDeps,
  projectId: number,
): Promise<ProjectOverview> {
  const fields = await deps.fetchCustomFields(projectId);
  const summaries = await Promise.all(
    fields.map(async (f) => ({
      name: f.name,
      values: await deps.fetchFieldValueCount(projectId, f.id),
    })),
  );
  return {
    fields: summaries.sort((a, b) => b.values - a.values),
    layers: await layerUsage(deps, projectId),
  };
}

function contains(haystack: string, needle: string): boolean {
  return haystack.toLowerCase().includes(needle.toLowerCase());
}

async function foundLayers(
  deps: ReferenceDeps,
  projectId: number,
  text: string,
): Promise<FoundValue[]> {
  const layers = await deps.fetchLayers();
  const names = layers.map((l) => l.name);
  const hit = layers.filter(
    (l) => contains(l.name, text) || findSimilar(text, names).includes(l.name),
  );
  const used = await layerUsage(deps, projectId, hit);
  return used.map((l) => ({ condition: `layer = "${l.name}"`, cases: l.testCasesCount }));
}

async function foundInFields(
  deps: ReferenceDeps,
  projectId: number,
  fields: CustomField[],
  text: string,
): Promise<FoundValue[]> {
  const perField = await Promise.all(
    fields.map(async (f) =>
      (await deps.searchFieldValues(projectId, f.id, text)).map((v) => ({
        condition: `cf["${f.name}"] = "${v.name}"`,
        cases: v.testCasesCount,
      })),
    ),
  );
  return perField.flat();
}

async function lookAlikeInFields(
  deps: ReferenceDeps,
  projectId: number,
  fields: CustomField[],
  text: string,
): Promise<FoundValue[]> {
  const perField = await Promise.all(
    fields.map(async (f) => {
      const values = await deps.fetchFieldValues(projectId, f.id);
      const similar = findSimilar(
        text,
        values.map((v) => v.name),
      );
      return values
        .filter((v) => similar.includes(v.name))
        .map((v) => ({ condition: `cf["${f.name}"] = "${v.name}"`, cases: v.testCasesCount }));
    }),
  );
  return perField.flat();
}

export async function findValues(
  deps: ReferenceDeps,
  projectId: number,
  text: string,
): Promise<FoundValue[]> {
  const fields = await deps.fetchCustomFields(projectId);
  const found = [
    ...(await foundInFields(deps, projectId, fields, text)),
    ...(await foundLayers(deps, projectId, text)),
  ];
  const all = found.length ? found : await lookAlikeInFields(deps, projectId, fields, text);
  return all.sort((a, b) => b.cases - a.cases);
}

export async function projectReport(
  deps: { fetchProjects(): Promise<ServerProject[]> },
  configured: Record<string, string>,
): Promise<ProjectReport> {
  let server: ServerProject[] | null = null;
  let serverError: string | null = null;
  try {
    server = await deps.fetchProjects();
  } catch (e) {
    serverError = (e as Error).message;
  }
  const agreed = Object.entries(configured).map(([id, name]) => ({
    id: Number(id),
    name,
    onServer: server ? server.some((p) => p.id === Number(id)) : null,
  }));
  const agreedIds = new Set(agreed.map((p) => p.id));
  return {
    serverReachable: server !== null,
    serverError,
    agreed,
    notInConfig: (server ?? []).filter((p) => !agreedIds.has(p.id)),
  };
}
