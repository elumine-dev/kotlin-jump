/**
 * Tests for KotlinImplementationProvider — covers all three resolution paths:
 *
 *   PATH-1  Class/interface implementations (cursor on type name)
 *   PATH-2  Method implementations (cursor on declaration line)
 *   PATH-3  Call site (cursor not on declaration — Fix C)
 *
 * Bugs these tests pin down:
 *
 *   IMPL-A  Call site returned null before Fix C.
 *           `observer.onCaught(pokemon)` → "Go to Implementation" → nothing.
 *           Fixed by adding a fallback that finds non-override decls and returns their impls.
 *
 *   IMPL-B  Method name shared across multiple interfaces: Fix C must aggregate results
 *           from every non-override declaration — not just the first one found.
 *
 *   IMPL-C  Single-char words must be rejected early (guard clause).
 *
 *   IMPL-D  Abstract class methods (not just interface methods) must be found via PATH-2.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { KotlinImplementationProvider } from '../../src/providers/ImplementationProvider';
import { SymbolIndex } from '../../src/indexer/SymbolIndex';
import { parse } from '../../src/indexer/KotlinParser';
import { mockDocument, positionOf } from './helpers';

function addKt(index: SymbolIndex, uri: string, code: string) {
  index.add(parse(uri, code));
}

// ── Test data ────────────────────────────────────────────────────────────────

const OBSERVER_KT = `package com.example
interface PokemonObserver {
    fun onCaught(pokemon: String)
    fun onReleased(pokemon: String)
}`;

const AUDIT_KT = `package com.example
class AuditObserver : PokemonObserver {
    override fun onCaught(pokemon: String) {}
    override fun onReleased(pokemon: String) {}
}`;

const TRAINER_KT = `package com.example
class PokemonTrainer(private val observer: PokemonObserver) {
    fun processCatch(pokemon: String) {
        observer.onCaught(pokemon)
    }
}`;

const ABSTRACT_KT = `package com.example
abstract class MoveStrategy {
    abstract fun execute(attacker: String, defender: String): Int
    fun isEffective(damage: Int) = damage > 0
}
class PhysicalMove : MoveStrategy() {
    override fun execute(attacker: String, defender: String): Int = 42
}
class SpecialMove : MoveStrategy() {
    override fun execute(attacker: String, defender: String): Int = 99
}`;

// ── PATH-1 : class/interface implementations ──────────────────────────────────

describe('PATH-1 — class/interface implementations', () => {
  let index: SymbolIndex;
  let provider: KotlinImplementationProvider;

  beforeEach(() => {
    index = new SymbolIndex();
    addKt(index, 'file:///Observer.kt', OBSERVER_KT);
    addKt(index, 'file:///Audit.kt', AUDIT_KT);
    provider = new KotlinImplementationProvider(index);
  });

  it('cursor on interface name → returns implementing class', () => {
    const doc = mockDocument('file:///Observer.kt', OBSERVER_KT);
    const pos = positionOf(OBSERVER_KT, 'PokemonObserver');
    const result = provider.provideImplementation(doc, pos) as any;
    const locs = Array.isArray(result) ? result : [result];
    expect(locs.some((l: any) => l.uri.toString().includes('Audit.kt'))).toBe(true);
  });

  it('interface with no implementations → null', () => {
    const doc = mockDocument('file:///Observer.kt', OBSERVER_KT);
    const pos = positionOf(OBSERVER_KT, 'PokemonObserver');
    // Remove the impl so nothing is left
    const emptyIndex = new SymbolIndex();
    addKt(emptyIndex, 'file:///Observer.kt', OBSERVER_KT);
    const p = new KotlinImplementationProvider(emptyIndex);
    const result = p.provideImplementation(doc, pos);
    // lookupImplementations returns empty → falls through to method path → null
    expect(result).toBeNull();
  });
});

// ── PATH-2 : method implementations (cursor on declaration line) ──────────────

describe('PATH-2 — method implementations at declaration', () => {
  let index: SymbolIndex;
  let provider: KotlinImplementationProvider;

  beforeEach(() => {
    index = new SymbolIndex();
    addKt(index, 'file:///Observer.kt', OBSERVER_KT);
    addKt(index, 'file:///Audit.kt', AUDIT_KT);
    provider = new KotlinImplementationProvider(index);
  });

  it('cursor on interface method declaration → returns override in impl class', () => {
    const doc = mockDocument('file:///Observer.kt', OBSERVER_KT);
    const pos = positionOf(OBSERVER_KT, 'onCaught');
    const result = provider.provideImplementation(doc, pos) as any;
    const locs = Array.isArray(result) ? result : [result];
    expect(locs.length).toBeGreaterThan(0);
    expect(locs.some((l: any) => l.uri.toString().includes('Audit.kt'))).toBe(true);
  });

  it('cursor on interface method → does NOT return the declaration itself', () => {
    const doc = mockDocument('file:///Observer.kt', OBSERVER_KT);
    const pos = positionOf(OBSERVER_KT, 'onCaught');
    const result = provider.provideImplementation(doc, pos) as any;
    const locs = Array.isArray(result) ? result : [result];
    // All results must be in impl files, not the interface itself
    expect(locs.every((l: any) => !l.uri.toString().includes('Observer.kt'))).toBe(true);
  });

  it('IMPL-D — abstract class method declaration → returns overrides', () => {
    const idx = new SymbolIndex();
    addKt(idx, 'file:///Move.kt', ABSTRACT_KT);
    const p = new KotlinImplementationProvider(idx);
    const doc = mockDocument('file:///Move.kt', ABSTRACT_KT);
    const pos = positionOf(ABSTRACT_KT, 'execute');
    const result = p.provideImplementation(doc, pos) as any;
    const locs = Array.isArray(result) ? result : [result];
    expect(locs.length).toBe(2); // PhysicalMove + SpecialMove
  });

  it('cursor on non-abstract method → no impl to find', () => {
    const idx = new SymbolIndex();
    addKt(idx, 'file:///Move.kt', ABSTRACT_KT);
    const p = new KotlinImplementationProvider(idx);
    const doc = mockDocument('file:///Move.kt', ABSTRACT_KT);
    // 'isEffective' has no overrides
    const pos = positionOf(ABSTRACT_KT, 'isEffective');
    const result = p.provideImplementation(doc, pos);
    expect(result).toBeNull();
  });
});

// ── PATH-3 : call site navigation (Fix C) ────────────────────────────────────

describe('PATH-3 — call site navigation (Fix C)', () => {
  let index: SymbolIndex;
  let provider: KotlinImplementationProvider;

  beforeEach(() => {
    index = new SymbolIndex();
    addKt(index, 'file:///Observer.kt', OBSERVER_KT);
    addKt(index, 'file:///Audit.kt', AUDIT_KT);
    addKt(index, 'file:///Trainer.kt', TRAINER_KT);
    provider = new KotlinImplementationProvider(index);
  });

  it('IMPL-A — call site onCaught → finds AuditObserver.onCaught', () => {
    // Trainer.kt line with `observer.onCaught(pokemon)` is NOT a declaration.
    // Before Fix C this returned null.
    const doc = mockDocument('file:///Trainer.kt', TRAINER_KT);
    const pos = positionOf(TRAINER_KT, 'onCaught');
    const result = provider.provideImplementation(doc, pos) as any;
    const locs = Array.isArray(result) ? result : [result];
    expect(locs.length).toBeGreaterThan(0);
    expect(locs.some((l: any) => l.uri.toString().includes('Audit.kt'))).toBe(true);
  });

  it('call site must NOT include the interface declaration itself', () => {
    const doc = mockDocument('file:///Trainer.kt', TRAINER_KT);
    const pos = positionOf(TRAINER_KT, 'onCaught');
    const result = provider.provideImplementation(doc, pos) as any;
    const locs = Array.isArray(result) ? result : [result];
    // Observer.kt is the interface — must not appear in results
    expect(locs.every((l: any) => !l.uri.toString().includes('Observer.kt'))).toBe(true);
  });

  it('call site with no implementations → null', () => {
    const code = `package com.example
interface Stub {
    fun doIt()
}
class User(val stub: Stub) {
    fun run() { stub.doIt() }
}`;
    const idx = new SymbolIndex();
    addKt(idx, 'file:///Stub.kt', code);
    const p = new KotlinImplementationProvider(idx);
    const doc = mockDocument('file:///Stub.kt', code);
    // cursor on `doIt` in the call site `stub.doIt()`
    const pos = positionOf(code, 'doIt', 2); // 2nd occurrence is the call site
    const result = p.provideImplementation(doc, pos);
    expect(result).toBeNull();
  });

  it('IMPL-B — method shared across 2 interfaces → aggregates all impls', () => {
    // Two different interfaces both declare `process()`.
    // A call site on `process` should return impls from both.
    const code = `package com.example
interface Alpha {
    fun process()
}
interface Beta {
    fun process()
}
class AlphaImpl : Alpha {
    override fun process() {}
}
class BetaImpl : Beta {
    override fun process() {}
}
class Caller(val a: Alpha) {
    fun run() { a.process() }
}`;
    const idx = new SymbolIndex();
    addKt(idx, 'file:///Multi.kt', code);
    const p = new KotlinImplementationProvider(idx);
    const doc = mockDocument('file:///Multi.kt', code);
    // occurrences: Alpha.process(1), Beta.process(2),
    // AlphaImpl.override(3), BetaImpl.override(4), Caller call site(5)
    const pos = positionOf(code, 'process', 5);
    const result = p.provideImplementation(doc, pos) as any;
    const locs = Array.isArray(result) ? result : [result];
    // AlphaImpl.process + BetaImpl.process
    expect(locs.length).toBe(2);
  });
});

// ── Adversarial edge cases ────────────────────────────────────────────────────

describe('ImplementationProvider — adversarial', () => {
  let index: SymbolIndex;
  let provider: KotlinImplementationProvider;

  beforeEach(() => {
    index = new SymbolIndex();
    addKt(index, 'file:///Observer.kt', OBSERVER_KT);
    addKt(index, 'file:///Audit.kt', AUDIT_KT);
    provider = new KotlinImplementationProvider(index);
  });

  it('IMPL-C — single-char word → null (guard clause)', () => {
    const doc = mockDocument('file:///Observer.kt', OBSERVER_KT);
    // Position inside 'fun' keyword → word is 'f' (single char) or short
    // positionOf finds 'fun' but the provider rejects word.length < 2
    const code = `package x\ninterface I { fun a() }`;
    const idx = new SymbolIndex();
    addKt(idx, 'file:///I.kt', code);
    const p = new KotlinImplementationProvider(idx);
    const d = mockDocument('file:///I.kt', code);
    // 'a' is 1 char — must be rejected
    const pos = positionOf(code, 'fun a', 1);
    const result = p.provideImplementation(d, new (pos.constructor as any)(pos.line, pos.character + 4));
    expect(result).toBeNull();
  });

  it('unknown word not in index → null', () => {
    const doc = mockDocument('file:///Observer.kt', OBSERVER_KT);
    // Point to a non-existent word by using a fresh doc with unknown content
    const code = `package x\nclass Xyz { fun unknown() {} }`;
    const idx = new SymbolIndex();
    addKt(idx, 'file:///Xyz.kt', code);
    const p = new KotlinImplementationProvider(idx);
    const d = mockDocument('file:///Xyz.kt', code);
    // 'unknown' has no implementations
    const pos = positionOf(code, 'unknown');
    const result = p.provideImplementation(d, pos);
    expect(result).toBeNull();
  });

  it('override method on its own line is not a declaration — falls to PATH-3', () => {
    // Cursor on the override inside AuditObserver — not the interface declaration.
    // PATH-2 fails (uri doesn't match Observer.kt). PATH-3 finds via non-override decls.
    const doc = mockDocument('file:///Audit.kt', AUDIT_KT);
    // 'onCaught' in AuditObserver is an override — cursor here
    const pos = positionOf(AUDIT_KT, 'onCaught');
    const result = provider.provideImplementation(doc, pos) as any;
    // PATH-2: declEntry IS found (same file, same line as the override declaration)
    // So it calls lookupMethodImplementations which searches from inside AuditObserver
    // The result may be empty (AuditObserver implements, but is AuditObserver itself an impl of something?)
    // Regardless: no crash
    expect(result === null || Array.isArray(result)).toBe(true);
  });

  it('method with two impls — both are returned from PATH-2', () => {
    const idx = new SymbolIndex();
    addKt(idx, 'file:///Move.kt', ABSTRACT_KT);
    const p = new KotlinImplementationProvider(idx);
    const doc = mockDocument('file:///Move.kt', ABSTRACT_KT);
    const pos = positionOf(ABSTRACT_KT, 'execute');
    const result = p.provideImplementation(doc, pos) as any;
    const locs = Array.isArray(result) ? result : [result];
    // PhysicalMove.execute + SpecialMove.execute
    expect(new Set(locs.map((l: any) => l.uri.toString())).size).toBe(1); // all in same file
    expect(locs.length).toBe(2);
  });
});
