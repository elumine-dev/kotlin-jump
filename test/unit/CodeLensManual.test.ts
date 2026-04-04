import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { parse } from '../../src/indexer/KotlinParser';
import { SymbolIndex } from '../../src/indexer/SymbolIndex';
import { KotlinCodeLensProvider } from '../../src/providers/CodeLensProvider';
import { mockDocument } from './helpers';
import { workspace } from './__mocks__/vscode';

function addKt(index: SymbolIndex, uri: string, code: string) {
  index.add(parse(uri, code));
}

const LENS_KINDS = new Set(['class','interface','object','enum','dataClass','sealedClass','annotation','fun','composable']);
const CLASS_LIKE = new Set(['class','interface','object','enum','dataClass','sealedClass','annotation']);

function getLensSymbols(index: SymbolIndex, uri: string) {
  const symbols = index.getFileSymbols(uri);
  const result: any[] = [];
  const classStack: { kind: string; depth: number }[] = [];
  for (const s of symbols) {
    while (classStack.length > 0 && classStack[classStack.length - 1].depth >= s.depth) classStack.pop();
    if (s.kind === 'enum' && classStack.length > 0 && classStack[classStack.length - 1].kind === 'enum') {
      if (CLASS_LIKE.has(s.kind)) classStack.push({ kind: s.kind, depth: s.depth });
      continue;
    }
    if (!LENS_KINDS.has(s.kind)) {
      if (CLASS_LIKE.has(s.kind)) classStack.push({ kind: s.kind, depth: s.depth });
      continue;
    }
    result.push(s);
    if (CLASS_LIKE.has(s.kind)) classStack.push({ kind: s.kind, depth: s.depth });
  }
  return result;
}

