const esbuild = require('esbuild');

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
  const [extCtx, workerCtx] = await Promise.all([
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
  ]);

  if (watch) {
    await Promise.all([extCtx.watch(), workerCtx.watch()]);
    console.log('[esbuild] watching…');
  } else {
    await Promise.all([extCtx.rebuild(), workerCtx.rebuild()]);
    await Promise.all([extCtx.dispose(), workerCtx.dispose()]);
  }
}

main().catch(e => { console.error(e); process.exit(1); });
