import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';

/**
 * Les tests des trous de detection, hors de la porte `npm test`.
 *
 * Ils decrivent le comportement VOULU de trous non corriges, donc une partie
 * d'entre eux est rouge par conception. Voir `test/unit/gaps/README.md`, qui
 * dit trou par trou combien de cas passent et lesquels.
 */
export default defineConfig({
  resolve: {
    alias: { vscode: resolve(__dirname, 'test/unit/__mocks__/vscode.ts') },
  },
  test: {
    include: ['test/unit/gaps/**/*.test.ts'],
    setupFiles: ['test/unit/setup.ts'],
    alias: { vscode: resolve(__dirname, 'test/unit/__mocks__/vscode.ts') },
  },
});
