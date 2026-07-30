/**
 * Dry-run harness for KJ-032, outside VS Code.
 *
 *   npx tsx scripts/scan-unused-symbols.ts <project-root> [--json] [--why]
 *
 * `--why` is the reason this script exists. It prints one line per RAW
 * candidate saying what happened to it: the guard that took it out
 * (`F5:@Serializable`), what kept it alive (`alive:main`), or the verdict.
 * Auditing a few hundred findings without that is guesswork, and the gate
 * would get rubber-stamped instead of crossed.
 */

import * as fs from 'fs';
import * as path from 'path';
import {
  UnusedSymbol,
  explainSymbols,
  findUnusedSymbols,
} from '../src/providers/unusedSymbols';

const SOURCE_RE = /\.(kt|kts|java|xml|gradle|pro|properties|toml)$/;
const SKIP_DIRS = new Set(['node_modules', 'build', '.git', '.gradle', 'out', 'dist', 'target', '.idea']);
const TEST_SOURCE_SETS = ['test/java', 'test/kotlin', 'androidTest', 'jvmTest', 'commonTest'];
const IGNORE_PATHS = ['**/buildSrc/**', '**/build-logic/**'];

function walk(dir: string, hit: (file: string) => void): void {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) walk(full, hit);
    } else {
      hit(full);
    }
  }
}

function collect(root: string) {
  const sources: { path: string; text: string }[] = [];
  const moduleDirs: string[] = [];
  walk(root, file => {
    if (/[\\/]build\.gradle(\.kts)?$/.test(file)) {
      moduleDirs.push(file.replace(/[\\/]build\.gradle(\.kts)?$/, ''));
    }
    // META-INF entries carry no extension: the SPI name IS the file name.
    const isServiceEntry = /[\\/]META-INF[\\/]services[\\/]/.test(file);
    if (!SOURCE_RE.test(file) && !isServiceEntry) return;
    try {
      sources.push({ path: file, text: fs.readFileSync(file, 'utf8') });
    } catch {
      // unreadable file: the real corpus would mark the scan truncated
    }
  });

  const publishedModules = moduleDirs.filter(dir => {
    const build = sources.find(s => s.path.startsWith(`${dir}${path.sep}build.gradle`));
    return build !== undefined && /maven-publish|com\.vanniktech\.maven\.publish/.test(build.text);
  });
  const libraryModules = moduleDirs.filter(dir =>
    sources.some(s => s.path.startsWith(`${dir}${path.sep}build.gradle`)
      && /com\.android\.library|java-library/.test(s.text)));

  return { sources, moduleDirs, publishedModules, libraryModules };
}

function main(): void {
  const root = process.argv[2];
  if (!root) {
    console.error('usage: scan-unused-symbols <project-root> [--json] [--why]');
    process.exit(2);
  }
  const asJson = process.argv.includes('--json');
  const why = process.argv.includes('--why');

  const { sources, moduleDirs, publishedModules, libraryModules } = collect(root);
  const input = {
    sources,
    testSourceSets: TEST_SOURCE_SETS,
    publishedModules,
    libraryModules,
    ignorePaths: IGNORE_PATHS,
  };

  if (why) {
    const rows = explainSymbols(input);
    const byOutcome = new Map<string, number>();
    for (const r of rows) byOutcome.set(r.outcome, (byOutcome.get(r.outcome) ?? 0) + 1);

    console.log(`raw candidates : ${rows.length}\n`);
    console.log('outcome distribution (most common first)');
    for (const [outcome, n] of [...byOutcome].sort((a, b) => b[1] - a[1])) {
      console.log(`  ${String(n).padStart(5)}  ${outcome}`);
    }
    console.log('\nsurviving candidates');
    for (const r of rows.filter(x => x.outcome === 'unreferenced' || x.outcome === 'testOnly')) {
      console.log(`  ${r.outcome.padEnd(12)} ${r.kind.padEnd(11)} ${r.name.padEnd(42)} ${path.relative(root, r.path)}:${r.line + 1}`);
    }
    return;
  }

  const started = Date.now();
  const findings = findUnusedSymbols(input);
  const elapsed = Date.now() - started;

  if (asJson) {
    console.log(JSON.stringify(
      findings.map(f => ({
        name: f.name,
        kind: f.kind,
        verdict: f.verdict,
        path: path.relative(root, f.path),
        line: f.line + 1,
        removable: f.removeStart !== -1,
        deprecated: f.isDeprecated,
        library: f.isLibraryModule,
      })),
      null, 1,
    ));
    return;
  }

  const unreferenced = findings.filter((f: UnusedSymbol) => f.verdict === 'unreferenced');
  const testOnly = findings.filter((f: UnusedSymbol) => f.verdict === 'testOnly');
  const byKind = new Map<string, number>();
  for (const f of unreferenced) byKind.set(f.kind, (byKind.get(f.kind) ?? 0) + 1);

  console.log(`sources        : ${sources.length}`);
  console.log(`modules        : ${moduleDirs.length} (${publishedModules.length} published, ${libraryModules.length} library)`);
  console.log(`unreferenced   : ${unreferenced.length}`);
  for (const [kind, n] of [...byKind].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${kind.padEnd(12)} ${n}`);
  }
  console.log(`test-only      : ${testOnly.length}`);
  console.log(`removable      : ${findings.filter(f => f.removeStart !== -1).length} / ${findings.length}`);
  console.log(`elapsed        : ${elapsed} ms`);
}

main();
