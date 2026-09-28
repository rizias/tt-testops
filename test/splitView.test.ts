import { describe, expect, it } from 'vitest';
import { type EmbeddedAssets, type HtmlCase, renderBatchHtml } from '../src/html.js';
import type { TestCase } from '../src/model.js';
import { defaultProfile } from '../src/profile.js';
import { stepsOf } from './scenarioFixtures.js';

const assets: EmbeddedAssets = new Map();

const caseOf = (id: string, automated: boolean, path: string[]): HtmlCase => ({
  tc: {
    id,
    name: `Кейс ${id}`,
    projectId: 1,
    path,
    status: 'Active',
    automated,
    layer: 'Web',
    tags: [],
    attachments: [],
    linkRefs: [],
    issues: [],
    people: [],
    relatedCases: [],
    attributes: [],
    isLegacy: false,
    description: 'Описание',
    precondition: '',
    expectedResult: '',
    scenarioSource: 'newSteps',
    scenario: stepsOf('Шаг'),
    scenarioLines: ['1. Шаг'],
    comments: [],
  } as TestCase,
  state: 'current',
});

const page = renderBatchHtml(
  [
    caseOf('1', true, ['Раздел А', 'Раздел Б']),
    caseOf('2', false, ['Раздел А', 'Раздел В']),
    caseOf('3', false, ['Раздел Г']),
  ],
  defaultProfile,
  assets,
  'https://testops.test',
  { 1: 'Демопроект' },
);

describe('слева дерево кейсов, справа выбранный кейс', () => {
  it('дерево и правая колонка — отдельные области', () => {
    expect(page).toContain('<div id="tree">');
    expect(page).toContain('<div class="pane" id="pane">');
  });

  it('у каждой колонки своя прокрутка', () => {
    expect(page).toContain('body.split #tree{');
    expect(page).toContain('body.split #pane{');
    expect((page.match(/overscroll-behavior:contain/g) ?? []).length).toBeGreaterThanOrEqual(2);
  });

  it('содержимое кейса лежит отдельным узлом, чтобы переехать вправо', () => {
    expect(page).toContain('<div class="caseInner">');
    expect(page).toContain('body.split details.case>.caseInner{display:none}');
  });

  it('щелчок по кейсу показывает его справа, а не раскрывает в дереве', () => {
    expect(page).toContain("e.target.closest('details.case > summary')");
    expect(page).toContain('function selectCase(box)');
  });

  it('выбранный кейс отмечен и запоминается', () => {
    expect(page).toContain('case_current');
    expect(page).toContain("localStorage.setItem('tt-case'");
    expect(page).toContain('function restoreSelected()');
  });

  it('кнопка оглавления скрыта, разворачивание идёт по разделам', () => {
    expect(page).toContain('body.split .ctl_toc{display:none}');
    expect(page).toContain("isSplit() ? 'details.group' : 'details'");
  });
});

describe('нулевое состояние правой колонки', () => {
  it('перечисляет, что за выгрузка открыта', () => {
    expect(page).toContain('id="pane-zero"');
    expect(page).toContain('<dt>Кейсов</dt><dd>3</dd>');
    expect(page).toContain('<dt>Из них автоматизировано</dt><dd>1</dd>');
    expect(page).toContain('<dt>Разделов</dt><dd>4</dd>');
    expect(page).toContain('<dt>Проект</dt><dd>Демопроект</dd>');
  });

  it('говорит, что делать дальше', () => {
    expect(page).toContain('Выберите кейс слева.');
  });

  it('несколько проектов названы во множественном числе', () => {
    const two = renderBatchHtml(
      [
        caseOf('1', true, ['Раздел А']),
        {
          ...caseOf('2', false, ['Раздел Г']),
          tc: { ...caseOf('2', false, ['Раздел Г']).tc, projectId: 4 },
        },
      ],
      defaultProfile,
      assets,
      '',
      { 1: 'Первый', 4: 'Второй' },
    );
    expect(two).toContain('<dt>Проекты</dt><dd>Первый, Второй</dd>');
  });
});

describe('просмотр картинки', () => {
  it('перекрывает панель, оглавление и кнопку возврата в начало', () => {
    const layer = (name: string) => {
      const found = page.match(new RegExp(`${name}\\{[^}]*z-index:(\\d+)`));
      return found ? Number(found[1]) : 0;
    };
    const viewer = Number(page.match(/\.viewer\{[^}]*z-index:(\d+)/)?.[1] ?? 0);
    expect(viewer).toBeGreaterThan(layer('\\.toolbar'));
    expect(viewer).toBeGreaterThan(layer('\\.toc'));
    expect(viewer).toBeGreaterThan(layer('\\.toTop'));
  });

  it('запирает прокрутку страницы и обеих колонок', () => {
    expect(page).toContain('body.locked{overflow:hidden}');
    expect(page).toContain('body.locked #tree,body.locked #pane{overflow:hidden}');
    expect(page).toContain("document.body.classList.add('locked')");
    expect(page).toContain("document.body.classList.remove('locked')");
  });
});
