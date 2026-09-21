import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';

export default defineConfig({
  // `resolve.alias`, et pas seulement `test.alias` : les scripts d'audit de
  // `scripts/` tournent sous `vite-node`, qui ne lit que celui-ci. Sans lui,
  // tout script important `RemoveEverythingUnused` meurt sur
  // `Failed to load url vscode`, y compris `apply-kj-removals.ts`, que sa
  // propre en-tête documente comme la façon de rejouer l'audit.
  resolve: {
    alias: {
      vscode: resolve(__dirname, 'test/unit/__mocks__/vscode.ts'),
    },
  },
  test: {
    // `test/unit/gaps/` est EXCLU de la porte par defaut, et c'est une
    // decision de projet, pas une decision de test.
    //
    // Ces fichiers decrivent le comportement VOULU de trous non corriges :
    // vingt six de leurs cas sont rouges par conception, et le resteront tant
    // que les trous correspondants ne seront pas bouches. Les laisser dans
    // `npm test` rendrait la porte rouge en permanence, donc muette : une
    // suite qui echoue toujours ne dit plus rien quand elle echoue.
    //
    // Ils se lancent par `npm run test:gaps`, et leur README dit, trou par
    // trou, combien de cas passent et lesquels.
    include: ['test/unit/**/*.test.ts'],
    exclude: ['test/unit/gaps/**'],
    setupFiles: ['test/unit/setup.ts'],
    alias: {
      vscode: resolve(__dirname, 'test/unit/__mocks__/vscode.ts'),
    },
  },
});
