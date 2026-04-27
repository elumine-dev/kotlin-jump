import { describe, it, expect, beforeEach } from 'vitest';
import { KotlinDefinitionProvider } from '../../src/providers/DefinitionProvider';
import { SymbolIndex } from '../../src/indexer/SymbolIndex';
import { parse } from '../../src/indexer/KotlinParser';
import { mockDocument, positionOf } from './helpers';
import { Location } from './__mocks__/vscode';

function addFile(index: SymbolIndex, uri: string, code: string) {
  index.add(parse(uri, code));
}

// ── Demo project source ─────────────────────────────────────────────────────

const POKEMON_KT = `package com.example.data

data class Pokemon(val id: Int, val name: String)

enum class PokemonType { FIRE, WATER, GRASS }

sealed class BattleResult {
    data class Victory(val winner: Pokemon) : BattleResult()
    data class Defeat(val loser: Pokemon) : BattleResult()
    data object Draw : BattleResult()
}`;

const REPO_KT = `package com.example.data

interface PokemonRepository {
    fun getPokedex(): List<Pokemon>
    fun battle(attacker: Pokemon, defender: Pokemon): BattleResult
}`;

const REPO_IMPL_KT = `package com.example.data

class PokemonRepositoryImpl(
    private val storage: PokemonStorage,
) : PokemonRepository {
    override fun getPokedex(): List<Pokemon> {
        return storage.getAll()
    }
    override fun battle(attacker: Pokemon, defender: Pokemon): BattleResult {
        return BattleResult.Draw
    }
}`;

const STORAGE_KT = `package com.example.data

class PokemonStorage {
    fun getAll(): List<Pokemon> = emptyList()
    fun save(pokemon: Pokemon) {}
}`;

const VIEWMODEL_KT = `package com.example.ui

import com.example.data.Pokemon
import com.example.data.PokemonRepository
import com.example.data.BattleResult

class PokedexViewModel(private val repository: PokemonRepository) {
    suspend fun catchPokemon(id: Int): Pokemon {
        return repository.getPokedex().first()
    }
    fun startBattle(attacker: Pokemon, defender: Pokemon): BattleResult {
        return repository.battle(attacker, defender)
    }
}`;

const APP_KT = `package com.example.app

import com.example.data.PokemonRepositoryImpl
import com.example.data.PokemonStorage

fun main() {
    val storage = PokemonStorage()
    val repository = PokemonRepositoryImpl(storage)
}`;

// ── Tests ───────────────────────────────────────────────────────────────────

describe('Go to Definition (Cmd+Click from usage)', () => {
  let index: SymbolIndex;
  let provider: KotlinDefinitionProvider;

  beforeEach(() => {
    index = new SymbolIndex();
    addFile(index, 'file:///data/Pokemon.kt', POKEMON_KT);
    addFile(index, 'file:///data/PokemonRepository.kt', REPO_KT);
    addFile(index, 'file:///data/PokemonRepositoryImpl.kt', REPO_IMPL_KT);
    addFile(index, 'file:///data/PokemonStorage.kt', STORAGE_KT);
    addFile(index, 'file:///ui/PokedexViewModel.kt', VIEWMODEL_KT);
    addFile(index, 'file:///app/App.kt', APP_KT);
    provider = new KotlinDefinitionProvider(index);
  });

  it('1. App.kt → PokemonRepositoryImpl → jumps to definition', () => {
    const doc = mockDocument('file:///app/App.kt', APP_KT);
    const pos = positionOf(APP_KT, 'PokemonRepositoryImpl', 2); // usage, not import
    const result = provider.provideDefinition(doc, pos) as Location | Location[];
    const locs = Array.isArray(result) ? result : [result];
    expect(locs.some(l => l.uri.toString() === 'file:///data/PokemonRepositoryImpl.kt')).toBe(true);
  });

  it('2. App.kt → PokemonStorage → jumps to definition', () => {
    const doc = mockDocument('file:///app/App.kt', APP_KT);
    const pos = positionOf(APP_KT, 'PokemonStorage', 2); // usage, not import
    const result = provider.provideDefinition(doc, pos) as Location | Location[];
    const locs = Array.isArray(result) ? result : [result];
    expect(locs.some(l => l.uri.toString() === 'file:///data/PokemonStorage.kt')).toBe(true);
  });

  it('3. ViewModel → PokemonRepository → jumps to interface', () => {
    const doc = mockDocument('file:///ui/PokedexViewModel.kt', VIEWMODEL_KT);
    const pos = positionOf(VIEWMODEL_KT, 'PokemonRepository', 2); // usage in constructor
    const result = provider.provideDefinition(doc, pos) as Location | Location[];
    const locs = Array.isArray(result) ? result : [result];
    expect(locs.some(l => l.uri.toString() === 'file:///data/PokemonRepository.kt')).toBe(true);
  });
});

