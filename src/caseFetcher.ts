import type { CaseCache } from './cache.js';
import type { AppConfig, ProjectResolver } from './config.js';
import { inspectEmpty } from './emptyResult.js';
import { ApiError, QueryError } from './errors.js';
import type { RawCase, RawOverview } from './model.js';
import { idsOnly } from './queryCheck.js';
import type { Source } from './sources.js';
import type { SearchHit, TestOpsClient } from './testops/client.js';

function skippable(e: unknown): boolean {
  return e instanceof ApiError && (e.kind === 'not_found' || e.statusCode === 403);
}

function firstTime<T>(seen: Set<T>, key: T): boolean {
  if (seen.has(key)) return false;
  seen.add(key);
  return true;
}

export class CaseFetcher {
  constructor(
    private readonly cfg: AppConfig,
    private readonly client: TestOpsClient,
    private readonly cache: CaseCache | null,
    private readonly refresh: boolean,
    private readonly resolver: ProjectResolver,
    private readonly onWarn: (message: string) => void,
  ) {}

  async fetchSources(sources: Source[], limit?: number): Promise<RawCase[]> {
    const out: RawCase[] = [];
    const seen = new Set<number>();

    const doneByIds = new Set<string>();
    this.warnIgnoredProjects(sources);

    for (const source of sources) {
      const ids = idsOnly(source.rql);
      if (ids && !firstTime(doneByIds, ids.join(','))) continue;

      const cases = ids
        ? await this.fetchByIds(ids, source.project, limit)
        : await this.fetchBySearch(source, limit);

      if (!ids && !cases.length && sources.length > 1) {
        this.onWarn(`в проекте ${this.describe(source.project)} по запросу кейсов не найдено`);
        continue;
      }
      for (const raw of cases) {
        if (firstTime(seen, Number(raw.overview.id))) out.push(raw);
      }
    }
    return out;
  }

  private warnIgnoredProjects(sources: Source[]): void {
    const ignored = new Set<string>();
    for (const source of sources) {
      if (idsOnly(source.rql) && source.project) ignored.add(source.project);
    }
    if (!ignored.size) return;
    const list = [...ignored];
    this.onWarn(
      list.length === 1
        ? `запрос только по идентификаторам — --project ${list[0]} не применялся, кейсы взяты из своих проектов`
        : `запрос только по идентификаторам — --project ${list.join(', ')} не применялись, кейсы взяты из своих проектов`,
    );
  }

  private describe(project?: number | string): string {
    if (project === undefined || project === '')
      return this.cfg.defaultProjectId === undefined
        ? 'по умолчанию'
        : String(this.cfg.defaultProjectId);
    return String(project);
  }

  private async fetchBySearch(source: Source, limit?: number): Promise<RawCase[]> {
    const projectId = this.resolver.resolve(source.project);
    const requested = limit ?? this.cfg.maxCases;
    const size = Math.min(requested, this.cfg.maxCases);
    if (requested > this.cfg.maxCases) {
      this.onWarn(
        `предел ${requested} уменьшен до ${this.cfg.maxCases}: столько разрешает TT_TESTOPS_MAX_CASES`,
      );
    }
    const { hits, total } = await this.client.searchAll(source.rql, projectId, size);
    if (total > hits.length) {
      const reason =
        requested > this.cfg.maxCases
          ? `предел TT_TESTOPS_MAX_CASES равен ${this.cfg.maxCases}`
          : `задан предел ${size}`;
      this.onWarn(`взято ${hits.length} кейсов из ${total} найденных: ${reason}`);
    } else if (hits.length === size) {
      this.onWarn(`взято ${hits.length} кейсов — ровно заданный предел; выборка могла быть шире`);
    }
    if (hits.length) return this.fetchWithCache(hits, projectId);

    return this.afterEmpty(source, projectId, size);
  }

