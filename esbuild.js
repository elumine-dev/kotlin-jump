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

// Demo recording tooling (DEV ONLY — excluded from VSIX via .vscodeignore).
const demoLibEntryPoints = fs.existsSync(path.join('scripts', 'demo', 'lib'))
  ? fs.readdirSync(path.join('scripts', 'demo', 'lib'))
      .filter(name => name.endsWith('.ts'))
      .map(name => path.join('scripts', 'demo', 'lib', name))
  : [];
const demoEntryPoints = fs.existsSync(path.join('scripts', 'demo', 'demos'))
  ? fs.readdirSync(path.join('scripts', 'demo', 'demos'))
      .filter(name => name.endsWith('.demo.ts'))
      .map(name => path.join('scripts', 'demo', 'demos', name))
  : [];

const browserStubs = {
  'worker_threads':      './src/browser/worker-threads-stub',
  'node:worker_threads': './src/browser/worker-threads-stub',
  'os':                  './src/browser/os-stub',
  'node:os':             './src/browser/os-stub',
  'path':                './src/browser/path-stub',
  'node:path':           './src/browser/path-stub',
  'child_process':       './src/browser/child-process-stub',
  'node:child_process':  './src/browser/child-process-stub',
  'fs':                  './src/browser/fs-stub',
  'node:fs':             './src/browser/fs-stub',
  'fs/promises':         './src/browser/fs-stub',
  'node:fs/promises':    './src/browser/fs-stub',
  'zlib':                './src/browser/zlib-stub',
  'node:zlib':           './src/browser/zlib-stub',
  'util':                './src/browser/util-stub',
  'node:util':           './src/browser/util-stub',
  'crypto':              './src/browser/crypto-stub',
  'node:crypto':         './src/browser/crypto-stub',
};

// Perf benchmark scripts (DEV ONLY — excluded from VSIX).
const perfEntryPoints = ['scripts/perf-bench.ts', 'scripts/perf-diff.ts']
  .filter(fs.existsSync);

// Maintenance scripts (DEV ONLY, excluded from VSIX, run manually).
const maintenanceEntryPoints = ['scripts/build-bundled-stdlib-index.ts']
  .filter(fs.existsSync);

async function main() {
  const buildDemo = demoLibEntryPoints.length > 0 || demoEntryPoints.length > 0;
  const buildPerf = perfEntryPoints.length > 0;
  const buildMaintenance = maintenanceEntryPoints.length > 0;
  const [extCtx, browserCtx, workerCtx, serverCtx, e2eCtx, demoLibCtx, demoCtx, recordCtx, recorderExtCtx, perfCtx, logcatWebviewCtx, testWebCtx, maintenanceCtx] = await Promise.all([
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
    buildDemo
      ? esbuild.context({
          ...sharedOptions,
          // Demo lib: VS Code API + Node built-ins, extension host runtime.
          // @napi-rs/canvas ships a native .node binary esbuild can't bundle,
          // so it must stay external and be required at runtime.
          external:    [...sharedOptions.external, '@napi-rs/canvas'],
          entryPoints: demoLibEntryPoints,
          outdir:      'dist/demo/lib',
        })
      : Promise.resolve(undefined),
    buildDemo
      ? esbuild.context({
          ...sharedOptions,
          // Each demo is bundled self-contained with its lib imports inlined.
          entryPoints: demoEntryPoints,
          outdir:      'dist/demo/demos',
        })
      : Promise.resolve(undefined),
    buildDemo
      ? (() => {
          // CLI orchestrators — run outside VS Code. Keep node_modules
          // external to avoid 2 MB single-file bundles.
          const cliEntries = ['record.ts', 'record-batch.ts', 'validate-frames.ts', 'e2e.ts', 'manual-record.ts', 'manual-render.ts']
            .map(n => path.join('scripts', 'demo', n))
            .filter(fs.existsSync);
          return cliEntries.length === 0
            ? Promise.resolve(undefined)
            : esbuild.context({
                ...sharedOptions,
                packages:    'external',
                entryPoints: cliEntries,
                outdir:      'dist/demo',
                banner:      { js: '#!/usr/bin/env node' },
              });
        })()
      : Promise.resolve(undefined),
    // Dev-only recorder extension — loaded via `--extensionDevelopmentPath`
    // when you run `npm run demo:workspace`. Never shipped (see .vscodeignore).
    buildDemo && fs.existsSync(path.join('scripts', 'demo', 'recorder-ext', 'src', 'extension.ts'))
      ? esbuild.context({
          ...sharedOptions,
          entryPoints: [path.join('scripts', 'demo', 'recorder-ext', 'src', 'extension.ts')],
          outfile:     'scripts/demo/recorder-ext/dist/extension.js',
        })
      : Promise.resolve(undefined),
    // Perf benchmark scripts (dev tooling, never shipped). Headless —
    // the `vscode` module is aliased to the unit-test mock so providers
    // run outside the extension host.
    buildPerf
      ? esbuild.context({
          ...sharedOptions,
          external:    [],
          alias:       { vscode: './test/unit/__mocks__/vscode.ts' },
          entryPoints: perfEntryPoints,
          outdir:      'dist/perf',
          banner:      { js: '#!/usr/bin/env node' },
        })
      : Promise.resolve(undefined),
    // Logcat webview bundle. Runs inside the VS Code webview iframe (Chromium),
    // so the platform is 'browser' and `vscode` is not available — only the
    // postMessage bridge via `acquireVsCodeApi`.
    esbuild.context({
      ...sharedOptions,
      platform:    'browser',
      target:      'es2020',
      format:      'iife',
      external:    [],
      entryPoints: ['media/logcat/main.ts'],
      outfile:     'dist/logcat/main.js',
    }),
    // @vscode/test-web smoke test suite. Same alias as browserCtx (must
    // exercise the exact same Node-stub environment the real web bundle
    // does) but `vscode` stays external, since this runs inside a real web
    // extension host that provides the genuine API, not a mock. Mocha-browser
    // requires a single bundled file, hence one entry point (unlike e2eCtx's
    // per-file outdir).
    esbuild.context({
      ...sharedOptions,
      platform:    'browser',
      target:      'es2020',
      alias:       browserStubs,
      entryPoints: ['test/web/suite/index.ts'],
      outfile:     'dist/test-web/suite/index.js',
    }),
    // Maintenance scripts (e.g. build-bundled-stdlib-index.ts): headless,
    // run manually from the CLI, never shipped. `vscode` aliased to the
    // unit-test mock, same as perfCtx above, since these import repo modules
    // that reference `vscode` at the top level without ever calling into it.
    buildMaintenance
      ? esbuild.context({
          ...sharedOptions,
          external:    [],
          alias:       { vscode: './test/unit/__mocks__/vscode.ts' },
          entryPoints: maintenanceEntryPoints,
          outdir:      'dist/scripts',
          banner:      { js: '#!/usr/bin/env node' },
        })
      : Promise.resolve(undefined),
  ]);

  const allCtx = [extCtx, browserCtx, workerCtx, serverCtx, e2eCtx, demoLibCtx, demoCtx, recordCtx, recorderExtCtx, perfCtx, logcatWebviewCtx, testWebCtx, maintenanceCtx].filter(Boolean);
  if (watch) {
    await Promise.all(allCtx.map(c => c.watch()));
    console.log('[esbuild] watching…');
  } else {
    await Promise.all(allCtx.map(c => c.rebuild()));
    await Promise.all(allCtx.map(c => c.dispose()));
    // Make the server binary executable
    fs.chmodSync(path.join('dist', 'server.js'), 0o755);
  }
}

main().catch(e => { console.error(e); process.exit(1); });
