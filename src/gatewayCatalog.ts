import { type AppConfig, resolveProject } from './config.js';
import { countOrExplain } from './emptyResult.js';
import { QueryError } from './errors.js';
import { isLayerField, layerUsage } from './reference.js';
import { directIds, type Source } from './sources.js';
import { type CustomFieldValue, findFieldByName, type TestOpsClient } from './testops/client.js';

export async function countSources(
  cfg: AppConfig,
  client: TestOpsClient,
  sources: Source[],
): Promise<Array<{ project: number; count: number }>> {
  const out: Array<{ project: number; count: number }> = [];
  for (const source of sources) {
    if (directIds(source)) {
      throw new QueryError(
        'count по идентификаторам не считается: у такого запроса нет проекта, а число берётся поиском в проекте. Возьмите list.',
      );
    }
    const projectId = resolveProject(cfg, source.project);
    const count = await countOrExplain(client, source, projectId);
    out.push({ project: projectId, count });
  }
  return out;
}

export async function fieldValues(
  client: TestOpsClient,
  projectId: number,
  name: string,
): Promise<CustomFieldValue[]> {
  if (isLayerField(name)) return layerUsage(client, projectId);
  const field = findFieldByName(await client.fetchCustomFields(projectId), name);
  return client.fetchFieldValues(projectId, field.id);
}