  private async fetchByIds(all: number[], _project?: string, limit?: number): Promise<RawCase[]> {
    const cap = Math.min(limit ?? this.cfg.maxCases, this.cfg.maxCases);
    const ids = cap < all.length ? all.slice(0, cap) : all;
    if (ids.length < all.length) {
      const reason =
        limit !== undefined && limit <= this.cfg.maxCases
          ? `предел ${limit}`
          : `предел TT_TESTOPS_MAX_CASES равен ${this.cfg.maxCases}`;
      this.onWarn(`${reason}: из ${all.length} идентификаторов взяты первые ${ids.length}`);
    }

    const found = new Map<number, RawCase>();
    const missing: number[] = [];

    const got = await Promise.all(ids.map((id) => this.oneById(id)));
    ids.forEach((id, k) => {
      const raw = got[k];
      if (raw) found.set(id, raw);
      else missing.push(id);
    });

    if (missing.length) {
      this.onWarn(
        `не найдены: ${missing.join(', ')} — такого кейса нет, он удалён или к нему нет доступа`,
      );
    }
    return ids.map((id) => found.get(id)).filter((c): c is RawCase => !!c);
  }

  async one(id: number): Promise<RawCase | null> {
    return this.oneById(id, true);
  }

  private async oneById(id: number, strict = false): Promise<RawCase | null> {
    let overview: RawOverview | null;
    try {
      overview = await this.client.fetchOverview(String(id));
    } catch (e) {
      if (strict || !skippable(e)) throw e;
      this.onWarn(`кейс ${id} получить не удалось — ${(e as Error).message}`);
      return null;
    }
    if (!overview) return null;
    const projectId = overview.projectId ?? 0;
    const stamp = overview.lastModifiedDate ?? 0;
    const stored = this.refresh ? null : this.cache?.getCase(projectId, id, stamp);
    if (stored) return stored;
    const raw = await this.client.fetchCaseFromOverview(overview);
    this.cache?.putCase(projectId, id, stamp, raw);
    return raw;
  }

  private async fetchWithCache(hits: SearchHit[], projectId: number): Promise<RawCase[]> {
    if (!this.cache) {
      const fetched = await this.client.fetchBatch(hits.map((h) => h.id));
      this.warnMissingBodies(hits, fetched);
      const byId = new Map(fetched.map((raw) => [Number(raw.overview.id), raw]));
      return hits.map((h) => byId.get(h.id)).filter((c): c is RawCase => !!c);
    }

    const out = new Map<number, RawCase>();
    const missing: SearchHit[] = [];
    for (const h of hits) {
      const stored = this.refresh ? null : this.cache.getCase(projectId, h.id, h.lastModifiedDate);
      if (stored) out.set(h.id, stored);
      else missing.push(h);
    }
    if (missing.length) {
      const fetched = await this.client.fetchBatch(missing.map((h) => h.id));
      const dateOf = new Map(missing.map((h) => [h.id, h.lastModifiedDate]));
      for (const raw of fetched) {
        const id = Number(raw.overview.id);
        out.set(id, raw);
        this.cache.putCase(projectId, id, dateOf.get(id) ?? 0, raw);
      }
    }

    this.warnMissingBodies(hits, [...out.values()]);
    return hits.map((h) => out.get(h.id)).filter((c): c is RawCase => !!c);
  }

  private warnMissingBodies(hits: SearchHit[], fetched: RawCase[]): void {
    const present = new Set(fetched.map((raw) => Number(raw.overview.id)));
    const missing = hits.map((hit) => hit.id).filter((id) => !present.has(id));
    if (missing.length) {
      this.onWarn(
        `не удалось получить тела кейсов: ${missing.join(', ')} — кейс не найден или к нему нет доступа`,
      );
    }
  }

  private async afterEmpty(source: Source, projectId: number, size: number): Promise<RawCase[]> {
    const outcome = await inspectEmpty(this.client, source.rql, projectId);
    if (!outcome) return [];
    if (outcome.kind === 'error') throw new QueryError(outcome.message);
    this.onWarn(outcome.note);
    const { hits } = await this.client.searchAll(outcome.rql, projectId, size);
    return hits.length ? this.fetchWithCache(hits, projectId) : [];
  }
}
