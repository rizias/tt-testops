import type { CustomField } from './client.js';

export interface DiagnosisContext {
  fetchCustomFields: (projectId: number) => Promise<CustomField[]>;
}

export async function explainRejectedQuery(
  ctx: DiagnosisContext,
  rql: string,
  projectId: number,
): Promise<string> {
  const lines = [
    'TestOps не разобрал запрос: синтаксис AQL неверен.',
    `Запрос: ${rql}`,
    'Операторы: =  !=  ~= (содержит)  in [...]  not  is null  >  <  >=  <= ; условия соединяются and / or.',
    'Кастомные поля пишутся только как cf["Имя"], голое имя поля недопустимо.',
    'Признак автоматизации называется automation и принимает true/false.',
  ];
  let fields: CustomField[] = [];
  try {
    fields = await ctx.fetchCustomFields(projectId);
  } catch (cause) {
    const detail = cause instanceof Error ? cause.message : String(cause);
    lines.push(
      `Список кастомных полей проекта ${projectId} получить не удалось — ${detail}; какие поля есть, показать нечем.`,
    );
  }
  if (fields.length) {
    lines.push(`Кастомные поля проекта ${projectId}: ${fields.map((f) => f.name).join(', ')}.`);
    const bare = fields.find((f) => new RegExp(`(^|[^"\\w])${f.name}\\s*[=~!<>]`).test(rql));
    if (bare) {
      lines.push(
        `Похоже, поле ${bare.name} написано голым именем. Верно так: ${rql.replace(
          new RegExp(`(^|[^"\\w])${bare.name}(\\s*[=~!<>])`),
          `$1cf["${bare.name}"]$2`,
        )}`,
      );
    }
  }
  return lines.join('\n');
}

export function explainRejectedConditions(ids: string[], filterId?: number): string {
  const lines = ['TestOps отверг условия поиска.'];
  if (ids.length) lines.push(`Условия: ${ids.join(', ')}.`);
  if (filterId !== undefined) lines.push(`Сохранённый фильтр: ${filterId}.`);
  return lines.join('\n');
}
