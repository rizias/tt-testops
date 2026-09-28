import type { AttachmentStore } from '../attachmentStore.js';
import type { AppConfig } from '../config.js';
import { caseUnavailable, QueryError, skippable } from '../errors.js';
import type {
  RawCase,
  RawComment,
  RawOverview,
  RawRelation,
  RawRunScenario,
  RawStepData,
} from '../model.js';
import { ownScenarioEmpty } from '../scenarioSource.js';
import type { ProjectTree } from '../tree.js';
import { type AttachmentResult, fetchAttachment } from './attachments.js';
import {
  fetchLayers,
  fetchProjects,
  fetchTrees,
  type ServerProject,
  type TestLayer,
} from './catalog.js';
import { explainRejectedQuery } from './diagnosis.js';
import {
  type CustomField,
  type CustomFieldValue,
  fetchCustomFields,
  fetchFieldValueCount,
  fetchFieldValues,
  searchFieldValues,
} from './fields.js';
import { apiError } from './http.js';
import { FetchPort, type TestOpsPort } from './port.js';
import {
  countCases,
  type SearchContext,
  type SearchHit,
  type SearchQuery,
  searchAll,
} from './search.js';
import { TestOpsSession } from './session.js';

export function findFieldByName(fields: CustomField[], name: string): CustomField {
  const wanted = name.trim().toLowerCase();
  const hit = fields.find((f) => f.name.toLowerCase() === wanted);
  if (hit) return hit;
  const available = fields.length ? fields.map((f) => f.name).join(', ') : 'ни одного';
  throw new QueryError(`Поля «${name}» в проекте нет. Доступные поля: ${available}.`);
}

export class TestOpsClient {
  private readonly session: TestOpsSession;
  private readonly port: TestOpsPort;

  constructor(
    private readonly cfg: AppConfig,
    port: TestOpsPort = new FetchPort(),
    private readonly onWarn: (message: string) => void = () => {},
    store: AttachmentStore | null = null,
    now: () => number = Date.now,
  ) {
    this.session = new TestOpsSession(cfg, port, store, onWarn, now);
    this.port = this.session.port;
  }

  private async secondary<T>(id: string, what: string, get: () => Promise<T | null>) {
    try {
      return await get();
    } catch (e) {
      this.onWarn(`кейс ${id}: ${what} получить не удалось — ${(e as Error).message}`);
      return null;
    }
  }

  private url(path: string): string {
    return this.cfg.baseUrl.replace(/\/$/, '') + path;
  }

  async fetchOverview(id: string): Promise<RawOverview | null> {
    const ovUrl = this.url(`/api/testcase/${id}/overview`);
    const ov = await this.port.get(ovUrl, await this.session.headers());
    if (ov.status === 404) {
      this.onWarn(`кейс ${id}: HTTP 404, ${ovUrl}`);
      return null;
    }
    if (!ov.ok) throw apiError(ov.status, ovUrl);
    return (await ov.json()) as RawOverview;
  }

  async fetchCaseFromOverview(overview: RawOverview): Promise<RawCase> {
    const id = String(overview.id);
    let steps: RawStepData | null = null;
    if (overview.hasManualScenario) {
      const stUrl = this.url(`/api/testcase/${id}/step`);
      const st = await this.port.get(stUrl, await this.session.headers());
      if (st.ok) steps = (await st.json()) as RawStepData;
      else if (st.status !== 404) throw apiError(st.status, stUrl);
    }
    const comments = await this.secondary(id, 'комментарии', () => this.fetchComments(id));
    const relations = await this.secondary(id, 'связи', () => this.fetchRelations(id));
    const raw: RawCase = { overview, steps, comments, relations };
    if (!ownScenarioEmpty(overview, steps)) return { ...raw, runScenario: null };
    const runScenario = await this.secondary(id, 'сценарий из тестового результата', () =>
      this.fetchRunScenario(id),
    );
    return runScenario === null ? raw : { ...raw, runScenario };
  }

  private async fetchRunScenario(id: string): Promise<RawRunScenario> {
    const url = this.url(`/api/testcase/${id}/scenariofromrun`);
    const r = await this.port.get(url, await this.session.headers());
    if (r.status === 404) return { steps: [] };
    if (!r.ok) throw apiError(r.status, url);
    return (await r.json()) as RawRunScenario;
  }

