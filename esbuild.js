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

const e2eEntryPoints = fs.readdirSync(path.join('test', 'e2e'))
  .filter(name => name.endsWith('.ts'))
  .map(name => path.join('test', 'e2e', name));

const browserStubs = {
  'worker_threads': './src/browser/worker-threads-stub',
  'os':             './src/browser/os-stub',
  'path':           './src/browser/path-stub',
  'child_process':  './src/browser/child-process-stub',
  'fs':             './src/browser/fs-stub',
  'fs/promises':    './src/browser/fs-stub',
};

async function main() {
  const [extCtx, browserCtx, workerCtx, serverCtx, e2eCtx] = await Promise.all([
    esbuild.context({
      ...sharedOptions,
      entryPoints: ['src/extension.ts'],
      outfile:     'dist/extension.js',
    }),
    esbuild.context({
      ...sharedOptions,
      platform:    'browser',
      target:      'es2020',
      alias:       browserStubs,
      entryPoints: ['src/extension.browser.ts'],
      outfile:     'dist/extension.browser.js',
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
    esbuild.context({
      ...sharedOptions,
      entryPoints: e2eEntryPoints,
      outdir:      'dist/test',
    }),
  ]);

  if (watch) {
    await Promise.all([extCtx.watch(), browserCtx.watch(), workerCtx.watch(), serverCtx.watch(), e2eCtx.watch()]);
    console.log('[esbuild] watching…');
  } else {
    await Promise.all([extCtx.rebuild(), browserCtx.rebuild(), workerCtx.rebuild(), serverCtx.rebuild(), e2eCtx.rebuild()]);
    await Promise.all([extCtx.dispose(), browserCtx.dispose(), workerCtx.dispose(), serverCtx.dispose(), e2eCtx.dispose()]);
    // Make the server binary executable
    fs.chmodSync(path.join('dist', 'server.js'), 0o755);
  }
}

main().catch(e => { console.error(e); process.exit(1); });
