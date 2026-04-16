/**
 * Performance guard tests for KotlinSemanticTokensProvider.
 *
 * GUARD-SEMANTIC-A  Per-run word dedup:    lookupFqn called once per unique word, not per occurrence
 * GUARD-SEMANTIC-B  Token correctness:     cache hit returns identical tokens as fresh computation
 * GUARD-SEMANTIC-C  Cache isolation:       wordCache does not leak across provideDocumentSemanticTokens calls
 * GUARD-SEMANTIC-D  Timing:                300-line file with 5 symbols × 20 occurrences each → <100ms
 *
 * These tests exist to prevent a regression where computeAndCache() called resolveBest() for every
 * word *occurrence* instead of every unique word. On a 5 000-line Kotlin file, that caused 150% CPU
 * on Apple Intel (Code Helper process). The fix adds a per-run wordCache Map inside computeAndCache().
 *
 * If GUARD-SEMANTIC-A starts failing, the per-run cache was removed or bypassed.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SymbolIndex } from '../../src/indexer/SymbolIndex';
import { parse } from '../../src/indexer/KotlinParser';
import {
  KotlinSemanticTokensProvider,
  TOKEN_TYPES,
  TOKEN_MODIFIERS,
} from '../../src/providers/SemanticTokensProvider';
import { SemanticTokensLegend } from './__mocks__/vscode';
import { mockDocument } from './helpers';

// ── Helpers ───────────────────────────────────────────────────────────────────

const NO_CANCEL = { isCancellationRequested: false } as any;

function makeLegend() {
  return new SemanticTokensLegend(TOKEN_TYPES, TOKEN_MODIFIERS) as any;
}

function addKt(index: SymbolIndex, uri: string, code: string): void {
  index.add(parse(uri, code));
}

/**
 * Builds a Kotlin document where each of `symbols` appears `occurrences` times.
 * All symbols are imported from `pkg`.
 */
function makeRepeatedSymbolDoc(
  uri: string,
  pkg: string,
  symbols: string[],
  occurrences: number,
): ReturnType<typeof mockDocument> {
  const imports = symbols.map(s => `import ${pkg}.${s}`).join('\n');
  const body = Array.from({ length: occurrences }, (_, i) =>
    symbols.map(s => `  val v${s}${i} = ${s}()`).join('\n'),
  ).join('\n');

  return mockDocument(uri, `package com.test\n${imports}\n\nclass Host {\n${body}\n}`);
}

// ── GUARD-SEMANTIC-A: Per-run word dedup ─────────────────────────────────────