describe('Go to Implementation (Cmd+Click on declaration)', () => {
  let index: SymbolIndex;
  let provider: KotlinDefinitionProvider;

  beforeEach(() => {
    index = new SymbolIndex();
    addFile(index, 'file:///data/Pokemon.kt', POKEMON_KT);
    addFile(index, 'file:///data/PokemonRepository.kt', REPO_KT);
    addFile(index, 'file:///data/PokemonRepositoryImpl.kt', REPO_IMPL_KT);
    addFile(index, 'file:///data/PokemonStorage.kt', STORAGE_KT);
    provider = new KotlinDefinitionProvider(index);
  });

  it('4. PokemonRepository interface → jumps to PokemonRepositoryImpl', () => {
    const doc = mockDocument('file:///data/PokemonRepository.kt', REPO_KT);
    const pos = positionOf(REPO_KT, 'PokemonRepository');
    const result = provider.provideDefinition(doc, pos) as Location | Location[];
    const locs = Array.isArray(result) ? result : [result];
    expect(locs.some(l => l.uri.toString() === 'file:///data/PokemonRepositoryImpl.kt')).toBe(true);
  });

  it('5. battle() method in interface → jumps to override', () => {
    const doc = mockDocument('file:///data/PokemonRepository.kt', REPO_KT);
    const pos = positionOf(REPO_KT, 'battle');
    const result = provider.provideDefinition(doc, pos) as Location | Location[];
    const locs = Array.isArray(result) ? result : [result];
    expect(locs.some(l => l.uri.toString() === 'file:///data/PokemonRepositoryImpl.kt')).toBe(true);
  });
});

describe('Cmd+Click on declaration with no implementation', () => {
  let index: SymbolIndex;
  let provider: KotlinDefinitionProvider;

  beforeEach(() => {
    index = new SymbolIndex();
    addFile(index, 'file:///data/Pokemon.kt', POKEMON_KT);
    addFile(index, 'file:///data/PokemonRepository.kt', REPO_KT);
    addFile(index, 'file:///data/PokemonRepositoryImpl.kt', REPO_IMPL_KT);
    addFile(index, 'file:///ui/PokedexViewModel.kt', VIEWMODEL_KT);
    provider = new KotlinDefinitionProvider(index);
  });

  it('7. Pokemon data class → returns self (pending nav set for Find Usages)', () => {
    const doc = mockDocument('file:///data/Pokemon.kt', POKEMON_KT);
    const pos = positionOf(POKEMON_KT, 'Pokemon');
    const result = provider.provideDefinition(doc, pos) as Location;
    // Returns self location (pending nav handles Find Usages on actual click)
    expect(result).toBeDefined();
    expect(result.uri.toString()).toBe('file:///data/Pokemon.kt');
  });

  it('8. Victory in BattleResult → returns self', () => {
    const doc = mockDocument('file:///data/Pokemon.kt', POKEMON_KT);
    const pos = positionOf(POKEMON_KT, 'Victory');
    const result = provider.provideDefinition(doc, pos) as Location;
    expect(result).toBeDefined();
  });

  it('9. catchPokemon → returns self', () => {
    const doc = mockDocument('file:///ui/PokedexViewModel.kt', VIEWMODEL_KT);
    const pos = positionOf(VIEWMODEL_KT, 'catchPokemon');
    const result = provider.provideDefinition(doc, pos) as Location;
    expect(result).toBeDefined();
  });
});

describe('Edge cases', () => {
  it('returns null for single-char words', () => {
    const index = new SymbolIndex();
    const provider = new KotlinDefinitionProvider(index);
    const doc = mockDocument('file:///test.kt', 'val x = 1');
    const result = provider.provideDefinition(doc, positionOf('val x = 1', 'x'));
    expect(result).toBeNull();
  });

  it('returns null for unknown symbols', () => {
    const index = new SymbolIndex();
    const provider = new KotlinDefinitionProvider(index);
    const doc = mockDocument('file:///test.kt', 'val foo = UnknownClass()');
    const result = provider.provideDefinition(doc, positionOf('val foo = UnknownClass()', 'UnknownClass'));
    expect(result).toBeNull();
  });
});

// ── Adversarial: step2 visibility filtering — isEnclosingClassVisible ────────
//
// The step2 fallback uses isEnclosingClassVisible to decide whether a symbol
// in the workspace index is actually reachable from the current file.
// Resolution priority (mirrors ImportResolver.resolveBest for the parent class):
//   1. Exact import  `import pkg.EnclosingClass`
//   2. Same package  (no import needed)
//   3. Wildcard      `import pkg.*`
//
// When NONE of those match, the symbol's enclosing class is not visible and
// we must return null rather than polluting the picker with unrelated results.
// This is the "Compose colorResource" class of bugs: the library function is
// explicitly imported but not indexed; a workspace class happens to have a
// member with the same simple name.

