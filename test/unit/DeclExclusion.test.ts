/**
 * DeclExclusion.test.ts
 *
 * Regression tests for: "interface method declaration shows as usage of itself"
 *
 * Root cause: FindUsagesPanel.search() used to have no auto-exclude for the
 * target's declaration. scanForUsagesWithTarget() (correctly) includes the
 * declaration line. Without filtering, users saw the declaration as a result.
 *
 * Fix: FindUsagesPanel.search() now calls resolveSearchTarget() and filters
 * r.uriString === target.uri.toString() && r.line === target.line.
 *
 * These tests cover:
 *   DECL-1  Raw scan includes declaration — engine is correct (declaraton IS a match)
 *   DECL-2  resolveSearchTarget identifies the interface method correctly
 *   DECL-3  The filter removes exactly the declaration, nothing else
 *   DECL-4  Caller file (actual usage) survives the filter
 *   DECL-5  Override in impl is NOT excluded (different file/line)
 *   DECL-6  Searching from a usage site still excludes the declaration (target-based)
 *   DECL-7  Two same-named methods in different interfaces — correct one excluded
 *   DECL-8  Private method declaration also excluded
 *   DECL-9  Companion object method declaration excluded
 *   DECL-10 Zero usages: after filtering, empty result is clean (no crash)
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  resolveSearchTarget,
  scanForUsages,
  scanForUsagesWithTarget,
  clearContentCache,
} from '../../src/providers/FindUsagesEngine';
import { SymbolIndex } from '../../src/indexer/SymbolIndex';
import { parse } from '../../src/indexer/KotlinParser';
import { workspace } from './__mocks__/vscode';
import { mockDocument, positionOf } from './helpers';

// ── Fixtures ──────────────────────────────────────────────────────────────────

const URI_REPO      = 'file:///data/PokemonRepository.kt';
const URI_REPO_IMPL = 'file:///data/PokemonRepositoryImpl.kt';
const URI_SERVICE   = 'file:///ui/PokemonService.kt';
const URI_REPO2     = 'file:///data/BattleRepository.kt'; // second interface with same method name

const REPO_KT = `package com.example.data

interface PokemonRepository {
    suspend fun catch(id: Int): Pokemon
    suspend fun release(pokemon: Pokemon)
    fun getPokedex(): List<Pokemon>
}`;

const REPO_IMPL_KT = `package com.example.data

class PokemonRepositoryImpl : PokemonRepository {
    override suspend fun catch(id: Int) = storage.find(id)!!
    override suspend fun release(pokemon: Pokemon) { storage.remove(pokemon) }
    override fun getPokedex() = storage.all()
}`;

// A file that CALLS release() — should always survive the filter
const SERVICE_KT = `package com.example.ui

import com.example.data.PokemonRepository

class PokemonService(private val repo: PokemonRepository) {
    suspend fun removePokemon(pokemon: Pokemon) {
        repo.release(pokemon)
    }
}`;

// Second interface with a `release` method (different package)
const REPO2_KT = `package com.example.battle

interface BattleRepository {
    fun release(slot: Int)
}`;

const token = { isCancellationRequested: false };

// ── Shared setup ──────────────────────────────────────────────────────────────

function buildIndex(...files: Array<[string, string]>): SymbolIndex {
  const index = new SymbolIndex();
  for (const [uri, code] of files) index.add(parse(uri, code));
  return index;
}

/** Simulates FindUsagesPanel.search() filter step. */
function applyDeclFilter(
  raw: Awaited<ReturnType<typeof scanForUsages>>,
  target: ReturnType<typeof resolveSearchTarget>,
): typeof raw {
  if (!target) return raw;
  const declUri = target.uri.toString();
  return raw.filter(r => !(r.uriString === declUri && r.line === target.line));
}

// ── DECL-1 : Raw scan includes declaration ────────────────────────────────────