describe('GUARD-SEMANTIC-A — per-run word deduplication', () => {
  it('lookupFqn called once per unique symbol, not once per occurrence', () => {
    // 3 symbols × 15 occurrences each = 45 total occurrences
    // Without wordCache: lookupFqn called 45 times (15×Foo + 15×Bar + 15×Baz)
    // With    wordCache: lookupFqn called 3 times  (1×Foo  +  1×Bar  +  1×Baz)

    const SYMBOLS = ['Foo', 'Bar', 'Baz'];
    const OCCURRENCES = 15;

    const index = new SymbolIndex();
    for (const s of SYMBOLS) {
      addKt(index, `file:///lib/${s}.kt`, `package com.ex\nclass ${s}`);
    }
    index.finalize();

    const doc = makeRepeatedSymbolDoc('file:///T.kt', 'com.ex', SYMBOLS, OCCURRENCES);
    const provider = new KotlinSemanticTokensProvider(index, makeLegend());

    const spy = vi.spyOn(index, 'lookupFqn');
    provider.provideDocumentSemanticTokens(doc, NO_CANCEL);

    // Count how many times each FQN was looked up
    const callsPerFqn: Record<string, number> = {};
    for (const [fqn] of spy.mock.calls) {
      callsPerFqn[fqn] = (callsPerFqn[fqn] ?? 0) + 1;
    }

    for (const s of SYMBOLS) {
      const fqn = `com.ex.${s}`;
      const count = callsPerFqn[fqn] ?? 0;
      expect(count, `${fqn} should be looked up once, not ${OCCURRENCES} times`).toBe(1);
    }
  });

  it('lookupFqn call count for known symbols does not grow with occurrences', () => {
    // The generated document contains unique variable names (vAlpha0, vAlpha1, ...)
    // that legitimately produce one lookupFqn each. We therefore count only the
    // FQN calls for the *repeated* symbols (Alpha, Beta) to verify the cache works.
    const SYMBOLS = ['Alpha', 'Beta'];
    const FQNS = SYMBOLS.map(s => `com.ex.${s}`);
    const index = new SymbolIndex();
    for (const s of SYMBOLS) {
      addKt(index, `file:///lib/${s}.kt`, `package com.ex\nclass ${s}`);
    }
    index.finalize();

    const provider = new KotlinSemanticTokensProvider(index, makeLegend());
    const doc10 = makeRepeatedSymbolDoc('file:///T10.kt', 'com.ex', SYMBOLS, 10);
    const spy10 = vi.spyOn(index, 'lookupFqn');
    provider.provideDocumentSemanticTokens(doc10, NO_CANCEL);
    const relevant10 = spy10.mock.calls.filter(([fqn]) => FQNS.includes(fqn)).length;
    spy10.mockRestore();

    // Fresh provider so document-level cache is empty
    const provider2 = new KotlinSemanticTokensProvider(index, makeLegend());
    const doc50 = makeRepeatedSymbolDoc('file:///T50.kt', 'com.ex', SYMBOLS, 50);
    const spy50 = vi.spyOn(index, 'lookupFqn');
    provider2.provideDocumentSemanticTokens(doc50, NO_CANCEL);
    const relevant50 = spy50.mock.calls.filter(([fqn]) => FQNS.includes(fqn)).length;
    spy50.mockRestore();

    // wordCache: each known symbol looked up exactly once, regardless of occurrences
    expect(relevant10).toBe(SYMBOLS.length);
    expect(relevant50).toBe(SYMBOLS.length);
  });
});

// ── GUARD-SEMANTIC-B: Token correctness with cache ───────────────────────────

describe('GUARD-SEMANTIC-B — tokens are correct whether from cache or fresh', () => {
  it('provideDocumentSemanticTokens returns same token count on first and second call (same version)', () => {
    const index = new SymbolIndex();
    addKt(index, 'file:///Lib.kt', 'package com.ex\nclass Widget');
    index.finalize();

    const doc = makeRepeatedSymbolDoc('file:///T.kt', 'com.ex', ['Widget'], 5);
    const provider = new KotlinSemanticTokensProvider(index, makeLegend());

    const tokens1 = provider.provideDocumentSemanticTokens(doc, NO_CANCEL);
    const tokens2 = provider.provideDocumentSemanticTokens(doc, NO_CANCEL);

    // Same document version → second call returns cached data
    expect(tokens1.data).toEqual(tokens2.data);
    expect(tokens1.resultId).toBe(tokens2.resultId);
  });

  it('highlighted tokens include all occurrences of a repeated symbol', () => {
    const index = new SymbolIndex();
    addKt(index, 'file:///Lib.kt', 'package com.ex\nclass Zap');
    index.finalize();

    // "Zap" appears 6 times in the body (6 val declarations)
    const doc = makeRepeatedSymbolDoc('file:///T.kt', 'com.ex', ['Zap'], 6);
    const provider = new KotlinSemanticTokensProvider(index, makeLegend());

    const tokens = provider.provideDocumentSemanticTokens(doc, NO_CANCEL);

    // Each token is encoded as 5 uint32s: deltaLine, deltaChar, length, type, modifiers
    const tokenCount = tokens.data.length / 5;

    // Should have at least 6 tokens for the 6 "Zap" occurrences in the body
    // (plus the class declaration token for "Host")
    expect(tokenCount).toBeGreaterThanOrEqual(6);
  });
});

// ── GUARD-SEMANTIC-C: Cache isolation across calls ───────────────────────────

