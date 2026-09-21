import { defineConfig } from 'vite';
import { resolve } from 'node:path';

/**
 * Pour `vite-node`, et lui seul.
 *
 * Les scripts d'audit de `scripts/` tournent sous `vite-node`, qui cherche un
 * `vite.config.*` et ne lit jamais `vitest.config.ts`. Sans ce fichier, tout
 * script qui importe `RemoveEverythingUnused` meurt sur
 * `Failed to load url vscode`, y compris `apply-kj-removals.ts`, dont l'en-tête
 * documente pourtant `npx vite-node` comme la façon de rejouer l'audit.
 *
 * Vitest continue de lire `vitest.config.ts`, qui a la priorité sur celui-ci :
 * la suite de tests n'est pas concernée.
 */
export default defineConfig({
  resolve: {
    alias: {
      vscode: resolve(__dirname, 'test/unit/__mocks__/vscode.ts'),
    },
  },
});