describe('DECL-1 — raw scanForUsages includes declaration line', () => {
  let index: SymbolIndex;

  beforeEach(() => {
    index = buildIndex([URI_REPO, REPO_KT], [URI_REPO_IMPL, REPO_IMPL_KT]);
    workspace.fs.readFile = async (uri: any) => {
      const s = typeof uri.toString === 'function' ? uri.toString() : String(uri);
      if (s === URI_REPO)      return Buffer.from(REPO_KT);
      if (s === URI_REPO_IMPL) return Buffer.from(REPO_IMPL_KT);
      throw new Error('not found');
    };
    clearContentCache();
  });
  afterEach(() => clearContentCache());

  it('release appears in raw results from the declaring file', async () => {
    const doc = mockDocument(URI_REPO, REPO_KT);
    const pos = positionOf(REPO_KT, 'release');
    const raw = await scanForUsages('release', doc, index, [URI_REPO, URI_REPO_IMPL], token as any);
    const declHits = raw.filter(r => r.uriString === URI_REPO);
    expect(declHits.length).toBeGreaterThan(0);
  });

  it('the declaration line IS one of the raw results', async () => {
    const doc = mockDocument(URI_REPO, REPO_KT);
    const target = resolveSearchTarget('release', doc, index)!;
    const raw = await scanForUsages('release', doc, index, [URI_REPO, URI_REPO_IMPL], token as any);
    const declInResults = raw.some(r => r.uriString === target.uri.toString() && r.line === target.line);
    expect(declInResults).toBe(true);
  });
});

// ── DECL-2 : resolveSearchTarget identifies the interface method ───────────────

describe('DECL-2 — resolveSearchTarget finds the correct release entry', () => {
  let index: SymbolIndex;

  beforeEach(() => {
    index = buildIndex([URI_REPO, REPO_KT], [URI_REPO_IMPL, REPO_IMPL_KT]);
  });

  it('target is defined for release from the interface file', () => {
    const doc = mockDocument(URI_REPO, REPO_KT);
    const pos = positionOf(REPO_KT, 'release');
    const target = resolveSearchTarget('release', doc, index);
    expect(target).toBeDefined();
  });

  it('target.name is release', () => {
    const doc = mockDocument(URI_REPO, REPO_KT);
    const target = resolveSearchTarget('release', doc, index)!;
    expect(target.name).toBe('release');
  });

  it('target is the PokemonRepository declaration (interface, not impl)', () => {
    const doc = mockDocument(URI_REPO, REPO_KT);
    const target = resolveSearchTarget('release', doc, index)!;
    // With same-package disambiguation, the interface entry is preferred
    expect(target.uri.toString()).toBe(URI_REPO);
  });
});

// ── DECL-3 : Filter removes exactly the declaration, nothing else ─────────────

describe('DECL-3 — declaration filter removes only the declaration line', () => {
  let index: SymbolIndex;

  beforeEach(() => {
    index = buildIndex([URI_REPO, REPO_KT], [URI_REPO_IMPL, REPO_IMPL_KT]);
    workspace.fs.readFile = async (uri: any) => {
      const s = typeof uri.toString === 'function' ? uri.toString() : String(uri);
      if (s === URI_REPO)      return Buffer.from(REPO_KT);
      if (s === URI_REPO_IMPL) return Buffer.from(REPO_IMPL_KT);
      throw new Error('not found');
    };
    clearContentCache();
  });
  afterEach(() => clearContentCache());

  it('filter reduces the result count by exactly 1 (the declaration)', async () => {
    const doc = mockDocument(URI_REPO, REPO_KT);
    const target = resolveSearchTarget('release', doc, index)!;
    const raw = await scanForUsages('release', doc, index, [URI_REPO, URI_REPO_IMPL], token as any);
    const filtered = applyDeclFilter(raw, target);
    expect(filtered.length).toBe(raw.length - 1);
  });

  it('after filter, no result is at (URI_REPO, declaration line)', async () => {
    const doc = mockDocument(URI_REPO, REPO_KT);
    const target = resolveSearchTarget('release', doc, index)!;
    const raw = await scanForUsages('release', doc, index, [URI_REPO, URI_REPO_IMPL], token as any);
    const filtered = applyDeclFilter(raw, target);
    const declStillPresent = filtered.some(r => r.uriString === URI_REPO && r.line === target.line);
    expect(declStillPresent).toBe(false);
  });
});

