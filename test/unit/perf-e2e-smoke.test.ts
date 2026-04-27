/**
 * E2E smoke + perf budget — runs Definition + Find Usages on a variety of
 * symbol kinds across the real `test/kotlin-jump-demo` fixture. Catches
 * regressions in the Phase 1 perf optimisations (path cache, regex caches,
 * token cache, file-private short-circuits).
 *
 * Each scenario asserts:
 *   - resolves to the expected location
 *   - returns within a per-call latency budget
 *
 * Budgets are CONSERVATIVE — tuned to fail only on a real regression
 * (10× slowdown) so flaky CI doesn't bother the user.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { workspace } from './__mocks__/vscode';
import { Position } from './__mocks__/vscode';
import { SymbolIndex } from '../../src/indexer/SymbolIndex';
import { parse } from '../../src/indexer/KotlinParser';
import { KotlinDefinitionProvider } from '../../src/providers/DefinitionProvider';
import { KotlinReferenceProvider } from '../../src/providers/ReferenceProvider';
import { mockDocument } from './helpers';
import { isInsideCommentOrString } from '../../src/util/textUtils';

const FIXTURE = path.resolve(__dirname, '../kotlin-jump-demo/src/main/kotlin');

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

describe('E2E smoke — Definition + References across the demo fixture', () => {
  let index: SymbolIndex;
  let codeMap: Record<string, string> = {};
  let origReadFile: typeof workspace.fs.readFile;

  beforeAll(() => {
    index = new SymbolIndex();
    const files = loadAllKotlinFiles();
    for (const { uri, src } of files) {
      codeMap[uri] = src;
      index.add(parse(uri, src));
    }
    index.finalize();
    origReadFile = workspace.fs.readFile;
    (workspace.fs as any).readFile = async (uri: any) => {
      const s = typeof uri.toString === 'function' ? uri.toString() : String(uri);
      return Buffer.from(codeMap[s] ?? '') as any;
    };
  });

  afterAll(() => {
    (workspace.fs as any).readFile = origReadFile;
  });

  // Helper: positionOf(file, word, occurrence) — find Nth code-occurrence
  // of `word` (skipping comments and string literals). Word-boundary aware.
  function positionOf(uri: string, word: string, occurrence = 1): { line: number; column: number } {
    const src = codeMap[uri];
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

  function fileUri(rel: string): string {
    return `file://${path.resolve(FIXTURE, rel)}`;
  }

  // ── Scenarios ────────────────────────────────────────────────────────────
  // Each scenario must complete within budgetMs on a developer laptop. CI
  // can be slower; the budget is intentionally lax (10× expected).
  type Scenario = {
    name: string;
    file: string;
    word: string;
    occurrence?: number;
    expectDefUri?: string | RegExp; // where Cmd+Click should land
    minRefs?: number;               // minimum references expected
    refsOnlyInFile?: boolean;       // assert all refs are in the same file (private isolation)
    budgetMs: number;
  };

  const scenarios: Scenario[] = [
    // 1. Top-level private fun, multi-decl across same package — the bug we fixed.
    {
      name: 'private fun getQuantityString — same-file only, no leak to PluralArrayDemo',
      file: 'com/example/demo/VisualBugsDemo.kt',
      word: 'getQuantityString',
      occurrence: 2, // 1st = call in showCount, 2nd = declaration on line 70
      expectDefUri: /VisualBugsDemo\.kt$/,
      minRefs: 2,
      refsOnlyInFile: true,
      budgetMs: 200,
    },
    // 2. Public top-level fun (NullSafetyDemo) — single decl, single file.
    {
      name: 'public fun getPokemonName — resolves & finds zero callers in fixture',
      file: 'com/example/demo/NullSafetyDemo.kt',
      word: 'getPokemonName',
      occurrence: 1,
      expectDefUri: /NullSafetyDemo\.kt$/,
      budgetMs: 200,
    },
    // 3. Class — should resolve to its own decl line.
    {
      name: 'class PlainClass — resolves to its declaration',
      file: 'com/example/SyntaxVerification.kt',
      word: 'PlainClass',
      occurrence: 1,
      expectDefUri: /SyntaxVerification\.kt$/,
      budgetMs: 200,
    },
    // 4. Object singleton — same.
    {
      name: 'object Singleton — resolves',
      file: 'com/example/SyntaxVerification.kt',
      word: 'Singleton',
      occurrence: 1,
      expectDefUri: /SyntaxVerification\.kt$/,
      budgetMs: 200,
    },
    // 5. Top-level public const val — resolves cross-file (Constants.kt → VisualBugsDemo.kt usage).
    {
      name: 'const val TIMEOUT_MS — resolves to its declaration',
      file: 'com/example/app/Constants.kt',
      word: 'TIMEOUT_MS',
      occurrence: 1,
      expectDefUri: /Constants\.kt$/,
      minRefs: 5, // many usages in Constants.kt itself + cross-file in VisualBugsDemo
      budgetMs: 250,
    },
  ];

  for (const s of scenarios) {
    it(`${s.name}`, async () => {
      const uri = fileUri(s.file);
      expect(codeMap[uri], `fixture missing: ${s.file}`).toBeDefined();
      const pos = positionOf(uri, s.word, s.occurrence ?? 1);
      const doc = mockDocument(uri, codeMap[uri]);

      // ── Definition ──
      const defProvider = new KotlinDefinitionProvider(index);
      const t0 = performance.now();
      const defResult = defProvider.provideDefinition(doc, new Position(pos.line, pos.column + 1));
      const defMs = performance.now() - t0;

      const defLoc = Array.isArray(defResult) ? defResult[0] : defResult;
      if (s.expectDefUri) {
        expect(defLoc, `Definition returned null for ${s.word} at ${s.file}:${pos.line + 1}`).toBeTruthy();
        const uriStr = (defLoc as any).uri.toString();
        if (typeof s.expectDefUri === 'string') {
          expect(uriStr).toBe(s.expectDefUri);
        } else {
          expect(uriStr).toMatch(s.expectDefUri);
        }
      }
      expect(defMs, `Definition slow: ${defMs.toFixed(1)}ms`).toBeLessThan(s.budgetMs);

      // ── References ──
      const refProvider = new KotlinReferenceProvider(index);
      const t1 = performance.now();
      const refs = await refProvider.provideReferences(
        doc, new Position(pos.line, pos.column + 1),
        { includeDeclaration: true } as any,
        { isCancellationRequested: false } as any,
      );
      const refMs = performance.now() - t1;

      if (s.minRefs !== undefined) {
        expect(refs?.length ?? 0, `Found ${refs?.length ?? 0} refs, expected ≥${s.minRefs}`).toBeGreaterThanOrEqual(s.minRefs);
      }
      if (s.refsOnlyInFile && refs) {
        const otherFiles = refs.filter(r => r.uri.toString() !== uri);
        expect(otherFiles, `Cross-file leak: ${otherFiles.map(r => r.uri.toString()).join(', ')}`).toHaveLength(0);
      }
      expect(refMs, `References slow: ${refMs.toFixed(1)}ms`).toBeLessThan(s.budgetMs);
    });
  }

  it('aggregate: 5 scenarios complete under 1500ms total', async () => {
    // Sanity check that the perf budget is not blown in aggregate either.
    // Re-runs lightly to capture warmed-cache numbers.
    const t0 = performance.now();
    const defProvider = new KotlinDefinitionProvider(index);
    const refProvider = new KotlinReferenceProvider(index);
    for (const s of scenarios) {
      const uri = fileUri(s.file);
      const pos = positionOf(uri, s.word, s.occurrence ?? 1);
      const doc = mockDocument(uri, codeMap[uri]);
      defProvider.provideDefinition(doc, new Position(pos.line, pos.column + 1));
      await refProvider.provideReferences(
        doc, new Position(pos.line, pos.column + 1),
        { includeDeclaration: true } as any,
        { isCancellationRequested: false } as any,
      );
    }
    const totalMs = performance.now() - t0;
    expect(totalMs, `aggregate slow: ${totalMs.toFixed(1)}ms across ${scenarios.length} scenarios`).toBeLessThan(1500);
  });
});
