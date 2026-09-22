import { existsSync, readFileSync } from 'node:fs';
import { ConfigError } from './errors.js';
import { checkProfile } from './profileCheck.js';

export const SECTION_ORDER = ['description', 'precondition', 'scenario', 'expectedResult'] as const;

export type SectionKey = (typeof SECTION_ORDER)[number];

export interface FormatProfile {
  contractVersion: string;
  id: string;
  meta: {
    statusLabel: string;
    typeLabel: string;
    layerLabel: string;
    tagsLabel: string;
    linksLabel: string;
    automatedValue: string;
    manualValue: string;
    layerDefault: string;
    pathLabel: string;
    pathDisplaySep: string;

    attributeLine: string;
  };
  sections: {
    description: string;
    precondition: string;
    scenario: string;
    expectedResult: string;
  };

  sectionOrder: SectionKey[];
  warnings: {
    emptyScenario: string;
    stepsFetchError: string;
  };
  steps: {
    indent: string;

    numbered: boolean;

    expandAttachments: boolean;
    sharedStep: string;
    expectedBlock: string;
    expectedInline: string;
  };
  batch: {
    summaryHeading: string;
    noIssues: string;
    divider: string;
  };

  legacyBanner: string;

  inconsistentBanner: string;

  customFields: {
    hide: string[];
    rename: Record<string, string>;
    order: string[];
  };

  removeLinks: boolean;

  showMarks: boolean;
}

export const defaultProfile: FormatProfile = {
  contractVersion: '1.0',
  id: 'testops-markdown',
  meta: {
    statusLabel: 'Статус',
    typeLabel: 'Тип',
    layerLabel: 'Layer',
    tagsLabel: 'Теги',
    linksLabel: 'Ссылки',
    automatedValue: 'Автоматизированный',
    manualValue: 'Ручной',
    layerDefault: 'Не указан',
    pathLabel: 'Путь',
    pathDisplaySep: ' → ',
    attributeLine: '- **{name}:** `{value}`',
  },
  sections: {
    description: '### Описание',
    precondition: '### Предварительное условие',
    scenario: '### Сценарий',
    expectedResult: '### Ожидаемый результат',
  },
  sectionOrder: [...SECTION_ORDER],
  warnings: {
    emptyScenario: '> ⚠️ **Нет шагов** (Сценарий пуст)',
    stepsFetchError: '_Ошибка получения шагов или пустой ответ API_',
  },
  steps: {
    indent: '  ',
    numbered: true,
    expandAttachments: true,

    sharedStep: '**Общий шаг: {name}**',
    expectedBlock: '**Ожидаемый результат**',
    expectedInline: '**Ожидаемый результат:** {text}',
  },
  batch: {
    summaryHeading: '### 📊 Сводка по запросу',
    noIssues: '✅ Все кейсы в порядке.',
    divider: '='.repeat(30),
  },
  legacyBanner:
    '> ⚠️ **Старый формат** — кейс рекомендуется обновить (шаги ниже актуальны на момент выгрузки).',
  inconsistentBanner:
    '> ⚠️ **Несогласованный формат** — кейс объявлен ручным, а сценарий лежит сырым Markdown (шаги ниже актуальны на момент выгрузки).',
  customFields: { hide: [], rename: {}, order: [] },
  removeLinks: false,
  showMarks: true,
};

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}
function deepMerge(
  base: Record<string, unknown>,
  override: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...base };
  for (const [k, v] of Object.entries(override)) {
    const cur = out[k];
    out[k] = isObj(v) && isObj(cur) ? deepMerge(cur, v) : v;
  }
  return out;
}

export function loadProfile(path?: string): FormatProfile {
  if (!path) return defaultProfile;
  if (!existsSync(path)) throw new ConfigError(`Profile file not found: ${path}`);
  let override: unknown;
  try {
    override = JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    throw new ConfigError(`Profile file is not valid JSON: ${path}`);
  }
  if (!isObj(override)) throw new ConfigError(`Profile file must be a JSON object: ${path}`);
  const merged = deepMerge(
    defaultProfile as unknown as Record<string, unknown>,
    override,
  ) as unknown as FormatProfile;
  checkProfile(merged, path);
  return merged;
}
