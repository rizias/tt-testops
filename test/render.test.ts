import { describe, expect, it } from 'vitest';
import { type ResolveDeps, resolveToTestCase } from '../src/contentResolver.js';
import type { RawCase } from '../src/model.js';
import { defaultProfile, type FormatProfile } from '../src/profile.js';
import { renderCase } from '../src/render.js';
import {
  attachmentBodies,
  currentFormat,
  emptyScenario,
  imageInText,
  imageOnStep,
  oldRawMarkdown,
} from './fixtures.js';

const renderResolved = async (raw: RawCase, p: FormatProfile, deps: ResolveDeps) =>
  renderCase(await resolveToTestCase(raw, p, deps), p);

const BASE = 'https://testops.example';

const deps: ResolveDeps = {
  baseUrl: BASE,
  fetchAttachment: async (id) => {
    const body = attachmentBodies[id];
    if (body === undefined) throw new Error(`образец не описывает вложение ${id}`);
    return body;
  },
};

describe('старый формат показывается, а не прячется', () => {
  it('ставит баннер сразу под заголовком', async () => {
    const lines = (await renderResolved(oldRawMarkdown, defaultProfile, deps)).split('\n');
    expect(lines[0]).toMatch(/^# \*\*.+\*\* \(ID: 1002\)$/);
    expect(lines[1]).toBe(defaultProfile.legacyBanner);
  });

  it('показывает настоящие шаги из вложения, а не заглушку', async () => {
    const md = await renderResolved(oldRawMarkdown, defaultProfile, deps);
    expect(md).toContain('Открыть страницу');
    expect(md).toContain('Проверить заголовок');
    expect(md).not.toContain(defaultProfile.warnings.emptyScenario);
  });

  it('не оставляет старой заглушки о конвертации', async () => {
    expect(await renderResolved(oldRawMarkdown, defaultProfile, deps)).not.toContain(
      'Требуется конвертация',
    );
  });
});

describe('актуальный формат', () => {
  it('не помечается баннером старого', async () => {
    expect(await renderResolved(currentFormat, defaultProfile, deps)).not.toContain(
      defaultProfile.legacyBanner,
    );
  });

  it('содержит раздел сценария и его шаги', async () => {
    const md = await renderResolved(currentFormat, defaultProfile, deps);
    expect(md).toContain(defaultProfile.sections.scenario);
    expect(md).toContain('1. Открыть форму входа');
    expect(md).toContain('2. Ввести пароль');
  });

  it('сохраняет вложенность шагов', async () => {
    const md = await renderResolved(currentFormat, defaultProfile, deps);
    expect(md).toContain(`${defaultProfile.steps.indent}1. Пароль скрыт точками`);
  });
});

describe('картинки', () => {
  it('делает относительный адрес в тексте полным', async () => {
    const md = await renderResolved(imageInText, defaultProfile, deps);
    expect(md).toContain(`${BASE}/api/testcase/attachment/9002/content`);
    expect(md).not.toContain('](/api/');
  });

  it('выводит картинку, прикреплённую к шагу, полным адресом', async () => {
    const md = await renderResolved(imageOnStep, defaultProfile, deps);
    expect(md).toContain(`![screen.png](${BASE}/api/testcase/attachment/9003/content)`);
    expect(md).not.toContain('](/api/');
  });
});

describe('пустой сценарий', () => {
  it('выводится литералом контракта, а не пустотой', async () => {
    const md = await renderResolved(emptyScenario, defaultProfile, deps);
    expect(md).toContain('Нет шагов');
  });
});
