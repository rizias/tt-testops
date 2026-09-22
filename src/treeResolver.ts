import type { CaseCache } from './cache.js';
import type { AppConfig, ProjectResolver } from './config.js';
import { ConfigError } from './errors.js';
import type { TestOpsClient } from './testops/client.js';
import { type ProjectTree, type TreeChoice, pickTree, shapeOf, treeAdvice } from './tree.js';

export class TreeResolver {
  private readonly byProject = new Map<number, ProjectTree | null>();
  private flag: TreeChoice = null;
  private required = false;
  private shape: string | null = null;
  private fromLinks: Record<string, number> = {};

  constructor(
    private readonly cfg: AppConfig,
    private readonly client: TestOpsClient,
    private readonly cache: CaseCache | null,
    private readonly refresh: boolean,
    private readonly resolver: ProjectResolver,
    private readonly onWarn: (message: string) => void,
  ) {}

  use(flag: TreeChoice, fromLinks: Record<string, number> = {}, required = false): void {
    this.flag = flag;
    this.required = required;
    this.fromLinks = {};
    for (const [key, tree] of Object.entries(fromLinks)) {
      try {
        this.fromLinks[String(this.resolver.resolve(key))] = tree;
      } catch {
        this.fromLinks[key] = tree;
      }
    }
    this.shape = null;
    this.byProject.clear();
  }

  async working(projectId: number): Promise<ProjectTree | null> {
    const known = this.byProject.get(projectId);
    if (known !== undefined) return known;

    const trees = await this.all(projectId);
    const pick = pickTree(trees, {
      flag: this.flag,
      shape: this.shape,
      link: this.fromLinks[String(projectId)] ?? null,
      config: this.cfg.trees?.[String(projectId)] ?? null,
    });
    if (this.required && (pick.ambiguous || pick.missing !== null)) {
      throw new ConfigError(
        treeAdvice({
          projectId,
          projectName: this.cfg.projects[String(projectId)] ?? null,
          trees,
          profileFile: this.cfg.profileFile ?? null,
          missing: pick.missing,
        }),
      );
    }
    const tree = pick.tree;
    if (tree && !this.shape) this.shape = shapeOf(tree);
    this.byProject.set(projectId, tree);
    return tree;
  }

  async requireFor(projects: Array<string | undefined>): Promise<void> {
    if (!this.required) return;
    const ids = new Set(projects.map((project) => this.resolver.resolve(project)));
    for (const projectId of ids) await this.working(projectId);
  }

  async all(projectId: number): Promise<ProjectTree[]> {
    const cached = this.refresh ? null : this.cache?.getTrees(this.cfg.baseUrl, projectId);
    if (cached) return cached;
    try {
      const trees = await this.client.fetchTrees(projectId);
      this.cache?.putTrees(this.cfg.baseUrl, projectId, trees);
      return trees;
    } catch {
      const stale = this.cache?.getTrees(this.cfg.baseUrl, projectId, true);
      if (stale) {
        this.onWarn(
          `список деревьев проекта ${projectId} получить не удалось — взят сохранённый, он может быть устаревшим`,
        );
        return stale;
      }
      this.onWarn(`список деревьев проекта ${projectId} получить не удалось — путь кейсов пуст`);
      return [];
    }
  }
}