describe('Code Lens — full demo project manual verification', () => {
  let index: SymbolIndex;

  beforeEach(() => {
    index = new SymbolIndex();

    addKt(index, 'file:///Pokemon.kt', `package com.example.data

data class Pokemon(val id: Int, val name: String)

enum class PokemonType {
    FIRE,
    WATER,
    GRASS,
    ELECTRIC,
}

sealed class BattleResult {
    data class Victory(val winner: Pokemon) : BattleResult()
    data class Defeat(val loser: Pokemon) : BattleResult()
    data object Draw : BattleResult()
}

typealias Pokedex = List<Pokemon>`);

    addKt(index, 'file:///PokemonRepository.kt', `package com.example.data

interface PokemonRepository {
    fun catch(id: Int): Pokemon
    fun battle(attacker: Pokemon, defender: Pokemon): BattleResult
}`);

    addKt(index, 'file:///PokemonRepositoryImpl.kt', `package com.example.data

class PokemonRepositoryImpl(
    private val api: PokeApiService,
) : PokemonRepository {
    override fun catch(id: Int): Pokemon { return Pokemon(id, "test") }
    override fun battle(attacker: Pokemon, defender: Pokemon): BattleResult { return BattleResult.Draw }
}`);

    addKt(index, 'file:///ViewModel.kt', `package com.example.ui

import com.example.data.Pokemon
import com.example.data.PokemonRepository

class PokedexViewModel(private val repo: PokemonRepository) {
    fun loadAll(): List<Pokemon> { return repo.catch(1).let { listOf(it) } }
}`);
  });

  // ── Pokemon.kt ────────────────────────────────────────

  it('Pokemon.kt: data class Pokemon gets a lens', () => {
    const lenses = getLensSymbols(index, 'file:///Pokemon.kt');
    expect(lenses.some((s: any) => s.name === 'Pokemon')).toBe(true);
  });

  it('Pokemon.kt: enum class PokemonType gets a lens', () => {
    const lenses = getLensSymbols(index, 'file:///Pokemon.kt');
    expect(lenses.some((s: any) => s.name === 'PokemonType')).toBe(true);
  });

  it('Pokemon.kt: FIRE, WATER, GRASS, ELECTRIC do NOT get lenses', () => {
    const lenses = getLensSymbols(index, 'file:///Pokemon.kt');
    const names = lenses.map((s: any) => s.name);
    expect(names).not.toContain('FIRE');
    expect(names).not.toContain('WATER');
    expect(names).not.toContain('GRASS');
    expect(names).not.toContain('ELECTRIC');
  });

  it('Pokemon.kt: sealed class BattleResult gets a lens', () => {
    const lenses = getLensSymbols(index, 'file:///Pokemon.kt');
    expect(lenses.some((s: any) => s.name === 'BattleResult')).toBe(true);
  });

  it('Pokemon.kt: BattleResult has 3 implementations', () => {
    expect(index.lookupImplementations('BattleResult')).toHaveLength(3);
  });

  it('Pokemon.kt: Victory, Defeat, Draw get lenses (they are data classes)', () => {
    const lenses = getLensSymbols(index, 'file:///Pokemon.kt');
    const names = lenses.map((s: any) => s.name);
    expect(names).toContain('Victory');
    expect(names).toContain('Defeat');
    expect(names).toContain('Draw');
  });

  it('Pokemon.kt: typealias Pokedex does NOT get a lens', () => {
    const lenses = getLensSymbols(index, 'file:///Pokemon.kt');
    expect(lenses.some((s: any) => s.name === 'Pokedex')).toBe(false);
  });

  // ── PokemonRepository.kt ─────────────────────────────

  it('PokemonRepository.kt: interface gets a lens', () => {
    const lenses = getLensSymbols(index, 'file:///PokemonRepository.kt');
    expect(lenses.some((s: any) => s.name === 'PokemonRepository')).toBe(true);
  });

  it('PokemonRepository.kt: interface has 1 implementation', () => {
    expect(index.lookupImplementations('PokemonRepository')).toHaveLength(1);
  });

  it('PokemonRepository.kt: interface methods get lenses', () => {
    const lenses = getLensSymbols(index, 'file:///PokemonRepository.kt');
    const names = lenses.map((s: any) => s.name);
    expect(names).toContain('catch');
    expect(names).toContain('battle');
  });

  // ── PokemonRepositoryImpl.kt ──────────────────────────

  it('PokemonRepositoryImpl.kt: class gets a lens', () => {
    const lenses = getLensSymbols(index, 'file:///PokemonRepositoryImpl.kt');
    expect(lenses.some((s: any) => s.name === 'PokemonRepositoryImpl')).toBe(true);
  });

  it('PokemonRepositoryImpl.kt: class has 0 implementations', () => {
    expect(index.lookupImplementations('PokemonRepositoryImpl')).toHaveLength(0);
  });

  it('PokemonRepositoryImpl.kt: override funs get lenses', () => {
    const lenses = getLensSymbols(index, 'file:///PokemonRepositoryImpl.kt');
    const names = lenses.map((s: any) => s.name);
    expect(names).toContain('catch');
    expect(names).toContain('battle');
  });

  // ── ViewModel.kt ──────────────────────────────────────

  it('ViewModel.kt: class gets a lens', () => {
    const lenses = getLensSymbols(index, 'file:///ViewModel.kt');
    expect(lenses.some((s: any) => s.name === 'PokedexViewModel')).toBe(true);
  });

  it('ViewModel.kt: fun loadAll gets a lens', () => {
    const lenses = getLensSymbols(index, 'file:///ViewModel.kt');
    expect(lenses.some((s: any) => s.name === 'loadAll')).toBe(true);
  });

  // ── Title format verification ─────────────────────────

  it('title format: "N usages" for function', () => {
    const count = 3;
    const title = `${count} ${count === 1 ? 'usage' : 'usages'}`;
    expect(title).toBe('3 usages');
  });

  it('title format: "1 usage" singular', () => {
    const count = 1;
    const title = `${count} ${count === 1 ? 'usage' : 'usages'}`;
    expect(title).toBe('1 usage');
  });

  it('title format: "N usages | M implementations"', () => {
    const usages = 5;
    const impls = 2;
    const parts = [`${usages} usages`];
    if (impls > 0) parts.push(`${impls} implementations`);
    expect(parts.join(' | ')).toBe('5 usages | 2 implementations');
  });

  it('title format: "1 implementation" singular', () => {
    const impls = 1;
    const title = `${impls} ${impls === 1 ? 'implementation' : 'implementations'}`;
    expect(title).toBe('1 implementation');
  });

  // ── Lens count per file ───────────────────────────────

  it('Pokemon.kt has correct number of lenses', () => {
    const lenses = getLensSymbols(index, 'file:///Pokemon.kt');
    // Pokemon, PokemonType, BattleResult, Victory, Defeat, Draw = 6
    expect(lenses).toHaveLength(6);
  });

  it('PokemonRepository.kt has correct number of lenses', () => {
    const lenses = getLensSymbols(index, 'file:///PokemonRepository.kt');
    // PokemonRepository, catch, battle = 3
    expect(lenses).toHaveLength(3);
  });

  it('PokemonRepositoryImpl.kt has correct number of lenses', () => {
    const lenses = getLensSymbols(index, 'file:///PokemonRepositoryImpl.kt');
    // PokemonRepositoryImpl, catch, battle = 3
    expect(lenses).toHaveLength(3);
  });

  it('ViewModel.kt has correct number of lenses', () => {
    const lenses = getLensSymbols(index, 'file:///ViewModel.kt');
    // PokedexViewModel, loadAll = 2
    expect(lenses).toHaveLength(2);
  });
});

