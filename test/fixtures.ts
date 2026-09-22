import type { RawCase } from '../src/model.js';

const ATTACHMENT = (id: number, name: string, contentType: string) => ({ id, name, contentType });

export const currentFormat: RawCase = {
  overview: {
    id: 1001,
    projectId: 7,
    name: 'Вход по паролю',
    status: { name: 'Active' },
    layer: { name: 'UI Tests' },
    description: 'Проверяем вход',
    hasManualScenario: true,
    customFields: [
      { name: 'Раздел', customField: { name: 'Section1', singleSelect: false } },
      { name: 'Да', customField: { name: 'Smoke', singleSelect: true } },
    ],
  },
  steps: {
    root: { children: [1, 2] },
    scenarioSteps: {
      '1': { body: 'Открыть форму входа' },
      '2': { body: 'Ввести пароль', children: [3] },
      '3': { body: 'Пароль скрыт точками' },
    },
    attachments: {},
  },
  comments: [],
};

export const oldRawMarkdown: RawCase = {
  overview: {
    id: 1002,
    projectId: 7,
    name: 'Старый кейс',
    status: { name: 'Manual' },
    hasManualScenario: false,
    links: [
      { name: 'Требования', url: 'https://example.test/requirements' },
      { name: 'Старый TMS', url: 'https://testrail.example.test/index.php?/cases/view/1' },
    ],

    scenario: { steps: [{ attachments: [ATTACHMENT(9001, 'customSteps.md', 'text/markdown')] }] },
  },
  steps: null,
  comments: [],
};

export const oldAttachmentOnScenario: RawCase = {
  overview: {
    id: 1008,
    projectId: 7,
    name: 'Старый кейс, вложение на сценарии',
    status: { name: 'Manual' },
    hasManualScenario: false,
    scenario: { attachments: [ATTACHMENT(9005, 'customSteps.md', 'text/markdown')] },
  },
  steps: null,
  comments: [],
};

export const oldInlineSteps: RawCase = {
  overview: {
    id: 1003,
    projectId: 7,
    name: 'Старый кейс со встроенными шагами',
    status: { name: 'Manual' },
    hasManualScenario: false,
    scenario: {
      steps: [
        { keyword: 'Открыть', name: 'главную страницу' },
        { keyword: 'Проверить', name: 'заголовок' },
      ],
    },
  },
  steps: null,
  comments: [],
};

export const emptyScenario: RawCase = {
  overview: {
    id: 1004,
    projectId: 7,
    name: 'Кейс без шагов',
    status: { name: 'Draft' },
    hasManualScenario: false,
    scenario: {},
  },
  steps: null,
  comments: [],
};

export const imageInText: RawCase = {
  overview: {
    id: 1005,
    projectId: 7,
    name: 'Кейс с картинкой в описании',
    status: { name: 'Active' },
    hasManualScenario: true,
    description: 'Экран выглядит так: ![скрин](/api/testcase/attachment/9002/content)',
  },
  steps: {
    root: { children: [1] },
    scenarioSteps: { '1': { body: 'Открыть экран' } },
    attachments: {},
  },
  comments: [],
};

export const imageOnStep: RawCase = {
  overview: {
    id: 1006,
    projectId: 7,
    name: 'Кейс с картинкой на шаге',
    status: { name: 'Active' },
    hasManualScenario: true,
  },
  steps: {
    root: { children: [1] },
    scenarioSteps: { '1': { body: 'Открыть экран', attachmentId: 9003 } },
    attachments: { '9003': ATTACHMENT(9003, 'screen.png', 'image/png') },
  },
  comments: [],
};

export const withComments: RawCase = {
  overview: {
    id: 1007,
    projectId: 7,
    name: 'Кейс с комментариями',
    status: { name: 'Active' },
    hasManualScenario: true,
  },
  steps: { root: { children: [1] }, scenarioSteps: { '1': { body: 'Шаг' } }, attachments: {} },
  comments: [
    { id: 1, body: 'Фича устарела', firstName: 'Автор', createdDate: 1_700_000_000_000 },
    {
      id: 2,
      body: '![image.png](/api/testcase/attachment/9004/content)',
      firstName: 'Автор',
      createdDate: 1_700_000_100_000,
    },
  ],
};

export const allSamples: RawCase[] = [
  currentFormat,
  oldAttachmentOnScenario,
  oldRawMarkdown,
  oldInlineSteps,
  emptyScenario,
  imageInText,
  imageOnStep,
  withComments,
];

export const attachmentBodies: Record<number, string> = {
  9001: '- Открыть страницу\n- Проверить заголовок\n',
  9002: '',
  9003: '',
  9004: '',
  9005: '- Шаги из вложения на сценарии\n',
};
