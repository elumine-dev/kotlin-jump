/**
 * Guards against Node.js-only code silently leaking into the web extension
 * bundle (`dist/extension.browser.js`).
 *
 * Two historical regressions on this exact bundle (commits `6e81662`,
 * `2466ce9`) were only ever caught by a manual, un-committed run of
 * `@vscode/test-web`, never reproducible, never automated. This is the
 * first automated guard against that class of bug: it verifies the bundle
 * text never references Node-only symbols that `esbuild.js`'s `browserStubs`
 * alias does not cover, and that the bundle executes in a sandbox with no
 * Node globals at all (no `__dirname`, `process`, `Buffer`, `require` other
 * than `'vscode'`) without throwing, exporting `activate`/`deactivate`.
 *
 * This does NOT call `activate()`: that requires a real `vscode` module
 * with far more surface than this sandbox provides. The complementary,
 * heavier check that a real `activate()` succeeds in a real browser engine
 * lives in `test/web/` (`npm run test:web`, via `@vscode/test-web`).
 */

import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import * as path from 'node:path';
import * as vm from 'node:vm';
import * as vscodeMock from './__mocks__/vscode';

const REPO_ROOT   = path.resolve(__dirname, '..', '..');
const BUNDLE_PATH = path.join(REPO_ROOT, 'dist', 'extension.browser.js');

// Symbols that must never appear in the browser bundle: classes that are
// Node-only (child_process/fs-dependent), plus `node:`-prefixed specifiers
// that `browserStubs` in esbuild.js does not alias (only bare specifiers
// like `'fs'` are covered).
//
// This check only means something against the DEV bundle (`node esbuild.js`,
// no `--production`). Minification renames classes/functions to short
// mangled identifiers, so a `--production` bundle would "pass" this scan
// even with the exact same Node-dependent code still present. That's how
// GradleTestRunner/KotlinTestController were first found leaking in here:
// they were transitively pulled in via CodeLensProvider.ts importing
// `isTestFun` from KotlinTestController.ts (which also imports
// GradleTestRunner), invisible in `--production` builds, plainly visible
// in the dev bundle. Fixed by extracting isTestFun into the dependency-free
// src/testing/TestAnnotations.ts. CI builds dev before running `npm test`
// (see .github/workflows/ci.yml), so this check runs against the meaningful
// variant there.
const FORBIDDEN_SYMBOLS = [
  'GradleTestRunner',
  'GradleRootDetector',
  'detectGradleRoot',
  'KotlinTestController',
  'LogcatService',
  'AdbDeviceWatcher',
  'class AdbBinary',
  'node:fs',
  'node:path',
  'node:os',
  'node:child_process',
  'node:worker_threads',
  'node:zlib',
  'node:util',
  'node:crypto',
];

describe('Web bundle: no Node-only leakage into dist/extension.browser.js', () => {
  it.each(FORBIDDEN_SYMBOLS)('does not reference "%s"', (symbol) => {
    if (!existsSync(BUNDLE_PATH)) return; // fresh checkout, CI always builds first
    const src = readFileSync(BUNDLE_PATH, 'utf8');
    expect(
      src.includes(symbol),
      `dist/extension.browser.js references "${symbol}", a Node-only dependency ` +
      `leaked into the web bundle (tree-shaking regression, or a new "node:"-prefixed ` +
      `import that bypasses esbuild.js's browserStubs alias).`,
    ).toBe(false);
  });

  it('executes with no Node globals available, requiring only "vscode", and exports activate/deactivate', () => {
    if (!existsSync(BUNDLE_PATH)) return;
    const src = readFileSync(BUNDLE_PATH, 'utf8');

    const unexpectedRequires: string[] = [];
    const sandboxModule = { exports: {} as Record<string, unknown> };
    const sandbox = {
      module:  sandboxModule,
      exports: sandboxModule.exports,
      require: (specifier: string) => {
        if (specifier === 'vscode') return vscodeMock; // real, maintained API surface
        unexpectedRequires.push(specifier);
        return {};
      },
      console,
      TextEncoder, TextDecoder, URL, Promise, setTimeout, clearTimeout,
      // __dirname, __filename, process, Buffer, global: deliberately ABSENT.
      // This is what makes the sandbox faithfully reproduce the real Web
      // Extension Host, which has no CJS wrapper and no Node globals at all.
    };
    vm.createContext(sandbox);

    expect(() => new vm.Script(src, { filename: 'extension.browser.js' }).runInContext(sandbox))
      .not.toThrow();

    expect(unexpectedRequires).toEqual([]);
    expect(typeof sandboxModule.exports.activate).toBe('function');
    expect(typeof sandboxModule.exports.deactivate).toBe('function');
  });
});
