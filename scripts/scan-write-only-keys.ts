/** Dry-run harness for KJ-045. npx vite-node scripts/scan-write-only-keys.ts <root> */
import * as fs from 'fs';
import * as path from 'path';
import { findWriteOnlyKeys } from '../src/providers/writeOnlyKeys';

const SOURCE_RE = /\.(kt|kts|java|xml)$/;
const SKIP_DIRS = new Set(['node_modules', 'build', '.git', '.gradle', 'out', 'dist', 'target', '.idea']);

function walk(dir: string, hit: (file: string) => void): void {
  let entries: fs.Dirent[];
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) { if (!SKIP_DIRS.has(entry.name)) walk(full, hit); }
    else if (SOURCE_RE.test(entry.name)) hit(full);
  }
}

const root = process.argv[2];
const started = Date.now();
const sources: { path: string; text: string }[] = [];
walk(root, f => { try { sources.push({ path: path.relative(root, f), text: fs.readFileSync(f, 'utf8') }); } catch { /* skip */ } });
const scan = findWriteOnlyKeys({ sources, testSourceSets: ['test/java', 'test/kotlin', 'androidTest', 'jvmTest', 'commonTest'] });
console.log(`sources  : ${sources.length}, findings: ${scan.findings.length}, poisoned: ${scan.poisoned.length}, ${Date.now() - started} ms`);
const byKind = new Map<string, number>();
for (const p of scan.poisoned) byKind.set(p.kind, (byKind.get(p.kind) ?? 0) + 1);
for (const [k, n] of byKind) console.log(`  poisoned ${k.padEnd(14)} ${n}`);
for (const p of scan.poisoned.filter(x => x.kind === 'intentExtra').slice(0, 12)) console.log(`    ${p.path}:${p.line + 1}`);
for (const f of scan.findings) console.log(`  ${f.kind.padEnd(14)} ${f.key.padEnd(46)} ${f.path}:${f.line + 1}`);
