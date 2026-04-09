const esbuild = require('esbuild');
const fs      = require('fs');
const path    = require('path');

const production = process.argv.includes('--production');
const watch      = process.argv.includes('--watch');

const sharedOptions = {
  bundle:    true,
  external:  ['vscode'],
  format:    'cjs',
  platform:  'node',
  target:    'node18',
  minify:    production,
  sourcemap: production ? false : 'inline',
};

async function main() {
  const [extCtx, workerCtx, serverCtx] = await Promise.all([
    esbuild.context({
      ...sharedOptions,
      entryPoints: ['src/extension.ts'],
      outfile:     'dist/extension.js',
    }),
    esbuild.context({
      ...sharedOptions,
      // Worker has no vscode dep but needs worker_threads (Node built-in)
      external:    [...sharedOptions.external, 'worker_threads'],
      entryPoints: ['src/indexer/parser-worker.ts'],
      outfile:     'dist/parser-worker.js',
    }),
    esbuild.context({
      ...sharedOptions,
      // Server replaces the `vscode` module with a lightweight Node.js shim
      external:    [],
      alias:       { vscode: './src/server/shim.ts' },
      entryPoints: ['src/server/main.ts'],
      outfile:     'dist/server.js',
      banner:      { js: '#!/usr/bin/env node' },
    }),
  ]);

  if (watch) {
    await Promise.all([extCtx.watch(), workerCtx.watch(), serverCtx.watch()]);
    console.log('[esbuild] watching…');
  } else {
    await Promise.all([extCtx.rebuild(), workerCtx.rebuild(), serverCtx.rebuild()]);
    await Promise.all([extCtx.dispose(), workerCtx.dispose(), serverCtx.dispose()]);
    // Make the server binary executable
    fs.chmodSync(path.join('dist', 'server.js'), 0o755);
  }
}

main().catch(e => { console.error(e); process.exit(1); });
