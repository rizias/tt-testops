import type { CaseCache } from '../cache.js';
import type { AppConfig } from '../config.js';
import { ApiError, QueryError } from '../errors.js';
import type { RawCase, RawComment, RawOverview, RawRelation, RawStepData } from '../model.js';
import type { ProjectTree } from '../tree.js';
import {
  type AttachmentResult,
  fetchAttachment,
  fetchAttachmentBytes,
  type HttpContext,
} from './attachments.js';
import {
  type CatalogContext,
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
import { FetchPort, ResilientPort, type TestOpsPort } from './port.js';
import { countCases, type SearchContext, type SearchHit, search, searchAll } from './search.js';
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
    port: TestOpsPort = new FetchPort(cfg.timeoutMs),
    sleep: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms)),
    private readonly onWarn: (message: string) => void = () => {},
    cache: CaseCache | null = null,
    now: () => number = Date.now,
  ) {
    const transport = new ResilientPort(port, {
      retries: cfg.retries ?? 3,
      concurrency: cfg.concurrency ?? 8,
      sleep,
      onWarn,
    });
    this.session = new TestOpsSession(cfg, transport, cache, onWarn, now);
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

  getJwt(): Promise<string> {
    return this.session.getJwt();
  }

  private async authHeaders(accept = 'application/json'): Promise<Record<string, string>> {
    return this.session.headers(accept);
  }

  async fetchOverview(id: string): Promise<RawOverview | null> {
    const ovUrl = this.url(`/api/testcase/${id}/overview`);
    const ov = await this.port.get(ovUrl, await this.authHeaders());
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
      const st = await this.port.get(stUrl, await this.authHeaders());
      if (st.ok) steps = (await st.json()) as RawStepData;
      else if (st.status !== 404) throw apiError(st.status, stUrl);
    }
    const comments = await this.secondary(id, 'комментарии', () => this.fetchComments(id));
    const relations = await this.secondary(id, 'связи', () => this.fetchRelations(id));
    return { overview, steps, comments, relations };
  }

  async fetchRelations(caseId: string | number): Promise<RawRelation[] | null> {
    const url = this.url(`/api/testcase/${caseId}/relation`);
    const r = await this.port.get(url, await this.authHeaders());
    if (r.status === 404) return null;
    if (!r.ok) throw apiError(r.status, url);
    const data = (await r.json()) as RawRelation[] | { content?: RawRelation[] };
    return Array.isArray(data) ? data : (data.content ?? []);
  }

  async fetchCaseDetails(id: string): Promise<RawCase | null> {
    const overview = await this.fetchOverview(id);
    return overview ? this.fetchCaseFromOverview(overview) : null;
  }

  private searchCtx(): SearchContext {
    return {
      cfg: this.cfg,
      port: this.port,
      url: (p) => this.url(p),
      authHeaders: (accept) => this.authHeaders(accept),
      explainRejectedQuery: (rql, projectId) => this.explainRejectedQuery(rql, projectId),
    };
  }

  searchAll(
    rql: string,
    projectId: number,
    limit: number,
    pageSize?: number,
  ): Promise<{ hits: SearchHit[]; total: number }> {
    return searchAll(this.searchCtx(), rql, projectId, limit, pageSize);
  }

  search(rql: string, projectId: number, size: number, page = 0): Promise<SearchHit[]> {
    return search(this.searchCtx(), rql, projectId, size, page);
  }
  async fetchComments(caseId: string | number, pageSize = 100): Promise<RawComment[] | null> {
    const h = await this.authHeaders();
    const out: RawComment[] = [];
    for (let page = 0; ; page++) {
      const url = this.url(`/api/comment?testCaseId=${caseId}&page=${page}&size=${pageSize}`);
      const r = await this.port.get(url, h);
      if (r.status === 404) return null;
      if (!r.ok) throw apiError(r.status, url);
      const data = (await r.json()) as { content?: RawComment[]; totalPages?: number };
      out.push(...(data.content ?? []));
      const pages = data.totalPages ?? 1;
      if (page + 1 >= pages || !(data.content ?? []).length) return out;
    }
  }

  private ctx(): HttpContext {
    return {
      port: this.port,
      url: (p) => this.url(p),
      authHeaders: (accept) => this.authHeaders(accept),
    };
  }

  fetchAttachmentBytes(
    attachmentId: number,
    shared = false,
  ): Promise<{ bytes: Buffer; contentType: string } | null> {
    return fetchAttachmentBytes(this.ctx(), attachmentId, shared);
  }

  fetchAttachment(attachmentId: number, shared = false): Promise<AttachmentResult> {
    return fetchAttachment(this.ctx(), attachmentId, shared);
  }
  fetchProjects(size?: number): Promise<ServerProject[]> {
    return fetchProjects(this.catalogCtx(), size);
  }

  fetchLayers(size?: number): Promise<TestLayer[]> {
    return fetchLayers(this.catalogCtx(), size);
  }

  countCases(rql: string, projectId: number): Promise<number> {
    return countCases(this.searchCtx(), rql, projectId);
  }

  fetchFieldValueCount(projectId: number, fieldId: number): Promise<number> {
    return fetchFieldValueCount(this.ctx(), projectId, fieldId);
  }

  searchFieldValues(
    projectId: number,
    fieldId: number,
    query: string,
    pageSize?: number,
  ): Promise<CustomFieldValue[]> {
    return searchFieldValues(this.ctx(), projectId, fieldId, query, pageSize);
  }

  fetchTrees(projectId: number, size?: number): Promise<ProjectTree[]> {
    return fetchTrees(this.catalogCtx(), projectId, size);
  }

  private catalogCtx(): CatalogContext {
    return {
      port: this.port,
      url: (p) => this.url(p),
      authHeaders: (accept) => this.authHeaders(accept),
    };
  }
  fetchCustomFields(projectId: number, pageSize?: number): Promise<CustomField[]> {
    return fetchCustomFields(this.ctx(), projectId, pageSize);
  }

  fetchFieldValues(
    projectId: number,
    fieldId: number,
    pageSize?: number,
  ): Promise<CustomFieldValue[]> {
    return fetchFieldValues(this.ctx(), projectId, fieldId, pageSize);
  }
  private explainRejectedQuery(rql: string, projectId: number): Promise<string> {
    return explainRejectedQuery(
      { fetchCustomFields: (p) => this.fetchCustomFields(p) },
      rql,
      projectId,
    );
  }

  async fetchBatch(ids: Array<string | number>): Promise<RawCase[]> {
    const out: RawCase[] = [];
    const settled = await Promise.allSettled(ids.map((id) => this.fetchCaseDetails(String(id))));
    for (const s of settled) {
      if (s.status === 'fulfilled') {
        if (s.value) out.push(s.value);
        continue;
      }
      const error = s.reason;
      if (error instanceof ApiError && (error.statusCode === 403 || error.statusCode === 404)) {
        continue;
      }
      throw error;
    }
    return out;
  }

  async fetchAttachmentContent(attachmentId: number, shared = false): Promise<string> {
    const got = await fetchAttachment(this.ctx(), attachmentId, shared);
    if (!got.ok) throw new ApiError(got.reason, 0, String(attachmentId), 'server');
    return got.bytes.toString('utf8');
  }
}

export type { AttachmentResult } from './attachments.js';
export type { ServerProject, TestLayer } from './catalog.js';

export type { CustomField, CustomFieldValue } from './fields.js';
export type { SearchHit } from './search.js';