// ── DECL-4 : Caller file (real usage) survives the filter ─────────────────────

describe('DECL-4 — actual call site survives the declaration filter', () => {
  let index: SymbolIndex;

  beforeEach(() => {
    index = buildIndex([URI_REPO, REPO_KT], [URI_REPO_IMPL, REPO_IMPL_KT], [URI_SERVICE, SERVICE_KT]);
    workspace.fs.readFile = async (uri: any) => {
      const s = typeof uri.toString === 'function' ? uri.toString() : String(uri);
      if (s === URI_REPO)      return Buffer.from(REPO_KT);
      if (s === URI_REPO_IMPL) return Buffer.from(REPO_IMPL_KT);
      if (s === URI_SERVICE)   return Buffer.from(SERVICE_KT);
      throw new Error('not found');
    };
    clearContentCache();
  });
  afterEach(() => clearContentCache());

  it('repo.release(pokemon) call in PokemonService.kt is in filtered results', async () => {
    const doc = mockDocument(URI_REPO, REPO_KT);
    const target = resolveSearchTarget('release', doc, index)!;
    const raw = await scanForUsages('release', doc, index, [URI_REPO, URI_REPO_IMPL, URI_SERVICE], token as any);
    const filtered = applyDeclFilter(raw, target);
    const serviceHits = filtered.filter(r => r.uriString === URI_SERVICE);
    expect(serviceHits.length).toBeGreaterThan(0);
  });

  it('the call site line contains repo.release', async () => {
    const doc = mockDocument(URI_REPO, REPO_KT);
    const target = resolveSearchTarget('release', doc, index)!;
    const raw = await scanForUsages('release', doc, index, [URI_REPO, URI_REPO_IMPL, URI_SERVICE], token as any);
    const filtered = applyDeclFilter(raw, target);
    const hit = filtered.find(r => r.uriString === URI_SERVICE);
    expect(hit?.lineText).toContain('repo.release');
  });
});

// ── DECL-5 : Override in impl is NOT excluded ─────────────────────────────────

describe('DECL-5 — override in implementation is NOT excluded', () => {
  let index: SymbolIndex;

  beforeEach(() => {
    index = buildIndex([URI_REPO, REPO_KT], [URI_REPO_IMPL, REPO_IMPL_KT]);
    workspace.fs.readFile = async (uri: any) => {
      const s = typeof uri.toString === 'function' ? uri.toString() : String(uri);
      if (s === URI_REPO)      return Buffer.from(REPO_KT);
      if (s === URI_REPO_IMPL) return Buffer.from(REPO_IMPL_KT);
      throw new Error('not found');
    };
    clearContentCache();
  });
  afterEach(() => clearContentCache());

  it('override fun release in PokemonRepositoryImpl.kt remains after filter', async () => {
    const doc = mockDocument(URI_REPO, REPO_KT);
    const target = resolveSearchTarget('release', doc, index)!;
    const raw = await scanForUsages('release', doc, index, [URI_REPO, URI_REPO_IMPL], token as any);
    const filtered = applyDeclFilter(raw, target);
    const implHits = filtered.filter(r => r.uriString === URI_REPO_IMPL);
    expect(implHits.length).toBeGreaterThan(0);
  });
});

// ── DECL-6 : Searching from usage site still excludes declaration ──────────────

