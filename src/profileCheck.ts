import { z } from 'zod';
import { ConfigError } from './errors.js';
import { type FormatProfile, SECTION_ORDER, type SectionKey } from './profile.js';

const text = z.string();
const flag = z.boolean();

function profileSchema(): z.ZodType<unknown> {
  return z.object({
    meta: z.object({
      addressLabel: text,
      projectLabel: text,
      statusLabel: text,
      typeLabel: text,
      layerLabel: text,
      tagsLabel: text,
      linksLabel: text,
      ownerLabel: text,
      participantsLabel: text,
      issuesLabel: text,
      relatedCasesLabel: text,
      automatedValue: text,
      manualValue: text,
      pathLabel: text,
      pathDisplaySep: text,
      attributeLine: text,
    }),
    sections: z.object({
      description: text.min(1),
      precondition: text.min(1),
      scenario: text.min(1),
      expectedResult: text.min(1),
      comments: text.min(1),
    }),
    sectionOrder: z.array(z.enum([...SECTION_ORDER] as [SectionKey, ...SectionKey[]])).nonempty(),
    warnings: z.object({ emptyScenario: text, stepsFetchError: text, autotestScenario: text }),
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
    customFields: z.object({
      hide: z.array(text),
      rename: z.record(text, text),
      order: z.array(text),
    }),
    showMarks: flag,
  });
}

export function checkProfile(p: FormatProfile, path: string): void {
  const parsed = profileSchema().safeParse(p);
  if (!parsed.success) {
    const wrong = parsed.error.issues
      .map((i) => `${i.path.join('.') || '(корень)'}: ${i.message}`)
      .join('; ');
    throw new ConfigError(`Профиль ${path} испорчен: ${wrong}.`);
  }
}