describe('DefinitionProvider — step2 isEnclosingClassVisible (adversarial)', () => {

  // ── helpers ────────────────────────────────────────────────────────────────

  function makeIndex(...defs: Array<[string, string]>): SymbolIndex {
    const idx = new SymbolIndex();
    for (const [uri, code] of defs) idx.add(parse(uri, code));
    return idx;
  }

  function provider(index: SymbolIndex) {
    return new KotlinDefinitionProvider(index);
  }

  // ImportResolver has a module-level cache keyed by document.uri + version.
  // All mock documents use version=1, so tests sharing a URI string would read
  // stale imports from a previous test. Append a monotone counter to every caller
  // URI so each goTo() call gets a fresh cache entry.
  let _seq = 0;
  function goTo(p: KotlinDefinitionProvider, uri: string, code: string, word: string, occ = 1) {
    const u = `${uri.slice(0, -3)}_s${_seq++}.kt`;
    return p.provideDefinition(mockDocument(u, code), positionOf(code, word, occ));
  }

  // For tests that need document.uri to match an index entry URI exactly
  // (sameFile tiebreak), bypass the sequence suffix.
  function goToAt(p: KotlinDefinitionProvider, uri: string, code: string, word: string, occ = 1) {
    return p.provideDefinition(mockDocument(uri, code), positionOf(code, word, occ));
  }

  // ── Group 1: unindexed library symbol (core regression) ───────────────────

  it('library import + 1 unrelated workspace member → null', () => {
    // colorResource imported from Compose (not indexed), 1 VM has same name
    const idx = makeIndex(
      ['file:///vm/LoginVM.kt', `package com.example.login\nclass LoginVM {\n    val colorResource = 0\n}`],
    );
    const callerCode = `package com.example.ui
import androidx.compose.ui.res.colorResource
fun Screen() { colorResource(0) }`;
    expect(goTo(provider(idx), 'file:///ui/Screen.kt', callerCode, 'colorResource', 2)).toBeNull();
  });

  it('library import + 2 unrelated workspace members → null', () => {
    const idx = makeIndex(
      ['file:///vm/A.kt', `package com.a\nclass A {\n    val colorResource = 0\n}`],
      ['file:///vm/B.kt', `package com.b\nclass B {\n    val colorResource = 0\n}`],
    );
    const callerCode = `package com.ui
import androidx.compose.ui.res.colorResource
fun Screen() { colorResource(0) }`;
    expect(goTo(provider(idx), 'file:///ui/S.kt', callerCode, 'colorResource', 2)).toBeNull();
  });

  it('library import + unrelated member + same-package member → returns ONLY same-package', () => {
    // LoginVM is foreign; WidgetHelper is in the same package as the caller
    const idx = makeIndex(
      ['file:///vm/LoginVM.kt',     `package com.example.login\nclass LoginVM {\n    val colorResource = 0\n}`],
      ['file:///widget/Helper.kt',  `package com.example.widget\nclass WidgetHelper {\n    val colorResource = 0\n}`],
    );
    const callerCode = `package com.example.widget
import androidx.compose.ui.res.colorResource
fun Screen() { colorResource(0) }`;
    const result = goTo(provider(idx), 'file:///widget/Screen.kt', callerCode, 'colorResource', 2);
    // LoginVM is invisible (different package, not imported).
    // WidgetHelper is visible (same package) → isEnclosingClassVisible = true.
    expect(result).not.toBeNull();
    expect((result as any)?.uri?.path ?? (Array.isArray(result) ? (result as any[])[0]?.uri?.path : '')).toContain('Helper.kt');
  });

  it('library import + ViewModel class is ALSO explicitly imported → returns VM member (visible)', () => {
    // The caller imports BOTH the Compose function AND the ViewModel class.
    // The ViewModel's member IS now reachable (class visible via exact import).
    const idx = makeIndex(
      ['file:///vm/LoginVM.kt', `package com.example.login\nclass LoginVM {\n    val colorResource = 0\n}`],
    );
    const callerCode = `package com.example.ui
import androidx.compose.ui.res.colorResource
import com.example.login.LoginVM
fun Screen() { val vm = LoginVM(); vm.colorResource }`;
    const result = goTo(provider(idx), 'file:///ui/S.kt', callerCode, 'colorResource', 2);
    // LoginVM IS imported → isEnclosingClassVisible = true → member returned
    expect(result).not.toBeNull();
  });

  it('library import + ViewModel package imported via wildcard → returns VM member', () => {
    const idx = makeIndex(
      ['file:///vm/LoginVM.kt', `package com.example.login\nclass LoginVM {\n    val colorResource = 0\n}`],
    );
    const callerCode = `package com.example.ui
import androidx.compose.ui.res.colorResource
import com.example.login.*
fun Screen() { val vm = LoginVM(); vm.colorResource }`;
    const result = goTo(provider(idx), 'file:///ui/S.kt', callerCode, 'colorResource', 2);
    expect(result).not.toBeNull();
  });

  // ── Group 2: isEnclosingClassVisible truth table ───────────────────────────

  it('different package, no import of enclosing class → invisible → null', () => {
    const idx = makeIndex(
      ['file:///vm/Vm.kt', `package com.example.vm\nclass Vm {\n    val status = 0\n}`],
    );
    // Caller is in a completely different package with no import of Vm
    const callerCode = `package com.example.unrelated\nfun doSomething() { status }`;
    expect(goTo(provider(idx), 'file:///unrelated/X.kt', callerCode, 'status')).toBeNull();
  });

  it('exact import of enclosing class → visible → returns member', () => {
    const idx = makeIndex(
      ['file:///vm/Vm.kt', `package com.example.vm\nclass Vm {\n    fun status(): Int = 0\n}`],
    );
    const callerCode = `package com.example.ui
import com.example.vm.Vm
fun use() { Vm().status() }`;
    const result = goTo(provider(idx), 'file:///ui/U.kt', callerCode, 'status');
    expect(result).not.toBeNull();
  });

  it('wildcard import of enclosing class package → visible → returns member', () => {
    const idx = makeIndex(
      ['file:///vm/Vm.kt', `package com.example.vm\nclass Vm {\n    fun status(): Int = 0\n}`],
    );
    const callerCode = `package com.example.ui
import com.example.vm.*
fun use() { Vm().status() }`;
    const result = goTo(provider(idx), 'file:///ui/U.kt', callerCode, 'status');
    expect(result).not.toBeNull();
  });

  it('alias import of enclosing class → visible (alias does not break FQN lookup)', () => {
    // `import com.example.vm.Vm as ViewModel` — the regex captures `com.example.vm.Vm`,
    // so exactCandidates('Vm', cache) still finds it even with alias.
    const idx = makeIndex(
      ['file:///vm/Vm.kt', `package com.example.vm\nclass Vm {\n    fun status(): Int = 0\n}`],
    );
    const callerCode = `package com.example.ui
import com.example.vm.Vm as ViewModel
fun use() { ViewModel().status() }`;
    const result = goTo(provider(idx), 'file:///ui/U.kt', callerCode, 'status');
    expect(result).not.toBeNull();
  });

  it('same package, no import → visible (samePackageCandidates resolves parent class)', () => {
    const idx = makeIndex(
      ['file:///pkg/Repo.kt', `package com.example.pkg\nclass Repo {\n    fun fetch(): Int = 0\n}`],
    );
    const callerCode = `package com.example.pkg\nfun caller() { Repo().fetch() }`;
    const result = goTo(provider(idx), 'file:///pkg/Caller.kt', callerCode, 'fetch');
    expect(result).not.toBeNull();
  });

  it('import of outer class only, access to inner class member → invisible', () => {
    // File imports Outer, not Outer.Inner. isEnclosingClassVisible checks parentName='Inner',
    // which is not in exactCandidates (no `import ... .Inner`) and not in samePackage.
    // This is a known limitation: inner class members require explicit Inner import.
    const idx = makeIndex(
      ['file:///Outer.kt', `package com.example
class Outer {
    class Inner {
        fun innerMethod(): Int = 0
    }
}`],
    );
    const callerCode = `package com.example.ui
import com.example.Outer
fun use() { Outer.Inner().innerMethod() }`;
    const result = goTo(provider(idx), 'file:///ui/U.kt', callerCode, 'innerMethod');
    // isEnclosingClassVisible('Inner') → not in exactCandidates → false → null
    // (known limitation: inner class members from outer-only import are not resolved)
    expect(result).toBeNull();
  });

  it('explicit import of inner class → inner member IS visible', () => {
    // When Inner itself is explicitly imported, isEnclosingClassVisible is true.
    const idx = makeIndex(
      ['file:///Outer.kt', `package com.example
class Outer {
    class Inner {
        fun innerMethod(): Int = 0
    }
}`],
    );
    const callerCode = `package com.example.ui
import com.example.Outer.Inner
fun use() { Inner().innerMethod() }`;
    const result = goTo(provider(idx), 'file:///ui/U.kt', callerCode, 'innerMethod');
    expect(result).not.toBeNull();
  });

  // ── Group 3: multiple candidates with mixed visibility ────────────────────

  it('3 candidates, 1 visible (explicit import) → returns only the visible one', () => {
    const idx = makeIndex(
      ['file:///a/A.kt', `package com.a\nclass A {\n    fun execute(): Int = 0\n}`],
      ['file:///b/B.kt', `package com.b\nclass B {\n    fun execute(): Int = 0\n}`],
      ['file:///c/C.kt', `package com.c\nclass C {\n    fun execute(): Int = 0\n}`],
    );
    // Only imports A
    const callerCode = `package com.ui
import com.a.A
fun go() { A().execute() }`;
    const result = goTo(provider(idx), 'file:///ui/U.kt', callerCode, 'execute');
    // A.execute is visible; B.execute and C.execute are not
    expect(result).not.toBeNull();
    expect(Array.isArray(result)).toBe(false); // single result, not a picker
    expect((result as any).uri.path).toContain('/a/A.kt');
  });

  it('3 candidates, 2 visible (1 exact import + 1 same-package) → picker with ONLY the 2 visible', () => {
    const idx = makeIndex(
      ['file:///a/A.kt', `package com.example.a\nclass A {\n    fun execute(): Int = 0\n}`],
      ['file:///b/B.kt', `package com.example.b\nclass B {\n    fun execute(): Int = 0\n}`],
      ['file:///c/C.kt', `package com.example.c\nclass C {\n    fun execute(): Int = 0\n}`],
    );
    const callerCode = `package com.example.a
import com.example.b.B
fun go() { execute() }`;
    const result = goTo(provider(idx), 'file:///a/Caller.kt', callerCode, 'execute');
    // A.execute visible (same package), B.execute visible (explicit import), C.execute not visible
    expect(Array.isArray(result)).toBe(true);
    expect((result as any[]).length).toBe(2);
    const paths = (result as any[]).map((r: any) => r.uri.path);
    expect(paths.some((p: string) => p.includes('/a/'))).toBe(true);
    expect(paths.some((p: string) => p.includes('/b/'))).toBe(true);
    expect(paths.every((p: string) => !p.includes('/c/'))).toBe(true); // C excluded
  });

  it('2 visible, cursor in one declaring file → same-file tiebreak', () => {
    const idx = makeIndex(
      ['file:///a/A.kt', `package com.example\nclass A {\n    fun doWork(): Int = 0\n}`],
      ['file:///b/B.kt', `package com.example\nclass B {\n    fun doWork(): Int = 0\n}`],
    );
    // goToAt: document URI must match the index entry URI for sameFile tiebreak to fire
    const codeA = `package com.example\nclass A {\n    fun doWork(): Int = 0\n}`;
    const result = goToAt(provider(idx), 'file:///a/A.kt', codeA, 'doWork');
    // visibleByImport = [A.doWork, B.doWork] (same package, both visible)
    // sameFileTiebreak = [A.doWork] (only A is in /a/A.kt)
    expect(result).not.toBeNull();
    expect(Array.isArray(result)).toBe(false);
    expect((result as any).uri.path).toContain('/a/A.kt');
  });

  it('2 visible, cursor in THIRD file → picker returns both', () => {
    const idx = makeIndex(
      ['file:///a/A.kt', `package com.example\nclass A {\n    fun doWork(): Int = 0\n}`],
      ['file:///b/B.kt', `package com.example\nclass B {\n    fun doWork(): Int = 0\n}`],
    );
    const callerCode = `package com.example\nfun caller() { doWork() }`;
    const result = goTo(provider(idx), 'file:///c/C.kt', callerCode, 'doWork');
    // Both A.doWork and B.doWork are same-package visible; cursor in C.kt (not declaring)
    expect(Array.isArray(result)).toBe(true);
    expect((result as any[]).length).toBe(2);
  });

  it('2 invisible, cursor in declaring file of one → sameFile fallback returns it', () => {
    // WorkerA.status in pkg com.a; WorkerB.status in pkg com.b.
    // Neither is visible from a pkg-com.c file. But cursor is in WorkerA.kt itself.
    // Note: WorkerA.status IS visible via samePackage (WorkerA class is in same pkg),
    // so this actually exercises the visibleByImport.length=1 path, not sameFile.
    // The key assertion: only WorkerA.status is returned, not WorkerB.status.
    const idx = makeIndex(
      ['file:///a/WorkerA.kt', `package com.a\nclass WorkerA {\n    fun status(): Int = 0\n}`],
      ['file:///b/WorkerB.kt', `package com.b\nclass WorkerB {\n    fun status(): Int = 0\n}`],
    );
    const workerACode = `package com.a\nclass WorkerA {\n    fun status(): Int = 0\n    fun run() { status() }\n}`;
    // goToAt: URI must match index entry for sameFile/samePackage to resolve correctly
    const result = goToAt(provider(idx), 'file:///a/WorkerA.kt', workerACode, 'status', 2);
    // WorkerA.status visible (com.a package = cursor pkg); WorkerB.status invisible
    expect(result).not.toBeNull();
    expect((result as any).uri.path).toContain('/a/WorkerA.kt');
  });

  it('2 invisible (neither in index at all), cursor outside both → null', () => {
    // Both symbols exist in index but NEITHER enclosing class is resolvable from caller
    const idx = makeIndex(
      ['file:///x/X.kt', `package com.x\nclass X {\n    fun sync(): Int = 0\n}`],
      ['file:///y/Y.kt', `package com.y\nclass Y {\n    fun sync(): Int = 0\n}`],
    );
    const callerCode = `package com.z\nfun caller() { sync() }`;
    expect(goTo(provider(idx), 'file:///z/Z.kt', callerCode, 'sync')).toBeNull();
  });

  // ── Group 4: step1 vs step2 boundary ─────────────────────────────────────

  it('explicitly imported top-level class → step1 resolves (step2 is never the source)', () => {
    const idx = makeIndex(
      ['file:///repo/Repo.kt', `package com.example.repo\nclass Repo`],
    );
    const callerCode = `package com.example.ui
import com.example.repo.Repo
class Screen(val repo: Repo)`;
    const result = goTo(provider(idx), 'file:///ui/Screen.kt', callerCode, 'Repo', 2);
    expect(result).not.toBeNull();
  });

  it('same-package top-level class → step1 resolves via samePackageCandidates', () => {
    const idx = makeIndex(
      ['file:///pkg/Helper.kt', `package com.example\nclass Helper`],
    );
    const callerCode = `package com.example\nfun use(h: Helper) {}`;
    const result = goTo(provider(idx), 'file:///pkg/Caller.kt', callerCode, 'Helper');
    expect(result).not.toBeNull();
  });

  it('member of imported class → step2 resolves (class in exact import, not the member)', () => {
    // `import Repo` → step1 can't find `fetch` (no import ending in `.fetch`)
    // → falls to step2 where isEnclosingClassVisible('Repo') is true via exactCandidates
    const idx = makeIndex(
      ['file:///repo/Repo.kt', `package com.example.repo\nclass Repo {\n    fun fetch(): Int = 0\n}`],
    );
    const callerCode = `package com.example.ui
import com.example.repo.Repo
fun go() { Repo().fetch() }`;
    const result = goTo(provider(idx), 'file:///ui/U.kt', callerCode, 'fetch');
    expect(result).not.toBeNull();
    expect((result as any).uri.path).toContain('Repo.kt');
  });

  // ── Group 5: top-level function sameFile fallback ─────────────────────────

  it('top-level function: cursor in declaring file → returned (sameFile fallback)', () => {
    // Top-level funs: isEnclosingClassVisible uses parentName = last-pkg-segment ('utils')
    // which is never in the index → visibleByImport=0 → falls to sameFile fallback.
    const idx = makeIndex(
      ['file:///util/Utils.kt', `package com.example.utils\nfun formatDate(): String = ""`],
    );
    const utilsCode = `package com.example.utils\nfun formatDate(): String = ""\nfun test() { formatDate() }`;
    // goToAt: URI must match the index entry so sameFile check fires
    const result = goToAt(provider(idx), 'file:///util/Utils.kt', utilsCode, 'formatDate', 2);
    expect(result).not.toBeNull();
  });

  it('top-level function: called from unrelated file with no import → null', () => {
    const idx = makeIndex(
      ['file:///util/Utils.kt', `package com.example.utils\nfun formatDate(): String = ""`],
    );
    const callerCode = `package com.example.other\nfun go() { formatDate() }`;
    // step1: samePackage → 'com.example.other.formatDate' not in index; no exact/wildcard import
    // step2: isEnclosingClassVisible → parentName='utils' → not resolvable → false
    //        sameFile = 0 (not in Utils.kt) → null
    expect(goTo(provider(idx), 'file:///other/Other.kt', callerCode, 'formatDate')).toBeNull();
  });

  // ── Group 6: symbol with no package (lastDot === -1) ────────────────────
  //
  // isEnclosingClassVisible has an early return `if (lastDot === -1) return true`.
  // This fires only when the symbol's own FQN has NO dot, i.e. it is a bare
  // top-level function in a file with no package declaration → FQN = just the name.
  //
  // Contrast with `class GlobalHelper { fun doIt() }` (no package) where FQN =
  // 'GlobalHelper.doIt' — the dot IS present so the guard does NOT fire.

  it('top-level function in no-package file → FQN has no dot → always visible', () => {
    // fun globalOp() with no package → FQN = 'globalOp' → lastDot = -1 → always visible
    const idx = makeIndex(
      ['file:///NoPackage.kt', `fun globalOp(): Int = 42`],
    );
    const callerCode = `package com.example\nfun use() { globalOp() }`;
    const result = goTo(provider(idx), 'file:///pkg/Caller.kt', callerCode, 'globalOp');
    // isEnclosingClassVisible('globalOp'): lastDot = -1 → return true immediately
    expect(result).not.toBeNull();
  });

  it('class member in no-package file → FQN HAS a dot → NOT caught by lastDot guard', () => {
    // class GlobalHelper { fun doIt() } → FQN = 'GlobalHelper.doIt' (has dot)
    // isEnclosingClassVisible: parentFqn='GlobalHelper', parentName='GlobalHelper'
    // resolveBest('GlobalHelper', callerDoc) → 'com.example.GlobalHelper' ≠ 'GlobalHelper' → false
    // → visibleByImport=0, sameFile=0 → null
    const idx = makeIndex(
      ['file:///NoPackage.kt', `class GlobalHelper {\n    fun doIt(): Int = 0\n}`],
    );
    const callerCode = `package com.example\nfun use() { GlobalHelper().doIt() }`;
    const result = goTo(provider(idx), 'file:///pkg/Caller.kt', callerCode, 'doIt');
    expect(result).toBeNull();
  });

  // ── Group 7: no false positive when library symbol matches workspace enum ──

  it('Compose LazyColumn vs workspace class named LazyColumn → null when not imported', () => {
    // A workspace team accidentally named their class 'LazyColumn'.
    // Caller uses the real Compose LazyColumn (imported from compose.foundation.lazy).
    const idx = makeIndex(
      ['file:///widget/LazyColumn.kt', `package com.example.widget\nclass LazyColumn`],
    );
    const callerCode = `package com.example.ui
import androidx.compose.foundation.lazy.LazyColumn
fun Screen() { LazyColumn { } }`;
    const result = goTo(provider(idx), 'file:///ui/Screen.kt', callerCode, 'LazyColumn', 2);
    // isEnclosingClassVisible: LazyColumn is a top-level class
    // parentFqn='com.example.widget', parentName='widget' → not in any import → false
    // sameFile=0 → null
    expect(result).toBeNull();
  });

  it('workspace LazyColumn in same package as caller → returns workspace version', () => {
    const idx = makeIndex(
      ['file:///ui/LazyColumn.kt', `package com.example.ui\nclass LazyColumn`],
    );
    const callerCode = `package com.example.ui
import androidx.compose.foundation.lazy.LazyColumn
fun Screen() { LazyColumn { } }`;
    // step1: exactCandidates('LazyColumn') → 'androidx.compose.foundation.lazy.LazyColumn' → not in index
    //        samePackageCandidates → 'com.example.ui.LazyColumn' → found in index! → resolves at step1
    const result = goTo(provider(idx), 'file:///ui/Screen.kt', callerCode, 'LazyColumn', 2);
    expect(result).not.toBeNull();
    expect((result as any).uri.path).toContain('LazyColumn.kt');
  });

  // ── Wildcard tiebreak ─────────────────────────────────────────────────────

  it('wildcard tiebreak: symbol in closer package wins over symbol in distant package', () => {
    const idx = makeIndex(
      ['file:///a/Loader.kt', `package com.example\nclass Loader`],
      ['file:///b/Loader.kt', `package com.other\nclass Loader`],
    );
    // Caller in com.example.ui; com.example shares 2 components, com.other shares 1
    const callerCode = `package com.example.ui\nimport com.example.*\nimport com.other.*\nfun use() { val l = Loader() }`;
    const result = goTo(provider(idx), 'file:///ui/Screen.kt', callerCode, 'Loader');
    expect(result).not.toBeNull();
    expect((result as any).uri?.path ?? '').toContain('/a/Loader.kt');
  });

  it('wildcard tiebreak: tie (both packages equidistant) → picker returned', () => {
    const idx = makeIndex(
      ['file:///x/Widget.kt', `package com.example.x\nclass Widget`],
      ['file:///y/Widget.kt', `package com.example.y\nclass Widget`],
    );
    // Both packages share 2 components with com.example.z → genuine tie → picker
    const callerCode = `package com.example.z\nimport com.example.x.*\nimport com.example.y.*\nfun use() { Widget() }`;
    const result = goTo(provider(idx), 'file:///z/Screen.kt', callerCode, 'Widget');
    expect(Array.isArray(result)).toBe(true);
    expect((result as any[]).length).toBe(2);
  });
});

