export interface RawAttachment {
  id: number;
  name?: string;
  contentType?: string;
  contentLength?: number;
  missed?: boolean;
}
export interface RawScenarioStep {
  name?: string;
  keyword?: string;
  attachments?: RawAttachment[];
  steps?: RawScenarioStep[];
}
export interface RawScenario {
  attachments?: RawAttachment[];
  steps?: RawScenarioStep[];
}
export interface RawCustomField {
  name?: string;

  customField?: { id?: number; name?: string; singleSelect?: boolean };
}
export interface RawLink {
  name?: string | null;
  url?: string;
}
export interface RawIssue {
  name?: string;
  displayName?: string;
  summary?: string;
  status?: string;
  closed?: boolean;
  url?: string;
}
export interface RawMember {
  name?: string;
  role?: { name?: string };
}
export interface RawRelation {
  type?: string;
  target?: { id?: number; name?: string; projectId?: number };
}
export interface RawOverview {
  id: number;
  projectId?: number;

  lastModifiedDate?: number;
  name?: string;
  description?: string;
  precondition?: string;
  expectedResult?: string;
  automated?: boolean;
  hasManualScenario?: boolean;
  status?: { name?: string };
  layer?: { name?: string };
  testLayer?: { name?: string };
  layerName?: string;
  tags?: { name?: string }[];
  links?: RawLink[];
  issues?: RawIssue[];
  members?: RawMember[];
  customFields?: RawCustomField[];
  scenario?: RawScenario;
}

export interface RichMark {
  type?: string;
  attrs?: { href?: string };
}
export interface RichNode {
  type?: string;
  text?: string;
  marks?: RichMark[];
  attrs?: Record<string, string>;
  content?: RichNode[];
}

export interface RawStepNode {
  body?: string;

  bodyJson?: RichNode;
  children?: (string | number)[];
  expectedResultId?: string | number;
  sharedStepId?: string | number;

  attachmentId?: string | number;
}
export interface RawSharedStep {
  body?: string;
  children?: (string | number)[];
}
export interface RawStepData {
  root?: { children?: (string | number)[] };
  scenarioSteps?: Record<string, RawStepNode>;
  sharedSteps?: Record<string, RawSharedStep>;
  sharedStepScenarioSteps?: Record<string, RawStepNode>;
  attachments?: Record<string, RawAttachment>;
  sharedStepAttachments?: Record<string, RawAttachment>;
}

export interface RawComment {
  id?: number;
  body?: string;
  createdBy?: string;
  firstName?: string;
  lastName?: string;
  createdDate?: number;
}

export interface RawCase {
  overview: RawOverview;
  steps: RawStepData | null;

  relations?: RawRelation[] | null;

  comments?: RawComment[] | null;
}

export type ScenarioSource = 'newSteps' | 'inlineSteps' | 'rawMarkdown' | 'empty';

export interface TestCaseAttribute {
  name: string;
  value: string;
}

export interface TestCase {
  id: string;
  name: string;
  projectId: number | null;
  path: string[];
  status: string;
  automated: boolean;
  layer: string;
  tags: string[];
  links: string[];

  linkRefs: CaseLink[];

  issues: CaseIssue[];

  people: CasePerson[];

  relatedCases: CaseRelation[];

  attributes: TestCaseAttribute[];

  isLegacy: boolean;

  declaredManual: boolean;
  description: string;
  precondition: string;
  expectedResult: string;
  scenarioSource: ScenarioSource;

  scenarioLines: string[];

  scenarioRich?: (RichNode | null)[];

  comments: TestCaseComment[];
}

export interface CaseLink {
  name: string;
  url: string;
}
export interface CaseIssue {
  key: string;
  summary: string;
  status: string;
  closed: boolean;
  url: string;
}
export interface CasePerson {
  name: string;
  role: string;
}
export interface CaseRelation {
  id: string;
  name: string;
  kind: string;

  projectId: number | null;
}

export interface TestCaseComment {
  id: string;
  author: string;
  createdAt: string;
  body: string;
}
