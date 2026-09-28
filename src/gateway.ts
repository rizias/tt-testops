import { CaseFiles, copyAttachments, type SavedAttachment } from './attachmentFiles.js';
import { type AssetDeps, embedAssets } from './assets.js';
import { auditCase, scenarioStateOf } from './audit.js';
import { AttachmentStore } from './attachmentStore.js';
import { CaseFetcher } from './caseFetcher.js';
import { type AppConfig, resolveProject } from './config.js';
import { type ResolveDeps, resolveToTestCase } from './contentResolver.js';
import { buildFilterRows, type FilterRow } from './filterRows.js';
import { countSources, fieldValues } from './gatewayCatalog.js';
import { type HtmlCase, renderBatchHtml, renderCaseHtml } from './html.js';
import { filterBlock } from './htmlFilter.js';
import type { RawCase, TestCase } from './model.js';
import { defaultProfile, type FormatProfile } from './profile.js';
import {
  type FoundValue,
  findValues,
  type ProjectOverview,
  type ProjectReport,
  projectOverview,
  projectReport,
} from './reference.js';
import { renderBatch, renderCase } from './render.js';
import { buildFilterLink } from './links.js';
import type { Source } from './sources.js';
import { type CustomField, type CustomFieldValue, TestOpsClient } from './testops/client.js';
import type { ProjectTree, TreeChoice } from './tree.js';
import { TreeResolver } from './treeResolver.js';

export type { ProjectOverview, ProjectReport } from './reference.js';

interface Resolved {
  tc: TestCase;
  files: CaseFiles;
}

const embedded = (list: Resolved[]) => embedAssets(list.map((r) => r.files.contents(r.tc.attachments)));

export class Gateway {
  private readonly client: TestOpsClient;
  private readonly store: AttachmentStore | null;
  private readonly trees: TreeResolver;
  private readonly fetcher: CaseFetcher;
  private filter: FilterRow[] = [];
  private readonly assets: AssetDeps;

  constructor(
    private readonly cfg: AppConfig,
    client: TestOpsClient | undefined = undefined,
    private readonly profile: FormatProfile = defaultProfile,
    store: AttachmentStore | null = null,
    private readonly onWarn: (message: string) => void = (m) =>
      process.stderr.write(`Предупреждение: ${m}\n`),
  ) {
    this.store = store;
    this.client = client ?? new TestOpsClient(cfg, undefined, onWarn, store);
    this.assets = {
      client: this.client,
      store: this.store,
      baseUrl: cfg.baseUrl,
      onWarn: this.onWarn,
    };
    this.trees = new TreeResolver(cfg, this.client, this.store, this.onWarn);
    this.fetcher = new CaseFetcher(cfg, this.client, this.onWarn);
  }

  static fromConfig(cfg: AppConfig, profile: FormatProfile): Gateway {
    return new Gateway(cfg, undefined, profile, new AttachmentStore(cfg.profileDir));
  }

  private async resolve(raw: RawCase): Promise<Resolved> {
    const project = Number(raw.overview.projectId);
    const tree = Number.isFinite(project) ? await this.trees.working(project) : null;
    const files = new CaseFiles(this.assets, String(raw.overview.id));
    const deps: ResolveDeps = {
      fetchAttachment: (id, shared) => files.text(id, shared),
      baseUrl: this.cfg.baseUrl,
      onWarn: this.onWarn,
    };
    const tc = await resolveToTestCase(raw, this.profile, deps, tree);
    tc.attachments = await files.sync(tc);
    return { tc, files };
  }

  projectIdOf(project?: string): number {
    return resolveProject(this.cfg, project);
  }

  projectTrees(projectId: number): Promise<ProjectTree[]> {
    return this.trees.all(projectId);
  }

  workingTreeOf(projectId: number): Promise<ProjectTree | null> {
    return this.trees.working(projectId);
  }

  useTree(flag: TreeChoice, fromLinks: Record<string, number>, required: boolean): void {
    this.trees.use(flag, fromLinks, required);
  }

