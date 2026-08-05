/**
 * Dry-run harness for the five per-file detectors, outside VS Code.
 *
 *   npx vite-node scripts/scan-dead-code-sweep.ts <project-root> [options]
 *
 *     --detector=<name>   imports | parameters | declarations | locals | writeOnly
 *     --include-tests     keep test source sets, as the editor does
 *     --list              one line per finding: path:line:name
 *     --json              machine-readable, for a diff against another analyzer
 *
 * KJ-009, KJ-025, KJ-026, KJ-027 and KJ-028 only ever ran on the active editor
 * tab, so nothing measured them on a corpus. This runs `sweepFile`, the exact
 * code path the KJ-030 command executes, rather than a reconstruction of it.
 *
 * These detectors take a text and know nothing of paths, while KJ-032 and
 * KJ-042 filter their own corpus. The filtering therefore happens here, and
 * what it discards is printed rather than silently dropped.
 */

import * as fs from 'fs';
import * as path from 'path';
import { sweepFile, summarize, SweepDetector, SweepFinding } from '../src/providers/DeadCodeSweep';
import { isTestSourceSet } from '../src/util/testPaths';
import { isBuildArtifactPath, isGeneratedSource } from '../src/util/resourceAllowlists';

const SOURCE_RE = /\.(kt|java)$/;
const SKIP_DIRS = new Set(['node_modules', 'build', '.git', '.gradle', 'out', 'dist', 'target', '.idea']);
const TEST_SOURCE_SETS = ['test/java', 'test/kotlin', 'androidTest', 'jvmTest', 'commonTest'];
const DETECTORS: SweepDetector[] = ['imports', 'parameters', 'declarations', 'locals', 'writeOnly'];

function walk(dir: string, hit: (file: string) => void): void {
  let entries: fs.Dirent[];
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isSymbolicLink()) continue;
    if (entry.isDirectory()) { if (!SKIP_DIRS.has(entry.name)) walk(full, hit); }
    else if (SOURCE_RE.test(entry.name)) hit(full);
  }
}

function main(): void {
  const args = process.argv.slice(2);
  const root = args.find(a => !a.startsWith('--'));
  if (!root) {
    console.error('usage: scan-dead-code-sweep.ts <project-root> [--detector=<name>] [--include-tests] [--list] [--json]');
    process.exit(2);
  }

  const only = args.find(a => a.startsWith('--detector='))?.split('=')[1] as SweepDetector | undefined;
  if (only && !DETECTORS.includes(only)) {
    console.error(`unknown detector '${only}', expected one of: ${DETECTORS.join(', ')}`);
    process.exit(2);
  }
  const includeTests = args.includes('--include-tests');

  const skipped = { tests: 0, generated: 0, buildArtifacts: 0 };
  const findings: { path: string; finding: SweepFinding }[] = [];
  let scanned = 0;
  const started = Date.now();

  walk(root, file => {
    const rel = path.relative(root, file);
    if (isBuildArtifactPath(rel)) { skipped.buildArtifacts++; return; }
    if (!includeTests && isTestSourceSet(rel, TEST_SOURCE_SETS)) { skipped.tests++; return; }
    let text: string;
    try { text = fs.readFileSync(file, 'utf8'); } catch { return; }
    if (isGeneratedSource(text)) { skipped.generated++; return; }

    scanned++;
    for (const finding of sweepFile(text, rel.endsWith('.java') ? 'java' : 'kotlin')) {
      if (only && finding.detector !== only) continue;
      findings.push({ path: rel, finding });
    }
  });

  const elapsed = Date.now() - started;
  const counts = summarize(findings.map(f => f.finding));

  if (args.includes('--json')) {
    console.log(JSON.stringify({
      root, scanned, skipped, elapsedMs: elapsed,
      counts: Object.fromEntries(counts),
      findings: findings.map(({ path: p, finding }) => ({
        path: p,
        detector: finding.detector,
        line: finding.line,
        character: finding.character,
        name: finding.name,
        message: finding.message,
        hasFix: finding.edits.length > 0,
      })),
    }, null, 2));
    return;
  }

  console.log(`sources scanned : ${scanned}`);
  console.log(`skipped         : ${skipped.tests} test, ${skipped.generated} generated, ${skipped.buildArtifacts} build artifact`);
  console.log(`findings        : ${findings.length}`);
  for (const d of DETECTORS) {
    if (only && d !== only) continue;
    console.log(`  ${d.padEnd(13)} ${counts.get(d) ?? 0}`);
  }
  const withFix = findings.filter(f => f.finding.edits.length > 0).length;
  console.log(`with a fix      : ${withFix} of ${findings.length}`);
  console.log(`elapsed         : ${elapsed} ms`);

  if (args.includes('--list')) {
    console.log('');
    for (const { path: p, finding } of findings) {
      console.log(`${p}:${finding.line + 1} [${finding.detector}] ${finding.name}`);
    }
  }
}

main();
