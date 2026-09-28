import type { AttachmentStore } from './attachmentStore.js';
import { type AppConfig, resolveProject } from './config.js';
import { ConfigError, serverOrNetwork } from './errors.js';
import type { TestOpsClient } from './testops/client.js';
import { type ProjectTree, type TreeChoice, pickTree, shapeOf, treeAdvice } from './tree.js';

export class TreeResolver {
  private readonly byProject = new Map<number, ProjectTree | null>();
  private readonly treesByProject = new Map<number, ProjectTree[]>();
  private flag: TreeChoice = null;
  private required = false;
  private shape: string | null = null;
  private fromLinks: Record<string, number> = {};

  constructor(
    private readonly cfg: AppConfig,
    private readonly client: TestOpsClient,
    private readonly store: AttachmentStore | null,
    private readonly onWarn: (message: string) => void,
  ) {}

  use(flag: TreeChoice, fromLinks: Record<string, number>, required: boolean): void {
    this.flag = flag;
    this.required = required;
    this.fromLinks = {};
    for (const [key, tree] of Object.entries(fromLinks)) {
      try {
        this.fromLinks[String(resolveProject(this.cfg, key))] = tree;
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
    const ids = new Set(projects.map((project) => resolveProject(this.cfg, project)));
    for (const projectId of ids) await this.working(projectId);
  }

  async all(projectId: number): Promise<ProjectTree[]> {
    const known = this.treesByProject.get(projectId);
    if (known) return known;
    const trees = await this.fetchAll(projectId);
    this.treesByProject.set(projectId, trees);
    return trees;
  }

  private async fetchAll(projectId: number): Promise<ProjectTree[]> {
    let trees: ProjectTree[];
    try {
      trees = await this.client.fetchTrees(projectId);
    } catch (error) {
      if (!serverOrNetwork(error)) throw error;
      const stale = this.store?.getTrees(this.cfg.baseUrl, projectId);
      if (stale) {
        this.onWarn(
          `список деревьев проекта ${projectId} получить не удалось — взят сохранённый, он может быть устаревшим`,
        );
        return stale;
      }
      this.onWarn(`список деревьев проекта ${projectId} получить не удалось — путь кейсов пуст`);
      return [];
    }
    try {
      await this.store?.putTrees(this.cfg.baseUrl, projectId, trees);
    } catch (error) {
      this.onWarn(
        `список деревьев проекта ${projectId} не удалось сохранить: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    return trees;
  }
}