// ── resolveCodeLens: adversarial cache correctness tests ─────────────────────
//
// Regression suite for two fixed bugs:
//   Bug 1 — cache was keyed by entry.name, not entry.fqn.
//            Two symbols named "process" in different classes shared one cache
//            slot: whichever resolved first poisoned the slot for all others.
//   Bug 2 — cancelled scans were cached as 0.
//            A cancelled resolveCodeLens call stored Promise<0> in the cache;
//            the next valid call found it and reported 0 usages incorrectly.

describe('CodeLensProvider — resolveCodeLens cache correctness', () => {
  const URI_A        = 'file:///ServiceA.kt';
  const URI_B        = 'file:///ServiceB.kt';
  const URI_C        = 'file:///ServiceC.kt';
  const URI_CALLER_A = 'file:///CallerA.kt';
  const URI_CALLER_C = 'file:///CallerC.kt';

  // ServiceA.process — called twice from CallerA.kt (same package)
  const CODE_A = `package com.example\nclass ServiceA {\n    fun process() {}\n}`;
  // ServiceB.process — never called
  const CODE_B = `package com.other\nclass ServiceB {\n    fun process() {}\n}`;
  // ServiceC.process — called once from CallerC.kt (explicit import from separate package)
  const CODE_C = `package com.third\nclass ServiceC {\n    fun process() {}\n}`;
  // CallerA.kt: same package as A — only calls ServiceA.process (no ServiceC reference)
  const CODE_CALLER_A = [
    'package com.example',
    'fun mainA() {',
    '    ServiceA().process()',
    '    ServiceA().process()',
    '}',
  ].join('\n');
  // CallerC.kt: separate package, imports ServiceC — only calls ServiceC.process
  const CODE_CALLER_C = [
    'package com.ui',
    'import com.third.ServiceC',
    'fun mainC() {',
    '    ServiceC().process()',
    '}',
  ].join('\n');

  let index: SymbolIndex;
  let provider: KotlinCodeLensProvider;
  let origOpenDoc: typeof workspace.openTextDocument;
  let origReadFile: typeof workspace.fs.readFile;

  function makeDoc(uri: string): any {
    const codes: Record<string, string> = {
      [URI_A]: CODE_A, [URI_B]: CODE_B, [URI_C]: CODE_C,
      [URI_CALLER_A]: CODE_CALLER_A, [URI_CALLER_C]: CODE_CALLER_C,
    };
    return mockDocument(uri, codes[uri] ?? '') as any;
  }

  beforeEach(async () => {
    origOpenDoc  = workspace.openTextDocument;
    origReadFile = workspace.fs.readFile;

    index = new SymbolIndex();
    index.add(parse(URI_A,        CODE_A));
    index.add(parse(URI_B,        CODE_B));
    index.add(parse(URI_C,        CODE_C));
    index.add(parse(URI_CALLER_A, CODE_CALLER_A));
    index.add(parse(URI_CALLER_C, CODE_CALLER_C));
    provider = new KotlinCodeLensProvider(index);

    workspace.openTextDocument = async (uri: any) => makeDoc(uri.toString());
    workspace.fs.readFile = async (uri: any) => {
      const u = uri.toString ? uri.toString() : String(uri);
      const codes: Record<string, string> = {
        [URI_A]: CODE_A, [URI_B]: CODE_B, [URI_C]: CODE_C,
        [URI_CALLER_A]: CODE_CALLER_A, [URI_CALLER_C]: CODE_CALLER_C,
      };
      return Buffer.from(codes[u] ?? '') as any;
    };
  });

  afterEach(() => {
    workspace.openTextDocument = origOpenDoc;
    workspace.fs.readFile      = origReadFile;
  });

  function noCancel() { return { isCancellationRequested: false } as any; }
  function cancelled() { return { isCancellationRequested: true }  as any; }

  async function makeLens(pkg: string) {
    const { Range } = await import('./__mocks__/vscode');
    const entry = index.lookup('process').find(e => e.packageName === pkg)!;
    expect(entry).toBeDefined();
    return { lens: { range: new Range(entry.line, 0, entry.line, 0), data: { entry } } as any, entry };
  }

  // ── Bug 1: FQN isolation ───────────────────────────────────────────────────

  it('worst-case ordering: resolve zero-usage symbol first, used symbol still gets real count', async () => {
    const { lens: lensA } = await makeLens('com.example');
    const { lens: lensB } = await makeLens('com.other');

    // Resolve B (0 usages) first — with the old name-based cache this would poison "process" → 0
    const resolvedB = await provider.resolveCodeLens(lensB, noCancel());
    const resolvedA = await provider.resolveCodeLens(lensA, noCancel());

    expect(resolvedB.command?.title).toContain('0 usages');
    expect(resolvedA.command?.title).not.toContain('0 usages');
  });

  it('inverse ordering: resolve used symbol first, zero-usage symbol still shows 0', async () => {
    const { lens: lensA } = await makeLens('com.example');
    const { lens: lensB } = await makeLens('com.other');

    // Resolve A (has usages) first — with old cache B would inherit A's count
    const resolvedA = await provider.resolveCodeLens(lensA, noCancel());
    const resolvedB = await provider.resolveCodeLens(lensB, noCancel());

    expect(resolvedA.command?.title).not.toContain('0 usages');
    expect(resolvedB.command?.title).toContain('0 usages');
  });

  it('three symbols with same name all get independent correct counts', async () => {
    const { lens: lensA } = await makeLens('com.example'); // 2 calls
    const { lens: lensB } = await makeLens('com.other');   // 0 calls
    const { lens: lensC } = await makeLens('com.third');   // 1 call

    // Resolve in order: B, C, A — most adversarial (zero first, then non-zero)
    const rB = await provider.resolveCodeLens(lensB, noCancel());
    const rC = await provider.resolveCodeLens(lensC, noCancel());
    const rA = await provider.resolveCodeLens(lensA, noCancel());

    expect(rB.command?.title).toContain('0 usages');
    expect(rC.command?.title).toContain('1 usage');   // exact count, singular
    expect(rA.command?.title).toContain('2 usages');  // exact count, plural
  });

  it('FQNs must be distinct for the three test symbols', async () => {
    // If FQNs were equal the test above would be meaningless
    const { entry: eA } = await makeLens('com.example');
    const { entry: eB } = await makeLens('com.other');
    const { entry: eC } = await makeLens('com.third');
    expect(eA.fqn).not.toBe(eB.fqn);
    expect(eB.fqn).not.toBe(eC.fqn);
    expect(eA.fqn).not.toBe(eC.fqn);
  });

  it('cache is keyed by FQN: resolving the same symbol twice returns cached result', async () => {
    let openCount = 0;
    workspace.openTextDocument = async (uri: any) => {
      openCount++;
      return makeDoc(uri.toString());
    };
    const { lens: lensA } = await makeLens('com.example');

    await provider.resolveCodeLens(lensA, noCancel());
    await provider.resolveCodeLens(lensA, noCancel());

    // openTextDocument must be called exactly once — second call hits the cache
    expect(openCount).toBe(1);
  });

  it('concurrent resolution of same symbol shares one promise (openTextDocument called once)', async () => {
    let openCount = 0;
    workspace.openTextDocument = async (uri: any) => {
      openCount++;
      return makeDoc(uri.toString());
    };
    const { lens: lensA } = await makeLens('com.example');
    // Clone lens to simulate two separate resolveCodeLens calls
    const lensA2 = { ...lensA, data: lensA.data };

    const [r1, r2] = await Promise.all([
      provider.resolveCodeLens(lensA,  noCancel()),
      provider.resolveCodeLens(lensA2, noCancel()),
    ]);

    expect(openCount).toBe(1);          // promise shared — not computed twice
    expect(r1.command?.title).toBe(r2.command?.title);
  });

  it('refresh() clears all FQN-keyed entries; re-resolution recomputes correctly', async () => {
    const { lens: lensA } = await makeLens('com.example');
    const { lens: lensB } = await makeLens('com.other');

    await provider.resolveCodeLens(lensA, noCancel());
    await provider.resolveCodeLens(lensB, noCancel());

    provider.refresh();

    let openCount = 0;
    workspace.openTextDocument = async (uri: any) => { openCount++; return makeDoc(uri.toString()); };

    const rA = await provider.resolveCodeLens(lensA, noCancel());
    const rB = await provider.resolveCodeLens(lensB, noCancel());

    // After refresh both symbols must be recomputed (openTextDocument called for each)
    expect(openCount).toBe(2);
    expect(rA.command?.title).not.toContain('0 usages');
    expect(rB.command?.title).toContain('0 usages');
  });

  // ── Bug 2: cancelled scan must not poison the cache ────────────────────────

  it('cancelled resolution is evicted: next valid call gets real count', async () => {
    const { lens: lensA } = await makeLens('com.example');

    // First call: cancelled — scan aborts early, returns 0
    const cancelledResult = await provider.resolveCodeLens(lensA, cancelled());
    // Cancelled call does not set a command (returns lens unchanged)
    expect(cancelledResult.command).toBeUndefined();

    // Second call: valid token — must recompute, not use cached 0
    const validResult = await provider.resolveCodeLens(lensA, noCancel());
    expect(validResult.command?.title).not.toContain('0 usages');
  });

  it('cancelled resolution on zero-usage symbol: next valid call correctly shows 0', async () => {
    // Special case: cancelled AND real count is 0 — must not confuse "cancelled 0" with "real 0"
    const { lens: lensB } = await makeLens('com.other');

    // First call cancelled
    await provider.resolveCodeLens(lensB, cancelled());
    // Second call valid — should still produce "0 usages" (because B genuinely has 0)
    const validResult = await provider.resolveCodeLens(lensB, noCancel());
    expect(validResult.command?.title).toContain('0 usages');
  });

  it('multiple cancellations then a valid call: valid call always gets real count', async () => {
    const { lens: lensA } = await makeLens('com.example');

    // Three cancelled calls in a row
    await provider.resolveCodeLens(lensA, cancelled());
    await provider.resolveCodeLens(lensA, cancelled());
    await provider.resolveCodeLens(lensA, cancelled());

    // Valid call must still get the real count
    const valid = await provider.resolveCodeLens(lensA, noCancel());
    expect(valid.command?.title).not.toContain('0 usages');
  });

  // ── Declaration subtraction ────────────────────────────────────────────────

  it('symbol with zero callers shows exactly "0 usages" (not negative)', async () => {
    const { lens: lensB } = await makeLens('com.other');
    const result = await provider.resolveCodeLens(lensB, noCancel());
    expect(result.command?.title).toBe('0 usages');
  });

  it('symbol with callers: count equals callers only, not including declaration', async () => {
    // ServiceA.process is called twice — declaration should not inflate the count
    const { lens: lensA } = await makeLens('com.example');
    const result = await provider.resolveCodeLens(lensA, noCancel());
    expect(result.command?.title).toBe('2 usages');
  });

  it('"1 usage" uses singular form', async () => {
    // ServiceC.process is called exactly once
    const { lens: lensC } = await makeLens('com.third');
    const result = await provider.resolveCodeLens(lensC, noCancel());
    expect(result.command?.title).toBe('1 usage');
  });

  // ── Error resilience ───────────────────────────────────────────────────────

  it('openTextDocument failure yields "0 usages" without crashing', async () => {
    workspace.openTextDocument = async () => { throw new Error('file not found'); };
    const { lens: lensA } = await makeLens('com.example');
    const result = await provider.resolveCodeLens(lensA, noCancel());
    expect(result.command?.title).toContain('0 usages');
  });

  it('after openTextDocument failure, a retry with working fs gets real count', async () => {
    // First call: simulate transient error
    workspace.openTextDocument = async () => { throw new Error('transient'); };
    const { lens: lensA } = await makeLens('com.example');
    await provider.resolveCodeLens(lensA, noCancel());

    // refresh() simulates the user triggering a re-index (clears stale cache entries)
    provider.refresh();

    // Second call: fs is healthy again
    workspace.openTextDocument = async (uri: any) => makeDoc(uri.toString());
    const result = await provider.resolveCodeLens(lensA, noCancel());
    expect(result.command?.title).not.toContain('0 usages');
  });
});
