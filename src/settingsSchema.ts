export type FieldSource = 'env' | 'file' | 'default';

export type FieldType = 'string' | 'number' | 'projects' | 'people' | 'trees';

export interface SettingsField {
  key: string;
  path: string;
  envVar?: string;
  type: FieldType;
  required: boolean;
  secret: boolean;
  default: unknown;
  min?: number;
  enumValues?: string[];
}

export const SETTINGS_FIELDS: SettingsField[] = [
  {
    key: 'baseUrl',
    path: 'servers.testops.baseUrl',
    envVar: 'TT_TESTOPS_SERVER_TESTOPS_BASE_URL',
    type: 'string',
    required: true,
    secret: false,
    default: undefined,
  },
  {
    key: 'kind',
    path: 'servers.testops.kind',
    type: 'string',
    required: false,
    secret: false,
    default: 'allure-testops',
    enumValues: ['allure-testops'],
  },
  {
    key: 'token',
    path: 'testops.token',
    envVar: 'TT_TESTOPS_SERVER_TESTOPS_TOKEN',
    type: 'string',
    required: true,
    secret: true,
    default: undefined,
  },
  {
    key: 'defaultProject',
    path: 'defaultProject',
    envVar: 'TT_TESTOPS_DEFAULT_PROJECT',
    type: 'number',
    required: false,
    secret: false,
    default: undefined,
  },
  {
    key: 'projects',
    path: 'projects',
    type: 'projects',
    required: false,
    secret: false,
    default: {},
  },
  {
    key: 'people',
    path: 'people',
    type: 'people',
    required: false,
    secret: false,
    default: {},
  },
  {
    key: 'trees',
    path: 'trees',
    type: 'trees',
    required: false,
    secret: false,
    default: {},
  },
  {
    key: 'timeoutSec',
    path: 'limits.timeoutSec',
    envVar: 'TT_TESTOPS_TIMEOUT_SEC',
    type: 'number',
    required: false,
    secret: false,
    default: 30,
    min: 1,
  },
  {
    key: 'maxCases',
    path: 'limits.maxCases',
    envVar: 'TT_TESTOPS_MAX_CASES',
    type: 'number',
    required: false,
    secret: false,
    default: 100,
    min: 1,
  },
  {
    key: 'concurrency',
    path: 'limits.concurrency',
    envVar: 'TT_TESTOPS_CONCURRENCY',
    type: 'number',
    required: false,
    secret: false,
    default: 8,
    min: 1,
  },
  {
    key: 'retries',
    path: 'limits.retries',
    envVar: 'TT_TESTOPS_RETRIES',
    type: 'number',
    required: false,
    secret: false,
    default: 3,
    min: 0,
  },
  {
    key: 'formatFile',
    path: 'formatFile',
    envVar: 'TT_TESTOPS_FORMAT_FILE',
    type: 'string',
    required: false,
    secret: false,
    default: undefined,
  },
  {
    key: 'description',
    path: 'description',
    type: 'string',
    required: false,
    secret: false,
    default: undefined,
  },
];

export function fieldByKey(key: string): SettingsField {
  const field = SETTINGS_FIELDS.find((f) => f.key === key);
  if (!field) throw new Error(`Неизвестное поле настроек: ${key}`);
  return field;
}

export function getByPath(root: unknown, path: string): unknown {
  let current: unknown = root;
  for (const segment of path.split('.')) {
    if (typeof current !== 'object' || current === null) return undefined;
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}