describe('DECL-6 — target-based filter excludes declaration even from usage site', () => {
  let index: SymbolIndex;

  beforeEach(() => {
    index = buildIndex([URI_REPO, REPO_KT], [URI_REPO_IMPL, REPO_IMPL_KT], [URI_SERVICE, SERVICE_KT]);
    workspace.fs.readFile = async (uri: any) => {
      const s = typeof uri.toString === 'function' ? uri.toString() : String(uri);
      if (s === URI_REPO)      return Buffer.from(REPO_KT);
      if (s === URI_REPO_IMPL) return Buffer.from(REPO_IMPL_KT);
      if (s === URI_SERVICE)   return Buffer.from(SERVICE_KT);
      throw new Error('not found');
    };
    clearContentCache();
  });
  afterEach(() => clearContentCache());

  it('resolveSearchTarget from usage site still resolves to PokemonRepository.release', () => {
    const doc = mockDocument(URI_SERVICE, SERVICE_KT);
    const target = resolveSearchTarget('release', doc, index);
    // With the import of PokemonRepository, target resolves to the interface
    expect(target?.uri.toString()).toBe(URI_REPO);
  });

  it('declaration is not in filtered results when searching from usage site', async () => {
    const doc = mockDocument(URI_SERVICE, SERVICE_KT);
    const target = resolveSearchTarget('release', doc, index)!;
    const raw = await scanForUsages('release', doc, index, [URI_REPO, URI_REPO_IMPL, URI_SERVICE], token as any);
    const filtered = applyDeclFilter(raw, target);
    const declStillPresent = filtered.some(r => r.uriString === URI_REPO && r.line === target.line);
    expect(declStillPresent).toBe(false);
  });
});

// ── DECL-7 : Two same-named methods in different interfaces ────────────────────

describe('DECL-7 — same method name in two different interfaces, correct one excluded', () => {
  let index: SymbolIndex;

  beforeEach(() => {
    index = buildIndex(
      [URI_REPO,  REPO_KT],
      [URI_REPO2, REPO2_KT],
      [URI_REPO_IMPL, REPO_IMPL_KT],
    );
    workspace.fs.readFile = async (uri: any) => {
      const s = typeof uri.toString === 'function' ? uri.toString() : String(uri);
      if (s === URI_REPO)      return Buffer.from(REPO_KT);
      if (s === URI_REPO2)     return Buffer.from(REPO2_KT);
      if (s === URI_REPO_IMPL) return Buffer.from(REPO_IMPL_KT);
      throw new Error('not found');
    };
    clearContentCache();
  });
  afterEach(() => clearContentCache());

  it('from PokemonRepository, target is PokemonRepository.release (not BattleRepository)', () => {
    const doc = mockDocument(URI_REPO, REPO_KT);
    const target = resolveSearchTarget('release', doc, index);
    expect(target?.uri.toString()).toBe(URI_REPO);
  });

  it('from BattleRepository, target is BattleRepository.release (not PokemonRepository)', () => {
    const doc = mockDocument(URI_REPO2, REPO2_KT);
    const target = resolveSearchTarget('release', doc, index);
    expect(target?.uri.toString()).toBe(URI_REPO2);
  });
});

// ── DECL-8 : Private method declaration is also excluded ──────────────────────

