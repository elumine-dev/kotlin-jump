import { defineConfig } from '@vscode/test-cli';

export default defineConfig({
  files: 'dist/test/**/*.test.js',
  workspaceFolder: './test/kotlin-jump-demo',
  mocha: {
    timeout: 30000,
  },
});
