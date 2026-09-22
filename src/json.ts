import type { ScenarioState } from './audit.js';
import type {
  CaseIssue,
  CaseLink,
  CasePerson,
  CaseRelation,
  TestCase,
  TestCaseAttribute,
  TestCaseComment,
} from './model.js';
import { defaultProfile, type FormatProfile } from './profile.js';

export interface JsonCase {
  contract: { id: string; version: string };
  id: string;

  project: { id: number | null; name: string | null };
  sourcePath: string[];
  title: string;
  status: string;
  type: string;
  automated: boolean;
  layer: string;
  scenarioSource: TestCase['scenarioSource'];
  isLegacy: boolean;

  scenarioState?: ScenarioState;
  fields: {
    description: string;
    precondition: string;
    steps: string[];
    expected: string;
    tags: string[];
    links: string[];
  };

  attributes: TestCaseAttribute[];

  comments: TestCaseComment[];

  linkRefs: CaseLink[];

  issues: CaseIssue[];

  people: CasePerson[];

  relatedCases: CaseRelation[];
}

export function toJson(
  tc: TestCase,
  scenarioState: ScenarioState,
  projectName: string | null = null,
  profile: FormatProfile = defaultProfile,
): JsonCase {
  return {
    contract: { id: profile.id, version: profile.contractVersion },
    id: tc.id,
    project: { id: tc.projectId, name: projectName },
    sourcePath: tc.path,
    title: tc.name,
    status: tc.status,
    type: tc.automated ? 'Автоматизированный' : 'Ручной',
    automated: tc.automated,
    layer: tc.layer,
    scenarioSource: tc.scenarioSource,
    isLegacy: tc.isLegacy,
    ...(profile.showMarks ? { scenarioState } : {}),
    fields: {
      description: tc.description,
      precondition: tc.precondition,
      steps: tc.scenarioLines,
      expected: tc.expectedResult,
      tags: tc.tags,
      links: tc.links,
    },
    attributes: tc.attributes,
    comments: tc.comments,
    linkRefs: tc.linkRefs,
    issues: tc.issues,
    people: tc.people,
    relatedCases: tc.relatedCases,
  };
}
