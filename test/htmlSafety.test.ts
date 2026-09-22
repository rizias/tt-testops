import { describe, expect, it } from 'vitest';
import { renderMarkdown } from '../src/html.js';
import { extractDomain } from '../src/text.js';

describe('исполняемое содержимое из данных', () => {
  it('некавыченный javascript: в ссылке обезврежен', () => {
    const html = renderMarkdown('<a href=javascript:alert(1)>тык</a>', new Map());
    expect(html).not.toContain('javascript:');
  });
});

describe('обезличивание адреса', () => {
  it('адрес без пути сводится к домену целиком', () => {
    expect(extractDomain('https://example.test?secret=1')).toBe('https://example.test');
    expect(extractDomain('https://example.test/путь/дальше')).toBe('https://example.test');
    expect(extractDomain('не адрес')).toBe('не адрес');
  });
});

describe('исполняемое содержимое, спрятанное за сущностями', () => {
  it('ссылка с java&#x73;cript: обезврежена', () => {
    const html = renderMarkdown('<a href="java&#x73;cript:alert(1)">тык</a>', new Map());
    expect(html).not.toMatch(/href="[^"]*cript:/i);
  });

  it('обычная ссылка не пострадала', () => {
    const html = renderMarkdown('[док](https://example.test/a?b=1)', new Map());
    expect(html).toContain('https://example.test/a?b=1');
  });
});
