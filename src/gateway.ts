import { type SavedAttachment, attachmentsDirOf, saveEmbedded } from './attachmentFiles.js';
import { type AssetDeps, attachmentText, embedAssets } from './assets.js';
import { type AuditFinding, auditCase, scenarioStateOf } from './audit.js';
import { CaseCache } from './cache.js';
import { CaseFetcher } from './caseFetcher.js';
import { type AppConfig, ProjectResolver } from './config.js';
import { type ResolveDeps, renderBatchResolved, resolveToTestCase } from './contentResolver.js';
import { countWithRepair } from './emptyResult.js';
import { QueryError } from './errors.js';
import { type HtmlCase, renderBatchHtml, renderCaseHtml } from './html.js';
import { type JsonCase, toJson } from './json.js';
import { buildFilterLink } from './links.js';
import type { RawCase, TestCase } from './model.js';
import { defaultProfile, type FormatProfile } from './profile.js';
import { idsOnly } from './queryCheck.js';
import {
  type FoundValue,
  findValues,
  isLayerField,
  layerUsage,
  type ProjectOverview,
  type ProjectReport,
  projectOverview,
  projectReport,
} from './reference.js';
import { renderCase } from './render.js';
import type { Source } from './sources.js';
import {
  type CustomField,
  type CustomFieldValue,
  findFieldByName,
  TestOpsClient,
} from './testops/client.js';
import type { ProjectTree, TreeChoice } from './tree.js';
import { TreeResolver } from './treeResolver.js';

export type { ProjectOverview, ProjectReport } from './reference.js';

function sharedAttachmentIds(cases: RawCase[]): Set<number> {
  const out = new Set<number>();
  for (const raw of cases) {
    for (const att of Object.values(raw.steps?.sharedStepAttachments ?? {})) {
      if (att && typeof att.id === 'number') out.add(att.id);
    }
  }
  return out;
}

export class Gateway {
  private readonly client: TestOpsClient;
  private readonly cache: CaseCache | null;
  private readonly resolver: ProjectResolver;
  private readonly trees: TreeResolver;
  private readonly lostText = new Set<number>();
  private readonly warnedProjects = new Set<number>();
  private readonly fetcher: CaseFetcher;
  private readonly assets: AssetDeps;

  constructor(
    private readonly cfg: AppConfig,
    client: TestOpsClient | undefined = undefined,
    private readonly profile: FormatProfile = defaultProfile,
    cache: CaseCache | null = null,
    private readonly refresh = false,
    private readonly onWarn: (message: string) => void = (m) =>
      process.stderr.write(`Предупреждение: ${m}\n`),
  ) {
    this.cache = cache;
    this.client = client ?? new TestOpsClient(cfg, undefined, undefined, onWarn, cache);
    this.resolver = new ProjectResolver(cfg);
    this.cache?.useServer(cfg.baseUrl);
    this.assets = {
      client: this.client,
      cache: this.cache,
      onWarn: this.onWarn,
      onLost: (id) => this.lostText.add(id),
    };
    this.trees = new TreeResolver(
      cfg,
      this.client,
      this.cache,
      this.refresh,
      this.resolver,
      this.onWarn,
    );
    this.fetcher = new CaseFetcher(
      cfg,
      this.client,
      this.cache,
      this.refresh,
      this.resolver,
      this.onWarn,
    );
  }

  static fromConfig(cfg: AppConfig, profile: FormatProfile = defaultProfile, refresh = false): Gateway {
    return new Gateway(cfg, undefined, profile, new CaseCache(cfg.cacheDir), refresh);
  }

  private deps(): ResolveDeps {
    return {
      fetchAttachment: (id, shared) => attachmentText(this.assets, id, shared),
      baseUrl: this.cfg.baseUrl,
      onWarn: this.onWarn,
      onLost: (id) => this.lostText.add(id),
    };
  }

  private async resolve(raw: RawCase): Promise<TestCase> {
    const project = Number(raw.overview.projectId);
    if (Number.isFinite(project)) this.warnUnagreed(project);
    const tree = Number.isFinite(project) ? await this.trees.working(project) : null;
    return resolveToTestCase(raw, this.profile, this.deps(), tree);
  }

  projectIdOf(project?: string): number {
    return this.resolver.resolve(project);
  }

  projectTrees(projectId: number): Promise<ProjectTree[]> {
    return this.trees.all(projectId);
  }

  workingTreeOf(projectId: number): Promise<ProjectTree | null> {
    return this.trees.working(projectId);
  }

  useTree(flag: TreeChoice, fromLinks: Record<string, number> = {}, required = false): void {
    this.trees.use(flag, fromLinks, required);
  }
  lostAttachments(): number {
    return this.lostText.size;
  }

  async getTestCase(id: string): Promise<string | null> {
    const raw = await this.fetcher.one(Number(id));
    if (!raw) return null;
    const tc = await this.resolve(raw);
    const marks = this.profile.showMarks ? auditCase(tc, raw).map((a) => a.message) : [];
    return renderCase(tc, this.profile, marks);
  }

  async getTestCaseJson(id: string): Promise<{ case: JsonCase; audit: AuditFinding[] } | null> {
    const raw = await this.fetcher.one(Number(id));
    if (!raw) return null;
    const tc = await this.resolve(raw);
    return {
      case: toJson(tc, scenarioStateOf(tc, raw), this.projectName(tc.projectId), this.profile),
      audit: this.profile.showMarks ? auditCase(tc, raw) : [],
    };
  }

