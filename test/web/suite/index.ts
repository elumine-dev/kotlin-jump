// Bootstrap for the @vscode/test-web smoke test suite. Bundled by esbuild
// into a single browser file (dist/test-web/suite/index.js): Mocha-browser
// requires everything in one file, no dynamic `import`/`require` at runtime.
//
// `mocha.setup({ui: 'tdd'})` must run BEFORE activation.test.ts's top-level
// `suite(...)` call executes, since that's what defines the `suite`/`test`
// globals. A static `import './activation.test'` at the top of this file
// would run too early (ES imports execute before this module's own body).
// `require(...)` inside run() defers it correctly: esbuild still bundles
// the target statically, but only evaluates its top-level code when this
// require() call is reached at runtime.
import 'mocha/mocha.js';

declare const mocha: {
  setup(opts: { ui: string; reporter?: undefined }): void;
  run(cb: (failures: number) => void): void;
};

export function run(): Promise<void> {
  return new Promise((resolve, reject) => {
    mocha.setup({ ui: 'tdd', reporter: undefined });
    require('./activation.test');
    mocha.run((failures: number) => {
      if (failures > 0) reject(new Error(`${failures} web smoke test(s) failed.`));
      else resolve();
    });
  });
}