// ── Regression: unindexed library symbols must not show unrelated results ────
//
// `colorResource` is imported from `androidx.compose.ui.res.colorResource` (a Compose
// library not in the workspace index). A `LoginEmailViewModel` in the workspace happens
// to have its own `colorResource` member. Clicking on `colorResource` in a Composable
// that has the Compose import must NOT show LoginEmailViewModel results.

describe('DefinitionProvider — no false positives for unindexed library symbols', () => {
  const URI_VM   = 'file:///login/LoginEmailViewModel.kt';
  const URI_WIDGET = 'file:///widget/WidgetCarousel.kt';

  // A ViewModel with a private `colorResource` delegate/property
  const CODE_VM = `package com.example.login
class LoginEmailViewModel {
    private val colorResource = context.resources.getColor(R.color.primary)
}`;

  // A Composable that imports colorResource from Compose (library, not in index)
  const CODE_WIDGET = `package com.example.widget
import androidx.compose.ui.res.colorResource

@Composable
fun WidgetCarousel() {
    val color = colorResource(R.color.background)
}`;

  let index: SymbolIndex;
  let provider: KotlinDefinitionProvider;

  beforeEach(() => {
    index = new SymbolIndex();
    index.add(parse(URI_VM, CODE_VM));
    // WidgetCarousel.kt is NOT added to index (simulating that colorResource only
    // appears as a usage, not a declaration — the Compose library is not indexed)
    provider = new KotlinDefinitionProvider(index);
  });

  it('colorResource in Composable with Compose import returns null (not VM results)', () => {
    const doc = mockDocument(URI_WIDGET, CODE_WIDGET);
    const result = provider.provideDefinition(doc, positionOf(CODE_WIDGET, 'colorResource', 2));
    // Must NOT return LoginEmailViewModel.colorResource
    expect(result).toBeNull();
  });

  it('indexed colorResource from same package IS returned correctly', () => {
    // When the caller IS in the same package as the declaring class, it should resolve
    const CODE_CALLER = `package com.example.login
class LoginUseCase {
    fun getColor() = LoginEmailViewModel().colorResource
}`;
    index.add(parse('file:///login/LoginUseCase.kt', CODE_CALLER));
    const doc = mockDocument('file:///login/LoginUseCase.kt', CODE_CALLER);
    // No index entry for `colorResource` as standalone — it's a member
    // The lookup finds LoginEmailViewModel.colorResource; same package → isEnclosingClassVisible=true
    const result = provider.provideDefinition(doc, positionOf(CODE_CALLER, 'colorResource'));
    // Should resolve (same-package visibility) rather than returning null
    expect(result).toBeDefined();
    expect(result).not.toBeNull();
  });

  it('two unrelated ViewModels with same-named member, caller imports Compose version → null', () => {
    const URI_VM2 = 'file:///profile/ProfileViewModel.kt';
    index.add(parse(URI_VM2, `package com.example.profile
class ProfileViewModel {
    private val colorResource = context.resources.getColor(R.color.accent)
}`));
    const doc = mockDocument(URI_WIDGET, CODE_WIDGET);
    const result = provider.provideDefinition(doc, positionOf(CODE_WIDGET, 'colorResource', 2));
    // With TWO unrelated VM entries for colorResource and an unmatched Compose import → null
    expect(result).toBeNull();
  });
});

