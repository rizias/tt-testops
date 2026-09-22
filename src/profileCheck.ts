import { z } from 'zod';
import { ConfigError } from './errors.js';
import { defaultProfile, type FormatProfile, SECTION_ORDER, type SectionKey } from './profile.js';

const text = z.string();
const flag = z.boolean();

let schema: z.ZodType<unknown> | null = null;

function profileSchema(): z.ZodType<unknown> {
  if (schema) return schema;
  schema = z.object({
    contractVersion: text.min(1),
    id: text.min(1),
    meta: z.object({
      statusLabel: text,
      typeLabel: text,
      layerLabel: text,
      tagsLabel: text,
      linksLabel: text,
      automatedValue: text,
      manualValue: text,
      layerDefault: text,
      pathLabel: text,
      pathDisplaySep: text,
      attributeLine: text,
    }),
    sections: z.object({
      description: text.min(1),
      precondition: text.min(1),
      scenario: text.min(1),
      expectedResult: text.min(1),
    }),
    sectionOrder: z.array(z.enum([...SECTION_ORDER] as [SectionKey, ...SectionKey[]])).nonempty(),
    warnings: z.object({ emptyScenario: text, stepsFetchError: text }),
    steps: z.object({
      indent: text.min(1),
      numbered: flag,
      expandAttachments: flag,
      sharedStep: text,
      expectedBlock: text,
      expectedInline: text,
    }),
    batch: z.object({
      summaryHeading: text,
      noIssues: text,
      divider: text,
    }),
    legacyBanner: text,
    inconsistentBanner: text,
    customFields: z.object({
      hide: z.array(text),
      rename: z.record(text, text),
      order: z.array(text),
    }),
    removeLinks: flag,
    showMarks: flag,
  });
  return schema;
}

const FROZEN: Array<{ field: string; expected: string; of: (p: FormatProfile) => string }> = [
  { field: 'sections.description', expected: '### Описание', of: (p) => p.sections?.description },
  {
    field: 'sections.precondition',
    expected: '### Предварительное условие',
    of: (p) => p.sections?.precondition,
  },
  { field: 'sections.scenario', expected: '### Сценарий', of: (p) => p.sections?.scenario },
  {
    field: 'sections.expectedResult',
    expected: '### Ожидаемый результат',
    of: (p) => p.sections?.expectedResult,
  },
  { field: 'steps.indent', expected: '  ', of: (p) => p.steps?.indent },
  {
    field: 'sectionOrder',
    expected: 'description, precondition, scenario, expectedResult',
    of: (p) => (p.sectionOrder ?? []).join(', '),
  },
];

function frozenBreaks(p: FormatProfile): string[] {
  if (p.id !== defaultProfile.id || p.contractVersion !== defaultProfile.contractVersion) return [];
  const broken = FROZEN.filter((f) => f.of(p) !== f.expected).map(
    (f) => `${f.field} (должно быть «${f.expected}»)`,
  );
  if (!(p.warnings?.emptyScenario ?? '').includes('Нет шагов')) {
    broken.push('warnings.emptyScenario (должно содержать «Нет шагов»)');
  }
  return broken;
}

export function checkProfile(p: FormatProfile, path: string): void {
  const parsed = profileSchema().safeParse(p);
  if (!parsed.success) {
    const wrong = parsed.error.issues
      .map((i) => `${i.path.join('.') || '(корень)'}: ${i.message}`)
      .join('; ');
    throw new ConfigError(`Профиль ${path} испорчен: ${wrong}.`);
  }

  const broken = frozenBreaks(p);
  if (broken.length)
    throw new ConfigError(
      `Профиль ${path} объявлен как ${p.id} ${p.contractVersion}, но меняет критичные для разбора поля: ${broken.join(
        ', ',
      )}. Смените contractVersion, если формат менять действительно нужно.`,
    );
}
