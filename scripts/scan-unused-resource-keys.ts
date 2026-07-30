/**
 * Dry-run harness for KJ-031, outside VS Code.
 *
 *   npx tsx scripts/scan-unused-resource-keys.ts <project-root> [--json]
 *
 * Walks a project the way `ResourceCorpus` does and prints what the detector
 * would report. This is the gate the plan puts before any UI work: the numbers
 * here are checked against a manual one-by-one audit, and a mismatch means the
 * core is wrong, not the audit.
 */

import * as fs from 'fs';
import * as path from 'path';
import {
  collectValueKeyDeclarations,
  parseValuesPath,
} from '../src/indexer/ValueResourceScanner';
import {
  findUnusedResourceKeys,
  UnusedResourceKey,
} from '../src/providers/unusedResourceKeys';

const SOURCE_RE = /\.(kt|kts|java|xml|gradle|pro|properties|toml)$/;
const SKIP_DIRS = new Set(['node_modules', 'build', '.git', '.gradle', 'out', 'dist', 'target', '.idea']);

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

function main(): void {
  const root = process.argv[2];
  if (!root) {
    console.error('usage: scan-unused-resource-keys <project-root> [--json]');
    process.exit(2);
  }
  const asJson = process.argv.includes('--json');

  const sources: { path: string; text: string }[] = [];
  const moduleDirs: string[] = [];
  walk(root, file => {
    if (/[\\/]build\.gradle(\.kts)?$/.test(file)) {
      moduleDirs.push(file.replace(/[\\/]build\.gradle(\.kts)?$/, ''));
    }
    if (!SOURCE_RE.test(file)) return;
    try {
      sources.push({ path: file, text: fs.readFileSync(file, 'utf8') });
    } catch {
      // unreadable file: the real corpus would mark the scan truncated
    }
  });

  const declarations = sources
    .filter(s => parseValuesPath(s.path) !== undefined)
    .flatMap(s => collectValueKeyDeclarations(s.path, s.text, moduleDirs));

  const modulesWithCode = moduleDirs.filter(dir =>
    sources.some(s => s.path.startsWith(`${dir}${path.sep}`) && /\.(kt|java)$/.test(s.path)));
  const libraryModules = moduleDirs.filter(dir =>
    sources.some(s => s.path.startsWith(`${dir}${path.sep}build.gradle`)
      && /com\.android\.library|android-library/.test(s.text)));

  const started = Date.now();
  const findings = findUnusedResourceKeys({
    declarations, sources, modulesWithCode, libraryModules,
  });
  const elapsed = Date.now() - started;

  if (asJson) {
    console.log(JSON.stringify(
      findings.map(f => ({
        kind: f.kind,
        name: f.name,
        variants: f.variants.map(v => path.relative(root, v.path)),
        library: f.isLibraryModule,
      })),
      null, 1,
    ));
    return;
  }

  const byKind = new Map<string, number>();
  for (const f of findings) byKind.set(f.kind, (byKind.get(f.kind) ?? 0) + 1);
  const multi = findings.filter((f: UnusedResourceKey) => f.variants.length > 1).length;

  console.log(`sources        : ${sources.length}`);
  console.log(`declared keys  : ${declarations.length}`);
  console.log(`modules        : ${moduleDirs.length} (${modulesWithCode.length} with code, ${libraryModules.length} library)`);
  console.log(`unused keys    : ${findings.length}`);
  for (const [kind, n] of [...byKind].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${kind.padEnd(8)} ${n}`);
  }
  console.log(`multi-variant  : ${multi}`);
  console.log(`elapsed        : ${elapsed} ms`);
}

main();