  async fetchRelations(caseId: string | number): Promise<RawRelation[] | null> {
    const url = this.url(`/api/testcase/${caseId}/relation`);
    const r = await this.port.get(url, await this.session.headers());
    if (r.status === 404) return null;
    if (!r.ok) throw apiError(r.status, url);
    const data = (await r.json()) as RawRelation[] | { content?: RawRelation[] };
    return Array.isArray(data) ? data : (data.content ?? []);
  }

  private ctx(): SearchContext {
    return {
      port: this.port,
      url: (p) => this.url(p),
      authHeaders: (accept) => this.session.headers(accept),
      explainRejectedQuery: (rql, projectId) => this.explainRejectedQuery(rql, projectId),
    };
  }

  searchAll(
    query: SearchQuery,
    projectId: number,
    limit: number,
  ): Promise<{ hits: SearchHit[]; total: number }> {
    return searchAll(this.ctx(), query, projectId, limit);
  }

  private async fetchComments(caseId: string | number): Promise<RawComment[] | null> {
    const h = await this.session.headers();
    const out: RawComment[] = [];
    for (let page = 0; ; page++) {
      const url = this.url(`/api/comment?testCaseId=${caseId}&page=${page}&size=100`);
      const r = await this.port.get(url, h);
      if (r.status === 404) return null;
      if (!r.ok) throw apiError(r.status, url);
      const data = (await r.json()) as { content?: RawComment[]; totalPages?: number };
      out.push(...(data.content ?? []));
      const pages = data.totalPages ?? 1;
      if (page + 1 >= pages || !(data.content ?? []).length) return out;
    }
  }

  fetchAttachment(attachmentId: number, shared = false): Promise<AttachmentResult> {
    return fetchAttachment(this.ctx(), attachmentId, shared);
  }

  fetchProjects(): Promise<ServerProject[]> {
    return fetchProjects(this.ctx());
  }

  fetchLayers(): Promise<TestLayer[]> {
    return fetchLayers(this.ctx());
  }

  countCases(query: SearchQuery, projectId: number): Promise<number> {
    return countCases(this.ctx(), query, projectId);
  }

  fetchFieldValueCount(projectId: number, fieldId: number): Promise<number> {
    return fetchFieldValueCount(this.ctx(), projectId, fieldId);
  }

  searchFieldValues(
    projectId: number,
    fieldId: number,
    query: string,
  ): Promise<CustomFieldValue[]> {
    return searchFieldValues(this.ctx(), projectId, fieldId, query);
  }

  fetchTrees(projectId: number): Promise<ProjectTree[]> {
    return fetchTrees(this.ctx(), projectId);
  }

  fetchCustomFields(projectId: number): Promise<CustomField[]> {
    return fetchCustomFields(this.ctx(), projectId);
  }

  fetchFieldValues(projectId: number, fieldId: number): Promise<CustomFieldValue[]> {
    return fetchFieldValues(this.ctx(), projectId, fieldId);
  }

  private explainRejectedQuery(rql: string, projectId: number): Promise<string> {
    return explainRejectedQuery(
      { fetchCustomFields: (p) => this.fetchCustomFields(p) },
      rql,
      projectId,
    );
  }

  async fetchBatch(
    ids: Array<string | number>,
    onReported?: (id: string | number) => void,
  ): Promise<RawCase[]> {
    const out: RawCase[] = [];
    const settled = await Promise.allSettled(
      ids.map(async (id) => {
        const overview = await this.fetchOverview(String(id));
        return overview ? this.fetchCaseFromOverview(overview) : null;
      }),
    );
    settled.forEach((s, i) => {
      if (s.status === 'fulfilled') {
        if (s.value) out.push(s.value);
        return;
      }
      const error = s.reason;
      if (skippable(error)) return;
      if (!caseUnavailable(error)) throw error;
      const reason = error instanceof Error ? error.message : String(error);
      this.onWarn(`кейс ${ids[i]}: получить не удалось — ${reason}`);
      onReported?.(ids[i] as string | number);
    });
    return out;
  }
}

export type { AttachmentResult } from './attachments.js';
export type { ServerProject, TestLayer } from './catalog.js';
export type { CustomField, CustomFieldValue } from './fields.js';
export type { SearchHit, SearchQuery } from './search.js';
