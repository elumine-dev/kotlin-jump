/* eslint-disable no-console */
/**
 * Headless perf benchmark. Loads the entire test/kotlin-jump-demo
 * fixture into a real `SymbolIndex`, then runs each user-visible code
 * path (Definition, References, FindUsagesEngine internals, Hover-like
 * lookups, IndexStore save+load) N times and records latency stats.
 *
 * Output: media/perf/<label>.json — min / p50 / p95 / max per scenario,
 * total wall time, scenarios count.
 *
 * Usage:
 *   npm run compile && node dist/perf/perf-bench.js <label>
 *   e.g. node dist/perf/perf-bench.js baseline
 *        node dist/perf/perf-bench.js after-phase3
 *
 * Then `node dist/perf/perf-diff.js baseline after-phase3` to compare.
 *
 * Note: numbers are in-process measurements. Real cold-start latency
 * (process spawn + workspace activation) isn't captured here — that
 * would require full extension-host startup, which we already have a
 * separate flow for. This bench focuses on the hot paths inside an
 * already-running extension host.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as zlib from 'node:zlib';
import { promisify } from 'node:util';

// `vscode` is aliased to test/unit/__mocks__/vscode.ts at build time
// (see esbuild.js perf entry). Providers run headless — no extension host.
import * as vscodeMock from 'vscode';
import { SymbolIndex } from '../src/indexer/SymbolIndex';
import { parse } from '../src/indexer/KotlinParser';
import { KotlinDefinitionProvider } from '../src/providers/DefinitionProvider';
import { KotlinReferenceProvider } from '../src/providers/ReferenceProvider';
import { scanForUsagesWithTarget, resolveSearchTarget } from '../src/providers/FindUsagesEngine';
import { mockDocument } from '../test/unit/helpers';
import { Position } from '../test/unit/__mocks__/vscode';
import * as IndexStore from '../src/indexer/IndexStore';
import { isInsideCommentOrString } from '../src/util/textUtils';
import { findDeadIslands } from '../src/providers/deadIslands';

const FIXTURE = path.resolve(__dirname, '../../test/kotlin-jump-demo/src/main/kotlin');
const REPO_ROOT = path.resolve(__dirname, '../..');

interface ScenarioResult {
  name: string;
  runs: number;
  minMs: number;
  p50Ms: number;
  p95Ms: number;
  maxMs: number;
  totalMs: number;
}

interface BenchOutput {
  label: string;
  timestamp: string;
  fixture: { files: number; symbols: number };
  scenarios: ScenarioResult[];
}

function loadAllKotlinFiles(): { uri: string; src: string }[] {
  const out: { uri: string; src: string }[] = [];
  function walk(dir: string) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith('.kt')) {
        out.push({ uri: `file://${p}`, src: fs.readFileSync(p, 'utf8') });
      }
    }
  }
  walk(FIXTURE);
  return out;
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[idx];
}

async function bench(name: string, runs: number, body: () => unknown | Promise<unknown>): Promise<ScenarioResult> {
  // Warm-up — discard first 3 runs so JIT settles.
  for (let i = 0; i < 3; i++) await body();
  const samples: number[] = [];
  const t0 = performance.now();
  for (let i = 0; i < runs; i++) {
    const s = performance.now();
    await body();
    samples.push(performance.now() - s);
  }
  const totalMs = performance.now() - t0;
  samples.sort((a, b) => a - b);
  return {
    name,
    runs,
    minMs:   +samples[0].toFixed(3),
    p50Ms:   +percentile(samples, 50).toFixed(3),
    p95Ms:   +percentile(samples, 95).toFixed(3),
    maxMs:   +samples[samples.length - 1].toFixed(3),
    totalMs: +totalMs.toFixed(3),
  };
}

async function main(): Promise<void> {
  const label = process.argv[2] ?? 'unlabeled';
  console.log(`\n[perf-bench] label=${label}`);

  // Build the index from the fixture.
  const index = new SymbolIndex();
  const codeMap: Record<string, string> = {};
  const files = loadAllKotlinFiles();
  for (const { uri, src } of files) {
    codeMap[uri] = src;
    index.add(parse(uri, src));
  }
  index.finalize();

  // Mock workspace.fs.readFile so the engine can scan candidate files.
  (vscodeMock.workspace.fs as any).readFile = async (uri: any) => {
    const s = typeof uri.toString === 'function' ? uri.toString() : String(uri);
    return Buffer.from(codeMap[s] ?? '');
  };

  console.log(`[perf-bench] indexed ${files.length} files, ${index.stats().symbols} symbols`);

  function fileUri(rel: string) { return `file://${path.resolve(FIXTURE, rel)}`; }

  // Helper: find Nth code-occurrence (skipping comments/strings).
  function positionOf(uri: string, word: string, occurrence = 1): { line: number; column: number } {
    const src = codeMap[uri];
    if (!src) throw new Error(`fixture missing: ${uri}`);
    const lines = src.split('\n');
    let count = 0;
    for (let i = 0; i < lines.length; i++) {
      let idx = -1;
      while ((idx = lines[i].indexOf(word, idx + 1)) !== -1) {
        const before = idx === 0 ? '' : lines[i][idx - 1];
        const after  = lines[i][idx + word.length] ?? '';
        if (/\w/.test(before) || /\w/.test(after)) continue;
        if (isInsideCommentOrString(lines[i], idx)) continue;
        count++;
        if (count === occurrence) return { line: i, column: idx };
      }
    }
    throw new Error(`'${word}' code-occurrence ${occurrence} not found in ${uri}`);
  }

  // Pre-resolve every scenario's position so `bench()` only times the work
  // we care about — not the position lookup.
  const targets = [
    { uri: fileUri('com/example/demo/VisualBugsDemo.kt'),  word: 'getQuantityString', occ: 2, kind: 'private' },
    { uri: fileUri('com/example/demo/NullSafetyDemo.kt'),  word: 'getPokemonName',    occ: 1, kind: 'public-fun' },
    { uri: fileUri('com/example/SyntaxVerification.kt'),   word: 'PlainClass',        occ: 1, kind: 'class' },
    { uri: fileUri('com/example/SyntaxVerification.kt'),   word: 'Singleton',         occ: 1, kind: 'object' },
    { uri: fileUri('com/example/app/Constants.kt'),        word: 'TIMEOUT_MS',        occ: 1, kind: 'public-const' },
  ].map(t => ({ ...t, pos: positionOf(t.uri, t.word, t.occ) }));

  const scenarios: ScenarioResult[] = [];

  // ── 1. Definition latency per kind ───────────────────────────────────
  const defProvider = new KotlinDefinitionProvider(index);
  for (const t of targets) {
    const doc = mockDocument(t.uri, codeMap[t.uri]);
    const pos = new Position(t.pos.line, t.pos.column + 1);
    scenarios.push(await bench(`definition.${t.kind}`, 200, () => {
      defProvider.provideDefinition(doc, pos);
    }));
  }

  // ── 2. References latency per kind ───────────────────────────────────
  const refProvider = new KotlinReferenceProvider(index);
  for (const t of targets) {
    const doc = mockDocument(t.uri, codeMap[t.uri]);
    const pos = new Position(t.pos.line, t.pos.column + 1);
    scenarios.push(await bench(`references.${t.kind}`, 50, async () => {
      await refProvider.provideReferences(doc, pos,
        { includeDeclaration: true } as any,
        { isCancellationRequested: false } as any);
    }));
  }

  // ── 3. resolveSearchTarget alone (Cmd+Click hot path) ────────────────
  for (const t of targets) {
    const doc = mockDocument(t.uri, codeMap[t.uri]);
    scenarios.push(await bench(`resolveTarget.${t.kind}`, 500, () => {
      resolveSearchTarget(t.word, doc, index);
    }));
  }

  // ── 4. scanForUsagesWithTarget (engine scan) ─────────────────────────
  for (const t of targets) {
    const doc = mockDocument(t.uri, codeMap[t.uri]);
    const target = resolveSearchTarget(t.word, doc, index);
    const allUris = index.fileUriStrings();
    scenarios.push(await bench(`scan.${t.kind}`, 50, async () => {
      await scanForUsagesWithTarget(t.word, target, index, allUris,
        { isCancellationRequested: false } as any);
    }));
  }

  // ── 5. IndexStore save+load round-trip ───────────────────────────────
  // Stub a tiny in-memory storage so we measure (de)compression + JSON.
  const fakeStorageBytes: { v?: Uint8Array } = {};
  const origWrite = (vscodeMock.workspace.fs as any).writeFile;
  const origCreate = (vscodeMock.workspace.fs as any).createDirectory;
  const origRead = (vscodeMock.workspace.fs as any).readFile;
  const origJoin = (vscodeMock.Uri as any).joinPath;
  (vscodeMock.workspace.fs as any).createDirectory = async () => undefined;
  (vscodeMock.workspace.fs as any).writeFile = async (_u: any, content: any) => { fakeStorageBytes.v = content; };
  (vscodeMock.workspace.fs as any).readFile = async () => {
    if (!fakeStorageBytes.v) throw new Error('empty');
    return fakeStorageBytes.v;
  };
  (vscodeMock.Uri as any).joinPath = (..._args: any[]) => ({ fsPath: '/tmp/kj-bench', toString: () => 'file:///tmp/kj-bench' });

  const ctx: any = { storageUri: { fsPath: '/tmp/kj-bench', toString: () => 'file:///tmp/kj-bench' } };
  const stats = new Map<string, { mtime: number; size: number }>();
  for (const u of index.fileUriStrings()) stats.set(u, { mtime: 1, size: 100 });

  scenarios.push(await bench('snapshot.save', 20, async () => {
    await IndexStore.save(index, stats, ctx);
  }));
  scenarios.push(await bench('snapshot.load', 20, async () => {
    await IndexStore.load(ctx);
  }));

  // KJ-046: full dead-island analysis over the fixture (candidates via
  // explainSymbols/explainMembers, attributed harvest, liveness fixpoint).
  const islandSources = files.map(f => ({ path: f.uri.replace('file://', ''), text: f.src }));
  scenarios.push(await bench('deadIslands.workspace', 10, () => {
    findDeadIslands({ sources: islandSources, testSourceSets: ['test/java', 'test/kotlin', 'androidTest'] });
  }));

  // Measure compressed-vs-raw size
  const compressedSize = fakeStorageBytes.v ? fakeStorageBytes.v.byteLength : 0;
  const gunzipped = compressedSize > 0 ? zlib.gunzipSync(Buffer.from(fakeStorageBytes.v!)).byteLength : 0;

  (vscodeMock.workspace.fs as any).writeFile = origWrite;
  (vscodeMock.workspace.fs as any).readFile = origRead;
  (vscodeMock.workspace.fs as any).createDirectory = origCreate;
  (vscodeMock.Uri as any).joinPath = origJoin;

  // ── Output ───────────────────────────────────────────────────────────
  const out: BenchOutput = {
    label,
    timestamp: new Date().toISOString(),
    fixture: { files: files.length, symbols: index.stats().symbols },
    scenarios,
  };
  const outDir = path.join(REPO_ROOT, 'media', 'perf');
  fs.mkdirSync(outDir, { recursive: true });
  const outFile = path.join(outDir, `${label}.json`);
  fs.writeFileSync(outFile, JSON.stringify(out, null, 2));

  // Pretty-print summary table.
  console.log(`\n[perf-bench] snapshot: ${gunzipped} B raw → ${compressedSize} B gzip (ratio ${(gunzipped / compressedSize).toFixed(2)}×)`);
  console.log(`[perf-bench] wrote ${outFile}\n`);
  const pad = (s: string, n: number) => s.length >= n ? s : s + ' '.repeat(n - s.length);
  console.log(pad('scenario', 36), pad('runs', 6), pad('min(ms)', 10), pad('p50(ms)', 10), pad('p95(ms)', 10), pad('max(ms)', 10));
  console.log('-'.repeat(100));
  for (const s of scenarios) {
    console.log(
      pad(s.name, 36),
      pad(String(s.runs), 6),
      pad(s.minMs.toFixed(3), 10),
      pad(s.p50Ms.toFixed(3), 10),
      pad(s.p95Ms.toFixed(3), 10),
      pad(s.maxMs.toFixed(3), 10),
    );
  }
  console.log();
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