  async getTestCase(id: string): Promise<string | null> {
    const raw = await this.fetcher.one(Number(id));
    if (!raw) return null;
    const { tc } = await this.resolve(raw);
    const marks = this.profile.showMarks ? auditCase(tc, raw).map((a) => a.message) : [];
    return renderCase(
      tc,
      this.profile,
      marks,
      this.cfg.baseUrl,
      this.projectName(tc.projectId),
      this.cfg.people,
    );
  }

  async getTestCasesList(sources: Source[], limit?: number): Promise<string> {
    await this.trees.requireFor(sources.map((s) => s.project));
    const cases = await this.fetchWithFilter(sources, limit);
    if (!cases.length) return 'По данному запросу кейсов не найдено.';
    const resolved: TestCase[] = [];
    for (const raw of cases) resolved.push((await this.resolve(raw)).tc);
    return renderBatch(
      cases,
      this.profile,
      this.cfg.baseUrl,
      resolved,
      (id) => this.projectName(id),
      this.cfg.people,
    );
  }

  filterRows(): FilterRow[] {
    return this.filter;
  }

  private async fetchWithFilter(sources: Source[], limit?: number): Promise<RawCase[]> {
    const cases = await this.fetcher.fetchSources(sources, limit);
    const deps = { cfg: this.cfg, client: this.client, onWarn: this.onWarn };
    this.filter = await buildFilterRows(deps, sources, (s) => this.fetcher.resultOf(s));
    return cases;
  }

  private projectName(projectId: number | null): string | null {
    return projectId === null ? null : (this.cfg.projects[String(projectId)] ?? null);
  }

  async getTestCaseRaw(id: string): Promise<RawCase | null> {
    return this.fetcher.one(Number(id));
  }

  async saveAttachments(id: string, dir?: string): Promise<SavedAttachment[] | null> {
    const raw = await this.fetcher.one(Number(id));
    if (!raw) return null;
    const { tc } = await this.resolve(raw);
    return copyAttachments(tc.attachments, dir);
  }

  async getTestCaseHtml(id: string): Promise<string | null> {
    const raw = await this.fetcher.one(Number(id));
    if (!raw) return null;
    const resolved = await this.resolve(raw);
    const { tc } = resolved;
    return renderCaseHtml(
      { tc, state: scenarioStateOf(tc, raw) },
      this.profile,
      embedded([resolved]),
      this.cfg.baseUrl,
      this.cfg.people,
    );
  }

  async getTestCasesHtml(sources: Source[], limit?: number): Promise<string> {
    await this.trees.requireFor(sources.map((s) => s.project));
    const cases = await this.fetchWithFilter(sources, limit);
    const items: HtmlCase[] = [];
    const resolved: Resolved[] = [];
    for (const raw of cases) {
      const one = await this.resolve(raw);
      resolved.push(one);
      items.push({ tc: one.tc, state: scenarioStateOf(one.tc, raw) });
    }
    return renderBatchHtml(
      items,
      this.profile,
      embedded(resolved),
      this.cfg.baseUrl,
      this.cfg.projects,
      this.cfg.people,
      filterBlock(this.filter),
    );
  }

  projects(): Promise<ProjectReport> {
    return projectReport(this.client, this.cfg.projects);
  }

  overview(project?: number | string): Promise<ProjectOverview> {
    return projectOverview(this.client, resolveProject(this.cfg, project));
  }

  findValues(text: string, project?: number | string): Promise<FoundValue[]> {
    return findValues(this.client, resolveProject(this.cfg, project), text);
  }

  countSources(sources: Source[]): Promise<Array<{ project: number; count: number }>> {
    return countSources(this.cfg, this.client, sources);
  }

  fields(project?: number | string): Promise<CustomField[]> {
    return this.client.fetchCustomFields(resolveProject(this.cfg, project));
  }

  fieldValues(name: string, project?: number | string): Promise<CustomFieldValue[]> {
    return fieldValues(this.client, resolveProject(this.cfg, project), name);
  }

  linkFor(source: Source): string {
    return buildFilterLink(this.cfg.baseUrl, resolveProject(this.cfg, source.project), source);
  }
}
