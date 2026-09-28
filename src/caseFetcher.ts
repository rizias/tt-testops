import { type AppConfig, resolveProject } from './config.js';
import { explainEmpty } from './emptyResult.js';
import { caseUnavailable, skippable } from './errors.js';
import type { RawCase } from './model.js';
import { directIds, type Source } from './sources.js';
import type { SearchHit, TestOpsClient } from './testops/client.js';

function byName(a: RawCase, b: RawCase): number {
  return (a.overview.name ?? '').localeCompare(b.overview.name ?? '', 'ru');
}

function firstTime<T>(seen: Set<T>, key: T): boolean {
  if (seen.has(key)) return false;
  seen.add(key);
  return true;
}

export interface SourceResult {
  source: Source;
  cases: RawCase[];
}

interface OneResult {
  raw: RawCase | null;
  failed: boolean;
}

export class CaseFetcher {
  constructor(
    private readonly cfg: AppConfig,
    private readonly client: TestOpsClient,
    private readonly onWarn: (message: string) => void,
  ) {}

  private perSource = new Map<Source, RawCase[]>();

  resultOf(source: Source): SourceResult | undefined {
    const cases = this.perSource.get(source);
    return cases ? { source, cases } : undefined;
  }

  async fetchSources(sources: Source[], limit?: number): Promise<RawCase[]> {
    this.perSource = new Map();
    const out: RawCase[] = [];
    const seen = new Set<number>();

    const doneByIds = new Set<string>();
    this.warnIgnoredProjects(sources);

    for (const source of sources) {
      const ids = directIds(source);
      if (ids && !firstTime(doneByIds, ids.join(','))) continue;

      const cases = ids
        ? await this.fetchByIds(ids, limit)
        : await this.fetchBySearch(source, limit);
      this.perSource.set(source, cases);

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
      if (directIds(source) && source.project) ignored.add(source.project);
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
    const projectId = resolveProject(this.cfg, source.project);
    const size = limit ?? Number.POSITIVE_INFINITY;
    const { hits, total } = await this.client.searchAll(source, projectId, size);
    if (limit !== undefined && total > hits.length) {
      this.onWarn(`взято ${hits.length} кейсов из ${total} найденных: задан предел ${size}`);
    }
    if (hits.length) return this.fetchBodies(hits);
    await explainEmpty(this.client, source.rql, projectId);
    return [];
  }

  private async fetchByIds(all: number[], limit?: number): Promise<RawCase[]> {
    const ids = limit !== undefined && limit < all.length ? all.slice(0, limit) : all;
    if (ids.length < all.length) {
      this.onWarn(`предел ${limit}: из ${all.length} идентификаторов взяты первые ${ids.length}`);
    }

    const found = new Map<number, RawCase>();
    const missing: number[] = [];

    const got = await Promise.all(ids.map((id) => this.oneById(id)));
    ids.forEach((id, k) => {
      const result = got[k];
      if (result?.raw) found.set(id, result.raw);
      else if (!result?.failed) missing.push(id);
    });

    if (missing.length) {
      this.onWarn(
        `не найдены: ${missing.join(', ')} — такого кейса нет, он удалён или к нему нет доступа`,
      );
    }
    const result = ids
      .map((id) => found.get(id))
      .filter((c): c is RawCase => !!c)
      .sort(byName);
    return result;
  }

  async one(id: number): Promise<RawCase | null> {
    return (await this.oneById(id, true)).raw;
  }

  private async oneById(id: number, strict = false): Promise<OneResult> {
    try {
      const overview = await this.client.fetchOverview(String(id));
      if (!overview) return { raw: null, failed: false };
      return { raw: await this.client.fetchCaseFromOverview(overview), failed: false };
    } catch (e) {
      if (strict || !(skippable(e) || caseUnavailable(e))) throw e;
      this.onWarn(`кейс ${id}: получить не удалось — ${(e as Error).message}`);
      return { raw: null, failed: caseUnavailable(e) };
    }
  }

  private async fetchBodies(hits: SearchHit[]): Promise<RawCase[]> {
    const reported = new Set<number>();
    const fetched = await this.client.fetchBatch(
      hits.map((h) => h.id),
      (id) => reported.add(Number(id)),
    );
    this.warnMissingBodies(hits, fetched, reported);
    const byId = new Map(fetched.map((raw) => [Number(raw.overview.id), raw]));
    return hits.map((h) => byId.get(h.id)).filter((c): c is RawCase => !!c);
  }

  private warnMissingBodies(hits: SearchHit[], fetched: RawCase[], reported: Set<number>): void {
    const present = new Set(fetched.map((raw) => Number(raw.overview.id)));
    const missing = hits.map((hit) => hit.id).filter((id) => !present.has(id) && !reported.has(id));
    if (missing.length) {
      this.onWarn(`не удалось получить тела кейсов: ${missing.join(', ')}`);
    }
  }
}
