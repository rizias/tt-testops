import { defineConfig } from 'vitest/config';

const processTests = [
  'test/cliProcess.test.ts',
  'test/configCommand.test.ts',
  'test/initNoGlobal.test.ts',
  'test/initProcess.test.ts',
  'test/settingsValues.test.ts',
  'test/stateLockParallel.test.ts',
];

export default defineConfig({
  test: {
    projects: [
      { test: { name: 'unit', setupFiles: ['test/quietStderr.ts'], exclude: [...processTests, '**/node_modules/**', '**/.git/**'] } },
      { test: { name: 'process', setupFiles: ['test/quietStderr.ts'], include: processTests, fileParallelism: false } },
    ],
  },
});