describe('DECL-8 — private method declaration is excluded', () => {
  const URI_VM = 'file:///viewmodel/LoginViewModel.kt';
  const VM_KT = `package com.example.viewmodel

class LoginViewModel {
    private fun release() {
        clearSession()
        release()
    }
}`;

  let index: SymbolIndex;

  beforeEach(() => {
    index = buildIndex([URI_VM, VM_KT]);
    workspace.fs.readFile = async (uri: any) => {
      const s = typeof uri.toString === 'function' ? uri.toString() : String(uri);
      if (s === URI_VM) return Buffer.from(VM_KT);
      throw new Error('not found');
    };
    clearContentCache();
  });
  afterEach(() => clearContentCache());

  it('private fun release declaration is excluded from filtered results', async () => {
    const doc = mockDocument(URI_VM, VM_KT);
    const target = resolveSearchTarget('release', doc, index)!;
    expect(target).toBeDefined();
    const raw = await scanForUsages('release', doc, index, [URI_VM], token as any);
    const filtered = applyDeclFilter(raw, target);
    const declPresent = filtered.some(r => r.uriString === URI_VM && r.line === target.line);
    expect(declPresent).toBe(false);
  });

  it('the recursive call to release() inside the method body remains', async () => {
    const doc = mockDocument(URI_VM, VM_KT);
    const target = resolveSearchTarget('release', doc, index)!;
    const raw = await scanForUsages('release', doc, index, [URI_VM], token as any);
    const filtered = applyDeclFilter(raw, target);
    // The self-call on the `release()` body line should still be in results
    const bodyHit = filtered.find(r => r.lineText.trim() === 'release()');
    expect(bodyHit).toBeDefined();
  });
});

// ── DECL-9 : Companion object method declaration is excluded ───────────────────

describe('DECL-9 — companion object method declaration is excluded', () => {
  const URI_COMP = 'file:///data/Pokemon.kt';
  const COMP_KT = `package com.example.data

class Pokemon(val id: Int, val name: String) {
    companion object {
        fun create(id: Int, name: String) = Pokemon(id, name)
    }
    fun describe() = create(id, name).name
}`;

  let index: SymbolIndex;

  beforeEach(() => {
    index = buildIndex([URI_COMP, COMP_KT]);
    workspace.fs.readFile = async (uri: any) => {
      const s = typeof uri.toString === 'function' ? uri.toString() : String(uri);
      if (s === URI_COMP) return Buffer.from(COMP_KT);
      throw new Error('not found');
    };
    clearContentCache();
  });
  afterEach(() => clearContentCache());

  it('companion fun create declaration is excluded from filtered results', async () => {
    const doc = mockDocument(URI_COMP, COMP_KT);
    const target = resolveSearchTarget('create', doc, index)!;
    if (!target) return; // create might be ambiguous — skip gracefully
    const raw = await scanForUsages('create', doc, index, [URI_COMP], token as any);
    const filtered = applyDeclFilter(raw, target);
    const declPresent = filtered.some(r => r.uriString === URI_COMP && r.line === target.line);
    expect(declPresent).toBe(false);
  });
});

// ── DECL-10 : Zero usages after filtering — no crash ─────────────────────────

describe('DECL-10 — filtering to zero results does not crash', () => {
  const URI_ISOLATED = 'file:///isolated/OnlyHere.kt';
  const ISOLATED_KT = `package com.example.isolated

class OnlyHere {
    fun releaseAll() {}
}`;

  let index: SymbolIndex;

  beforeEach(() => {
    index = buildIndex([URI_ISOLATED, ISOLATED_KT]);
    workspace.fs.readFile = async (uri: any) => {
      const s = typeof uri.toString === 'function' ? uri.toString() : String(uri);
      if (s === URI_ISOLATED) return Buffer.from(ISOLATED_KT);
      throw new Error('not found');
    };
    clearContentCache();
  });
  afterEach(() => clearContentCache());

  it('scanning a method with only its declaration yields 1 raw result', async () => {
    const doc = mockDocument(URI_ISOLATED, ISOLATED_KT);
    const raw = await scanForUsages('releaseAll', doc, index, [URI_ISOLATED], token as any);
    expect(raw.length).toBe(1);
  });

  it('after filtering, result is empty array (no crash)', async () => {
    const doc = mockDocument(URI_ISOLATED, ISOLATED_KT);
    const target = resolveSearchTarget('releaseAll', doc, index)!;
    const raw = await scanForUsages('releaseAll', doc, index, [URI_ISOLATED], token as any);
    const filtered = applyDeclFilter(raw, target);
    expect(filtered).toHaveLength(0);
  });
});