  async getTestCasesList(sources: Source[], limit?: number): Promise<string> {
    await this.trees.requireFor(sources.map((s) => s.project));
    const cases = await this.fetcher.fetchSources(sources, limit);
    if (!cases.length) return 'По данному запросу кейсов не найдено.';
    return renderBatchResolved(cases, this.profile, this.deps(), (raw) => this.resolve(raw));
  }

  async searchCasesJson(
    sources: Source[],
    limit?: number,
  ): Promise<{ cases: JsonCase[]; audit: AuditFinding[] }> {
    await this.trees.requireFor(sources.map((s) => s.project));
    const cases = await this.fetcher.fetchSources(sources, limit);
    const out: JsonCase[] = [];
    const findings: AuditFinding[] = [];
    for (const raw of cases) {
      const tc = await this.resolve(raw);
      out.push(toJson(tc, scenarioStateOf(tc, raw), this.projectName(tc.projectId), this.profile));
      if (this.profile.showMarks) findings.push(...auditCase(tc, raw));
    }
    return { cases: out, audit: findings };
  }

  private projectName(projectId: number | null): string | null {
    return projectId === null ? null : (this.cfg.projects[String(projectId)] ?? null);
  }

  async getTestCaseRaw(id: string): Promise<RawCase | null> {
    const raw = await this.fetcher.one(Number(id));
    if (raw) {
      const project = Number(raw.overview.projectId);
      if (Number.isFinite(project)) this.warnUnagreed(project);
    }
    return raw;
  }

  async saveAttachments(id: string, dir?: string): Promise<SavedAttachment[] | null> {
    const raw = await this.fetcher.one(Number(id));
    if (!raw) return null;
    const tc = await this.resolve(raw);
    const item = { tc, state: scenarioStateOf(tc, raw) };
    const assets = await embedAssets(this.assets, [item], sharedAttachmentIds([raw]));
    const target = dir ?? attachmentsDirOf(this.assets, tc.id);
    if (target === null) return [];
    return saveEmbedded(assets, target);
  }

  async getTestCaseHtml(id: string): Promise<string | null> {
    const raw = await this.fetcher.one(Number(id));
    if (!raw) return null;
    const tc = await this.resolve(raw);
    const item = { tc, state: scenarioStateOf(tc, raw) };
    return renderCaseHtml(
      item,
      this.profile,
      await embedAssets(this.assets, [item], sharedAttachmentIds([raw])),
      this.cfg.baseUrl,
      this.cfg.people,
    );
  }

  async getTestCasesHtml(sources: Source[], limit?: number): Promise<string> {
    await this.trees.requireFor(sources.map((s) => s.project));
    const cases = await this.fetcher.fetchSources(sources, limit);
    const items: HtmlCase[] = [];
    for (const raw of cases) {
      const tc = await this.resolve(raw);
      items.push({ tc, state: scenarioStateOf(tc, raw) });
    }
    return renderBatchHtml(
      items,
      this.profile,
      await embedAssets(this.assets, items, sharedAttachmentIds(cases)),
      this.cfg.baseUrl,
      this.cfg.projects,
      this.cfg.people,
    );
  }

  warnUnagreed(project?: number | string): void {
    let id: number;
    try {
      id = this.resolver.resolve(project);
    } catch {
      return;
    }
    if (this.warnedProjects.has(id) || Object.hasOwn(this.cfg.projects, String(id))) return;
    this.warnedProjects.add(id);
    this.onWarn(
      `проект ${id} вне согласованного списка из конфигурации. Список — tt-testops projects`,
    );
  }

  isAgreedProject(project?: number | string): boolean {
    let id: string;
    try {
      id = String(this.resolver.resolve(project));
    } catch {
      return true;
    }
    return Object.hasOwn(this.cfg.projects, id);
  }

  projects(): Promise<ProjectReport> {
    return projectReport(this.client, this.cfg.projects);
  }

  overview(project?: number | string): Promise<ProjectOverview> {
    return projectOverview(this.client, this.resolver.resolve(project));
  }

  findValues(text: string, project?: number | string): Promise<FoundValue[]> {
    return findValues(this.client, this.resolver.resolve(project), text);
  }

  async countSources(sources: Source[]): Promise<Array<{ project: number; count: number }>> {
    const out: Array<{ project: number; count: number }> = [];
    for (const source of sources) {
      if (idsOnly(source.rql)) {
        throw new QueryError(
          'count по идентификаторам не считается: у такого запроса нет проекта, а число берётся поиском в проекте. Возьмите list.',
        );
      }
      const projectId = this.resolver.resolve(source.project);
      const count = await countWithRepair(this.client, source.rql, projectId, this.onWarn);
      out.push({ project: projectId, count });
    }
    return out;
  }

  fields(project?: number | string): Promise<CustomField[]> {
    return this.client.fetchCustomFields(this.resolver.resolve(project));
  }

  async fieldValues(name: string, project?: number | string): Promise<CustomFieldValue[]> {
    const projectId = this.resolver.resolve(project);
    if (isLayerField(name)) return layerUsage(this.client, projectId);
    const field = findFieldByName(await this.client.fetchCustomFields(projectId), name);
    return this.client.fetchFieldValues(projectId, field.id);
  }

  linkFor(rql: string, project?: number | string): string {
    return buildFilterLink(this.cfg.baseUrl, this.resolver.resolve(project), rql);
  }
}
