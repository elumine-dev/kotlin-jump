import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';

export default defineConfig({
  test: {
    include: ['test/unit/**/*.test.ts'],
    setupFiles: ['test/unit/setup.ts'],
    alias: {
      vscode: resolve(__dirname, 'test/unit/__mocks__/vscode.ts'),
    },
  },
});