describe('GUARD-SEMANTIC-C — wordCache does not leak across document versions', () => {
  it('changing document version triggers a fresh computation, not stale cache', () => {
    const index = new SymbolIndex();
    addKt(index, 'file:///Lib.kt', 'package com.ex\nclass Foo');
    index.finalize();

    const provider = new KotlinSemanticTokensProvider(index, makeLegend());

    // Version 1: document with Foo
    const doc1 = { ...mockDocument('file:///T.kt', 'package com.test\nimport com.ex.Foo\nval x = Foo()'), version: 1 };
    const tokens1 = provider.provideDocumentSemanticTokens(doc1, NO_CANCEL);

    // Version 2: same URI but different version — provider must recompute
    const doc2 = { ...mockDocument('file:///T.kt', 'package com.test\nimport com.ex.Foo\nval x = Foo()\nval y = Foo()'), version: 2 };
    const tokens2 = provider.provideDocumentSemanticTokens(doc2, NO_CANCEL);

    // Version 2 has more tokens (extra Foo reference) — confirms recomputation happened
    expect(tokens2.data.length).toBeGreaterThan(tokens1.data.length);
    // Different resultId confirms a new computation
    expect(tokens2.resultId).not.toBe(tokens1.resultId);
  });

  it('wordCache from one computeAndCache call does not affect another call for a different document', () => {
    const index = new SymbolIndex();
    addKt(index, 'file:///A.kt', 'package com.ex\nclass Alpha');
    addKt(index, 'file:///B.kt', 'package com.ex\nclass Beta');
    index.finalize();

    const provider = new KotlinSemanticTokensProvider(index, makeLegend());

    const docA = mockDocument('file:///TA.kt', 'package com.test\nimport com.ex.Alpha\nval x = Alpha()');
    const docB = mockDocument('file:///TB.kt', 'package com.test\nimport com.ex.Beta\nval x = Beta()');

    const tokensA = provider.provideDocumentSemanticTokens(docA, NO_CANCEL);
    const tokensB = provider.provideDocumentSemanticTokens(docB, NO_CANCEL);

    // Both should resolve their own symbol (not bleed into each other)
    expect(tokensA.data.length).toBeGreaterThan(0);
    expect(tokensB.data.length).toBeGreaterThan(0);
    // Token data should differ (different symbols highlighted)
    expect(tokensA.data).not.toEqual(tokensB.data);
  });
});

// ── GUARD-SEMANTIC-D: Timing ──────────────────────────────────────────────────

describe('GUARD-SEMANTIC-D — timing guard on large synthetic document', () => {
  it('300-line file with 5 symbols × 20 occurrences completes in < 100ms', () => {
    // This test guards against O(occurrences) CPU cost regressing.
    // 5 symbols × 20 occurrences = 100 symbol instances in body + class/fun declarations.
    // With wordCache: ~5 resolveBest calls. Without: ~100.

    const SYMBOLS = ['Alpha', 'Beta', 'Gamma', 'Delta', 'Epsilon'];

    const index = new SymbolIndex();
    for (const s of SYMBOLS) {
      addKt(index, `file:///lib/${s}.kt`, `package com.ex\nclass ${s}`);
    }
    index.finalize();

    const doc = makeRepeatedSymbolDoc('file:///Big.kt', 'com.ex', SYMBOLS, 20);
    const provider = new KotlinSemanticTokensProvider(index, makeLegend());

    const start = performance.now();
    provider.provideDocumentSemanticTokens(doc, NO_CANCEL);
    const elapsed = performance.now() - start;

    expect(elapsed, `computeAndCache took ${elapsed.toFixed(1)}ms — wordCache may have been removed`).toBeLessThan(100);
  });

  it('500-line file with 10 symbols × 30 occurrences each completes in < 200ms', () => {
    // Adversarial: larger document to expose O(n²) if cache is removed.
    const SYMBOLS = [
      'ViewModelA', 'ViewModelB', 'RepositoryA', 'RepositoryB', 'UseCaseA',
      'UseCaseB', 'AdapterA', 'AdapterB', 'MapperA', 'MapperB',
    ];

    const index = new SymbolIndex();
    for (const s of SYMBOLS) {
      addKt(index, `file:///lib/${s}.kt`, `package com.ex\nclass ${s}`);
    }
    index.finalize();

    const doc = makeRepeatedSymbolDoc('file:///VeryBig.kt', 'com.ex', SYMBOLS, 30);
    const provider = new KotlinSemanticTokensProvider(index, makeLegend());

    const start = performance.now();
    provider.provideDocumentSemanticTokens(doc, NO_CANCEL);
    const elapsed = performance.now() - start;

    expect(elapsed, `computeAndCache took ${elapsed.toFixed(1)}ms — wordCache may have been removed`).toBeLessThan(200);
  });
});
