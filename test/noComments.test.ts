import { ESLint, type Linter } from 'eslint';
import { describe, expect, it } from 'vitest';

const configPath: string = '../eslint.config.js';
const configModule = (await import(configPath)) as unknown as {
  buildConfig: (ownerPaths: string[]) => Linter.Config[];
};
const eslint = new ESLint({
  overrideConfigFile: true,
  overrideConfig: configModule.buildConfig([]),
});

async function lintText(code: string, filePath: string) {
  const [result] = await eslint.lintText(code, { filePath });
  return result;
}

function commentMessages(result: ESLint.LintResult | undefined) {
  return (result?.messages ?? []).filter(({ ruleId }) => ruleId === 'local/no-comments');
}

describe('local/no-comments', () => {
  it('обычный комментарий — ошибка', async () => {
    const result = await lintText('// note\nexport const value = 1;\n', 'a.ts');
    expect(commentMessages(result)).toHaveLength(1);
  });

  it('директива отключения правила не действует и сама считается комментарием', async () => {
    const result = await lintText(
      '// eslint-disable-next-line local/no-comments\n// prose\nexport const value = 1;\n',
      'a.ts',
    );
    expect(commentMessages(result).map(({ line }) => line)).toEqual([1, 2]);
    expect(result?.suppressedMessages ?? []).toHaveLength(0);
  });

  it('шебанг, директива TypeScript и маркер владельца разрешены', async () => {
    const result = await lintText(
      '#!/usr/bin/env node\n// @ts-expect-error: reason\n// owner: reason\nexport const value = 1;\n',
      'a.js',
    );
    expect(commentMessages(result)).toHaveLength(0);
  });
});
