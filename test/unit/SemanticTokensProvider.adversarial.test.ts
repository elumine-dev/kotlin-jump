/**
 * Adversarial & stress tests for KotlinSemanticTokensProvider.
 *
 * Attack surface:
 *  1. computeAndCache Phase 1 — declaration site detection from index
 *  2. computeAndCache Phase 2 — regex word scan + wordCache + resolveBest
 *  3. Document-level cache — version check, invalidation, resultId uniqueness
 *  4. provideDocumentSemanticTokensEdits — delta diff correctness
 *  5. KOTLIN_KEYWORDS set — words that must be skipped
 *  6. PascalCase fallback — only PascalCase triggers global index.lookup()
 *  7. Cancellation token — scan must stop when requested
 *
 * Tests are named ADVER-SEM-* so they're easy to grep.
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

const NO_CANCEL   = { isCancellationRequested: false } as any;
const DO_CANCEL   = { isCancellationRequested: true  } as any;

function makeLegend() {
  return new SemanticTokensLegend(TOKEN_TYPES, TOKEN_MODIFIERS) as any;
}

function makeIndex(...files: Array<[uri: string, code: string]>): SymbolIndex {
  const idx = new SymbolIndex();
  for (const [uri, code] of files) idx.add(parse(uri, code));
  idx.finalize();
  return idx;
}

function tokenCount(tokens: any) {
  return tokens.data.length / 5;
}

// ── ADVER-SEM-1: wordCache — deduplication under extreme repetition ───────────

describe('ADVER-SEM-1 — wordCache: extreme repetition', () => {
  it('1000 occurrences of same class → lookupFqn called exactly once for that FQN', () => {
    const index = makeIndex(['file:///Lib.kt', 'package com.ex\nclass Mega']);
    const lines = Array.from({ length: 1000 }, (_, i) => `  val v${i} = Mega()`);
    const code = `package com.test\nimport com.ex.Mega\nclass Host {\n${lines.join('\n')}\n}`;
    const doc = mockDocument('file:///T.kt', code);
    const provider = new KotlinSemanticTokensProvider(index, makeLegend());

    const spy = vi.spyOn(index, 'lookupFqn');
    provider.provideDocumentSemanticTokens(doc, NO_CANCEL);

    const megaCalls = spy.mock.calls.filter(([fqn]) => fqn === 'com.ex.Mega').length;
    expect(megaCalls).toBe(1);
  });

  it('1000 occurrences all produce a token (correctness, not just dedup)', () => {
    const index = makeIndex(['file:///Lib.kt', 'package com.ex\nclass Widget']);
    const lines = Array.from({ length: 1000 }, (_, i) => `  val v${i} = Widget()`);
    const code = `package com.test\nimport com.ex.Widget\nclass Host {\n${lines.join('\n')}\n}`;
    const doc = mockDocument('file:///T.kt', code);
    const provider = new KotlinSemanticTokensProvider(index, makeLegend());
    const tokens = provider.provideDocumentSemanticTokens(doc, NO_CANCEL);

    // At least 1000 tokens for the 1000 Widget references (plus declaration tokens)
    expect(tokenCount(tokens)).toBeGreaterThanOrEqual(1000);
  });
});

// ── ADVER-SEM-2: Empty and degenerate documents ───────────────────────────────

describe('ADVER-SEM-2 — degenerate documents', () => {
  it('empty document produces 0 tokens', () => {
    const index = new SymbolIndex();
    index.finalize();
    const doc = mockDocument('file:///Empty.kt', '');
    const provider = new KotlinSemanticTokensProvider(index, makeLegend());
    const tokens = provider.provideDocumentSemanticTokens(doc, NO_CANCEL);
    expect(tokenCount(tokens)).toBe(0);
  });

  it('document with only blank lines produces 0 tokens', () => {
    const index = new SymbolIndex();
    index.finalize();
    const doc = mockDocument('file:///T.kt', '\n\n\n\n');
    const provider = new KotlinSemanticTokensProvider(index, makeLegend());
    const tokens = provider.provideDocumentSemanticTokens(doc, NO_CANCEL);
    expect(tokenCount(tokens)).toBe(0);
  });

  it('document with only // comments produces 0 reference tokens', () => {
    const index = makeIndex(['file:///Lib.kt', 'package com.ex\nclass Foo']);
    // All lines are comments — Phase 2 fast-path skips them
    const code = [
      '// package com.test',
      '// import com.ex.Foo',
      '// val x = Foo()',
    ].join('\n');
    const doc = mockDocument('file:///T.kt', code);
    const provider = new KotlinSemanticTokensProvider(index, makeLegend());

    const spy = vi.spyOn(index, 'lookupFqn');
    provider.provideDocumentSemanticTokens(doc, NO_CANCEL);
    expect(spy).not.toHaveBeenCalled();
  });

  it('document with only package + import lines: no reference tokens', () => {
    const index = makeIndex(['file:///Lib.kt', 'package com.ex\nclass Foo']);
    const code = 'package com.test\nimport com.ex.Foo';
    const doc = mockDocument('file:///T.kt', code);
    const provider = new KotlinSemanticTokensProvider(index, makeLegend());

    const spy = vi.spyOn(index, 'lookupFqn');
    provider.provideDocumentSemanticTokens(doc, NO_CANCEL);
    expect(spy).not.toHaveBeenCalled();
  });

  it('document where every word is a Kotlin keyword: 0 lookupFqn calls', () => {
    const index = new SymbolIndex();
    index.finalize();
    // Only keywords — all skipped in Phase 2
    const code = 'fun val var class if else when return override open sealed data';
    const doc = mockDocument('file:///T.kt', code);
    const provider = new KotlinSemanticTokensProvider(index, makeLegend());

    const spy = vi.spyOn(index, 'lookupFqn');
    provider.provideDocumentSemanticTokens(doc, NO_CANCEL);
    expect(spy).not.toHaveBeenCalled();
  });
});

// ── ADVER-SEM-3: Cancellation token ──────────────────────────────────────────

describe('ADVER-SEM-3 — cancellation token stops scan early', () => {
  it('cancelled token: scan exits, returns tokens built so far (no crash)', () => {
    const index = makeIndex(['file:///Lib.kt', 'package com.ex\nclass Foo']);
    const lines = Array.from({ length: 100 }, (_, i) => `val v${i} = Foo()`);
    const code = `package com.test\nimport com.ex.Foo\n${lines.join('\n')}`;
    const doc = mockDocument('file:///T.kt', code);
    const provider = new KotlinSemanticTokensProvider(index, makeLegend());

    // Should not throw even with cancellation requested
    expect(() => provider.provideDocumentSemanticTokens(doc, DO_CANCEL)).not.toThrow();
  });

  it('cancelled token: returns fewer tokens than non-cancelled (scan stopped early)', () => {
    const index = makeIndex(['file:///Lib.kt', 'package com.ex\nclass Foo']);
    const lines = Array.from({ length: 200 }, (_, i) => `val v${i} = Foo()`);
    const code = `package com.test\nimport com.ex.Foo\n${lines.join('\n')}`;
    const doc = mockDocument('file:///T.kt', code);
    const doc2 = mockDocument('file:///T2.kt', code);

    const p1 = new KotlinSemanticTokensProvider(index, makeLegend());
    const p2 = new KotlinSemanticTokensProvider(index, makeLegend());

    const full      = p1.provideDocumentSemanticTokens(doc,  NO_CANCEL);
    const cancelled = p2.provideDocumentSemanticTokens(doc2, DO_CANCEL);

    // Cancelled scan produces fewer tokens (Phase 2 is skipped entirely)
    expect(tokenCount(cancelled)).toBeLessThan(tokenCount(full));
  });
});

// ── ADVER-SEM-4: Document-level cache ────────────────────────────────────────

describe('ADVER-SEM-4 — document cache: version invalidation', () => {
  it('same version → second call returns cache (resultId identical)', () => {
    const index = makeIndex(['file:///Lib.kt', 'package com.ex\nclass A']);
    const doc = mockDocument('file:///T.kt', 'package com.test\nimport com.ex.A\nval x = A()');
    const provider = new KotlinSemanticTokensProvider(index, makeLegend());

    const t1 = provider.provideDocumentSemanticTokens(doc, NO_CANCEL);
    const t2 = provider.provideDocumentSemanticTokens(doc, NO_CANCEL);

    expect(t1.resultId).toBe(t2.resultId);
    expect(t1.data).toEqual(t2.data);
  });

  it('different version → new resultId (fresh computation)', () => {
    // Note: WORD_RE requires ≥2 chars (\w{1,}), so single-letter names like "A" are not scanned.
    // Use a real multi-char class name.
    const index = makeIndex(['file:///Lib.kt', 'package com.ex\nclass Foo']);
    const provider = new KotlinSemanticTokensProvider(index, makeLegend());

    const doc1 = { ...mockDocument('file:///T.kt', 'package com.test\nimport com.ex.Foo\nval x = Foo()'), version: 1 };
    const doc2 = { ...mockDocument('file:///T.kt', 'package com.test\nimport com.ex.Foo\nval x = Foo()\nval y = Foo()'), version: 2 };

    const t1 = provider.provideDocumentSemanticTokens(doc1, NO_CANCEL);
    const t2 = provider.provideDocumentSemanticTokens(doc2, NO_CANCEL);

    expect(t1.resultId).not.toBe(t2.resultId);
    expect(t2.data.length).toBeGreaterThan(t1.data.length);
  });

  it('invalidate() clears cache — next call recomputes', () => {
    const index = makeIndex(['file:///Lib.kt', 'package com.ex\nclass A']);
    const doc = mockDocument('file:///T.kt', 'package com.test\nimport com.ex.A\nval x = A()');
    const provider = new KotlinSemanticTokensProvider(index, makeLegend());

    const t1 = provider.provideDocumentSemanticTokens(doc, NO_CANCEL);
    provider.invalidate();
    const t2 = provider.provideDocumentSemanticTokens(doc, NO_CANCEL);

    // Both are valid tokens but result IDs differ (recomputed)
    expect(t1.data).toEqual(t2.data); // same document → same tokens
    expect(t1.resultId).not.toBe(t2.resultId); // but different computation IDs
  });

  it('two different URIs cached independently — no cross-contamination', () => {
    const index = makeIndex(
      ['file:///A.kt', 'package com.ex\nclass Alpha'],
      ['file:///B.kt', 'package com.ex\nclass Beta'],
    );
    const provider = new KotlinSemanticTokensProvider(index, makeLegend());

    const docA = mockDocument('file:///TA.kt', 'package com.test\nimport com.ex.Alpha\nval x = Alpha()');
    const docB = mockDocument('file:///TB.kt', 'package com.test\nimport com.ex.Beta\nval x = Beta()');

    const tA = provider.provideDocumentSemanticTokens(docA, NO_CANCEL);
    const tB = provider.provideDocumentSemanticTokens(docB, NO_CANCEL);

    expect(tA.data).not.toEqual(tB.data);

    // Second call still cached correctly for each
    const tA2 = provider.provideDocumentSemanticTokens(docA, NO_CANCEL);
    const tB2 = provider.provideDocumentSemanticTokens(docB, NO_CANCEL);
    expect(tA.resultId).toBe(tA2.resultId);
    expect(tB.resultId).toBe(tB2.resultId);
  });
});

// ── ADVER-SEM-5: Delta edits (provideDocumentSemanticTokensEdits) ─────────────

describe('ADVER-SEM-5 — semantic token delta correctness', () => {
  it('same version → empty edits list, same resultId', () => {
    const index = makeIndex(['file:///Lib.kt', 'package com.ex\nclass Foo']);
    const doc = mockDocument('file:///T.kt', 'package com.test\nimport com.ex.Foo\nval x = Foo()');
    const provider = new KotlinSemanticTokensProvider(index, makeLegend());

    const full = provider.provideDocumentSemanticTokens(doc, NO_CANCEL);
    const delta = provider.provideDocumentSemanticTokensEdits(doc, full.resultId!, NO_CANCEL) as any;

    expect(delta.edits).toHaveLength(0);
    expect(delta.resultId).toBe(full.resultId);
  });

  it('new version → delta contains at least one edit', () => {
    const index = makeIndex(['file:///Lib.kt', 'package com.ex\nclass Foo']);
    const provider = new KotlinSemanticTokensProvider(index, makeLegend());

    const doc1 = { ...mockDocument('file:///T.kt', 'package com.test\nimport com.ex.Foo\nval x = Foo()'), version: 1 };
    const doc2 = { ...mockDocument('file:///T.kt', 'package com.test\nimport com.ex.Foo\nval x = Foo()\nval y = Foo()'), version: 2 };

    const full = provider.provideDocumentSemanticTokens(doc1, NO_CANCEL);
    const delta = provider.provideDocumentSemanticTokensEdits(doc2, full.resultId!, NO_CANCEL) as any;

    // New document version → edits should be non-empty
    expect(delta.edits.length).toBeGreaterThan(0);
  });
});

// ── ADVER-SEM-6: PascalCase fallback vs. camelCase ───────────────────────────

describe('ADVER-SEM-6 — PascalCase global fallback, camelCase skipped', () => {
  it('PascalCase unknown symbol calls index.lookup() as fallback', () => {
    // Symbol not imported but present globally (PascalCase) → tries global lookup
    const index = makeIndex(['file:///Lib.kt', 'package com.ex\nclass GlobalClass']);
    const doc = mockDocument('file:///T.kt', 'package com.test\nval x = GlobalClass()');
    const provider = new KotlinSemanticTokensProvider(index, makeLegend());

    const spy = vi.spyOn(index, 'lookup');
    provider.provideDocumentSemanticTokens(doc, NO_CANCEL);

    // lookup() must have been called with 'GlobalClass'
    const globalCalls = spy.mock.calls.filter(([name]) => name === 'GlobalClass');
    expect(globalCalls.length).toBeGreaterThan(0);
  });

  it('camelCase unknown symbol does NOT call index.lookup()', () => {
    const index = new SymbolIndex();
    index.finalize();
    const doc = mockDocument('file:///T.kt', 'package com.test\nval x = someLocalVar');
    const provider = new KotlinSemanticTokensProvider(index, makeLegend());

    const spy = vi.spyOn(index, 'lookup');
    provider.provideDocumentSemanticTokens(doc, NO_CANCEL);

    const camelCalls = spy.mock.calls.filter(([name]) => name === 'someLocalVar');
    expect(camelCalls).toHaveLength(0);
  });
});

// ── ADVER-SEM-7: Declaration/reference interaction ───────────────────────────

describe('ADVER-SEM-7 — declaration sites not double-counted', () => {
  it('declared symbol in Phase 1 is not also processed in Phase 2 (no duplicate token)', () => {
    const index = makeIndex(['file:///T.kt', 'package com.test\nclass MyClass']);
    const doc = mockDocument('file:///T.kt', 'package com.test\nclass MyClass');
    const provider = new KotlinSemanticTokensProvider(index, makeLegend());
    const tokens = provider.provideDocumentSemanticTokens(doc, NO_CANCEL);

    // `MyClass` appears once as a declaration — should produce exactly 1 token
    // (not 2: one for decl + one for reference scanning)
    const myClassTokenCount = tokenCount(tokens);
    expect(myClassTokenCount).toBe(1);
  });

  it('symbol declared in file AND referenced on other lines: declaration + all references tokenized', () => {
    // Declare Foo in the index for T.kt, then reference it on 3 lines
    const index = new SymbolIndex();
    index.add(parse('file:///Lib.kt', 'package com.ex\nclass Foo'));
    index.add(parse('file:///T.kt', 'package com.test\nclass Foo')); // also declared locally
    index.finalize();

    const code = [
      'package com.test',
      'import com.ex.Foo',
      'class Foo',     // declaration (Phase 1 token)
      'val a = Foo()', // reference (Phase 2 token)
      'val b = Foo()', // reference (Phase 2 token)
    ].join('\n');
    const doc = mockDocument('file:///T.kt', code);
    const provider = new KotlinSemanticTokensProvider(index, makeLegend());
    const tokens = provider.provideDocumentSemanticTokens(doc, NO_CANCEL);

    // At least 3 Foo tokens: 1 declaration + 2 references
    expect(tokenCount(tokens)).toBeGreaterThanOrEqual(3);
  });
});

// ── ADVER-SEM-8: Stress / timing ─────────────────────────────────────────────

describe('ADVER-SEM-8 — stress: large documents with many symbols', () => {
  it('10 symbols × 100 occurrences each (1000-line body) completes in < 200ms', () => {
    const SYMS = ['Alpha', 'Beta', 'Gamma', 'Delta', 'Epsilon',
                  'Zeta', 'Eta', 'Theta', 'Iota', 'Kappa'];
    const index = new SymbolIndex();
    for (const s of SYMS) index.add(parse(`file:///lib/${s}.kt`, `package com.ex\nclass ${s}`));
    index.finalize();

    const imports = SYMS.map(s => `import com.ex.${s}`).join('\n');
    const body = Array.from({ length: 100 }, (_, i) =>
      SYMS.map(s => `  val v${s}${i} = ${s}()`).join('\n'),
    ).join('\n');
    const code = `package com.test\n${imports}\nclass Host {\n${body}\n}`;
    const doc = mockDocument('file:///Big.kt', code);
    const provider = new KotlinSemanticTokensProvider(index, makeLegend());

    const start = performance.now();
    const tokens = provider.provideDocumentSemanticTokens(doc, NO_CANCEL);
    const elapsed = performance.now() - start;

    expect(elapsed).toBeLessThan(200);
    // At least 1000 reference tokens (100 occurrences × 10 symbols)
    expect(tokenCount(tokens)).toBeGreaterThanOrEqual(1000);
  });

  it('10 symbols × 100 occurrences: each FQN looked up exactly once (wordCache)', () => {
    const SYMS = ['Alpha', 'Beta', 'Gamma', 'Delta', 'Epsilon',
                  'Zeta', 'Eta', 'Theta', 'Iota', 'Kappa'];
    const FQNS = SYMS.map(s => `com.ex.${s}`);
    const index = new SymbolIndex();
    for (const s of SYMS) index.add(parse(`file:///lib/${s}.kt`, `package com.ex\nclass ${s}`));
    index.finalize();

    const imports = SYMS.map(s => `import com.ex.${s}`).join('\n');
    const body = Array.from({ length: 100 }, (_, i) =>
      SYMS.map(s => `  val v${s}${i} = ${s}()`).join('\n'),
    ).join('\n');
    const code = `package com.test\n${imports}\nclass Host {\n${body}\n}`;
    const doc = mockDocument('file:///Big.kt', code);
    const provider = new KotlinSemanticTokensProvider(index, makeLegend());

    const spy = vi.spyOn(index, 'lookupFqn');
    provider.provideDocumentSemanticTokens(doc, NO_CANCEL);

    for (const fqn of FQNS) {
      const calls = spy.mock.calls.filter(([f]) => f === fqn).length;
      expect(calls, `${fqn} should be looked up exactly once`).toBe(1);
    }
  });

  it('second call on same document version returns from cache (0 lookupFqn calls)', () => {
    const index = makeIndex(['file:///Lib.kt', 'package com.ex\nclass Big']);
    const lines = Array.from({ length: 300 }, (_, i) => `val v${i} = Big()`);
    const code = `package com.test\nimport com.ex.Big\nclass Host {\n${lines.join('\n')}\n}`;
    const doc = mockDocument('file:///T.kt', code);
    const provider = new KotlinSemanticTokensProvider(index, makeLegend());

    // Warm up cache
    provider.provideDocumentSemanticTokens(doc, NO_CANCEL);

    // Second call — should hit cache, no lookupFqn
    const spy = vi.spyOn(index, 'lookupFqn');
    provider.provideDocumentSemanticTokens(doc, NO_CANCEL);
    expect(spy).not.toHaveBeenCalled();
  });
});