// ── Regression: cross-file private symbols must not resolve ──────────────────
//
// Three workspace files each declare a top-level `private fun foo`. They are
// independent and must not navigate to each other.

describe('DefinitionProvider — cross-file private isolation', () => {
  const URI_A = 'file:///a/A.kt';
  const URI_B = 'file:///b/B.kt';
  const URI_C = 'file:///c/C.kt';
  const CODE_A = `package com.example.a
private fun helper(x: Int): Int = x + 1
fun callA() = helper(10)`;
  const CODE_B = `package com.example.b
private fun helper(x: Int): Int = x * 2
fun callB() = helper(20)`;
  const CODE_C = `package com.example.c
private fun helper(x: Int): Int = x * 10
fun callC() = helper(30)`;

  it('Cmd+Click on `helper` declaration in A returns A only — not B or C', () => {
    const idx = new SymbolIndex();
    idx.add(parse(URI_A, CODE_A));
    idx.add(parse(URI_B, CODE_B));
    idx.add(parse(URI_C, CODE_C));
    const provider = new KotlinDefinitionProvider(idx);
    const doc = mockDocument(URI_A, CODE_A);
    const result = provider.provideDefinition(doc, positionOf(CODE_A, 'helper', 1));
    // Either a single Location or an array; in both cases the URI must be A.
    const locs = Array.isArray(result) ? result : result ? [result] : [];
    expect(locs.length).toBe(1);
    expect((locs[0] as any).uri.toString()).toBe(URI_A);
  });

  it('Cmd+Click on the call `helper(10)` in A returns A — not B or C', () => {
    const idx = new SymbolIndex();
    idx.add(parse(URI_A, CODE_A));
    idx.add(parse(URI_B, CODE_B));
    idx.add(parse(URI_C, CODE_C));
    const provider = new KotlinDefinitionProvider(idx);
    const doc = mockDocument(URI_A, CODE_A);
    const result = provider.provideDefinition(doc, positionOf(CODE_A, 'helper', 2));
    const locs = Array.isArray(result) ? result : result ? [result] : [];
    expect(locs.length).toBe(1);
    expect((locs[0] as any).uri.toString()).toBe(URI_A);
  });
});
