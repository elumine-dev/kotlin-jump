import { describe, expect, it } from 'vitest';
import { parse } from '../../src/indexer/KotlinParser';
import { SymbolIndex } from '../../src/indexer/SymbolIndex';
import { analyzeDocument, lensTitle } from '../../src/providers/SealedWhenCoverageProvider';
import { buildMissingBranchEdit } from '../../src/commands/addMissingWhenBranches';
import { mockDocument } from './helpers';

function buildIndex(...files: Array<[string, string]>): SymbolIndex {
  const index = new SymbolIndex();
  for (const [uri, code] of files) index.add(parse(uri, code));
  index.finalize();
  return index;
}

const SEALED_OBJECTS = `package com.demo
sealed class CombatResult {
    object Victory : CombatResult()
    object Defeat  : CombatResult()
    object Draw    : CombatResult()
}
`;

const SEALED_MIXED = `package com.demo
sealed class LoadState {
    object Loading : LoadState()
    data class Success<T>(val data: T) : LoadState()
    data class Error(val message: String) : LoadState()
}
`;

function analyze(code: string, extraFiles: Array<[string, string]> = []) {
  const uri = 'file:///Main.kt';
  const index = buildIndex([uri, code], ...extraFiles);
  return analyzeDocument(mockDocument(uri, code), index);
}

describe('SealedWhenCoverage — happy paths', () => {
  it('exhaustive when over sealed objects → N/N, no missing', () => {
    const code = SEALED_OBJECTS + `
fun f(r: CombatResult) = when (r) {
    is CombatResult.Victory -> 1
    is CombatResult.Defeat -> 2
    is CombatResult.Draw -> 3
}
`;
    const [a] = analyze(code);
    expect(a).toBeDefined();
    expect(a.parent.name).toBe('CombatResult');
    expect(a.parentKind).toBe('sealed');
    expect(a.expected.map(e => e.name)).toEqual(['Victory', 'Defeat', 'Draw']);
    expect(a.missing).toEqual([]);
    expect(lensTitle(a)).toBe('✓ 3/3 branches');
  });

  it('data classes with generics (`Success<*>`) count as covered', () => {
    const code = SEALED_MIXED + `
fun f(s: LoadState) = when (s) {
    is LoadState.Loading -> 0
    is LoadState.Success<*> -> 1
    is LoadState.Error -> 2
}
`;
    const [a] = analyze(code);
    expect(a.missing).toEqual([]);
  });

  it('incomplete + else → informational title with exact names', () => {
    const code = SEALED_OBJECTS + `
fun f(r: CombatResult) = when (r) {
    is CombatResult.Victory -> 1
    is CombatResult.Defeat -> 2
    else -> 0
}
`;
    const [a] = analyze(code);
    expect(a.hasElse).toBe(true);
    expect(a.missing.map(e => e.name)).toEqual(['Draw']);
    expect(lensTitle(a)).toBe('✓ else covers 1 remaining: Draw');
    // insertion goes BEFORE the else line
    expect(a.insertLine).toBe(code.split('\n').findIndex(l => l.includes('else ->')));
  });

  it('incomplete without else → warning title, declaration order', () => {
    const code = SEALED_MIXED + `
fun f(s: LoadState) = when (s) {
    is LoadState.Loading -> 0
}
`;
    const [a] = analyze(code);
    expect(a.hasElse).toBe(false);
    expect(a.missing.map(e => e.name)).toEqual(['Success', 'Error']);
    expect(lensTitle(a)).toBe('⚠ 1/3 branches, missing: Success, Error');
    // insertion goes before the closing brace line
    expect(a.insertLine).toBe(code.split('\n').lastIndexOf('}'));
  });

  it('explicit imports allow unqualified branches', () => {
    const sealedFile = SEALED_OBJECTS;
    const code = `package com.app
import com.demo.CombatResult
import com.demo.CombatResult.Victory
import com.demo.CombatResult.Defeat
import com.demo.CombatResult.Draw

fun f(r: CombatResult) = when (r) {
    is Victory -> 1
    is Defeat -> 2
    is Draw -> 3
}
`;
    const uri = 'file:///App.kt';
    const index = buildIndex(['file:///Sealed.kt', sealedFile], [uri, code]);
    const [a] = analyzeDocument(mockDocument(uri, code), index);
    expect(a).toBeDefined();
    expect(a.missing).toEqual([]);
    expect(a.insertPrefix).toBe('');
  });

  it('import alias resolves (`import X as S; is S.Loading`)', () => {
    const sealedFile = `package com.demo
sealed interface UiState {
    object Loading : UiState
    data class Ready(val n: Int) : UiState
}
`;
    const code = `package com.app
import com.demo.UiState as S

fun f(s: S) = when (s) {
    is S.Loading -> 0
}
`;
    // Unique URI: ImportResolver caches per uri+version module-wide, so
    // reusing file:///App.kt from the previous test would leak its imports.
    const uri = 'file:///AppAlias.kt';
    const index = buildIndex(['file:///Sealed.kt', sealedFile], [uri, code]);
    const [a] = analyzeDocument(mockDocument(uri, code), index);
    expect(a).toBeDefined();
    expect(a.parent.name).toBe('UiState');
    expect(a.missing.map(e => e.name)).toEqual(['Ready']);
  });

  it('enum coverage: qualified entries, missing counted', () => {
    const code = `package com.demo
enum class Color { RED, GREEN, BLUE }

fun f(c: Color) = when (c) {
    Color.RED -> 1
    Color.GREEN -> 2
}
`;
    const [a] = analyze(code);
    expect(a).toBeDefined();
    expect(a.parentKind).toBe('enum');
    expect(a.expected.map(e => e.name)).toEqual(['RED', 'GREEN', 'BLUE']);
    expect(a.missing.map(e => e.name)).toEqual(['BLUE']);
    expect(lensTitle(a)).toBe('⚠ 2/3 branches, missing: BLUE');
  });

  it('enum with PascalCase entries (parser fix regression)', () => {
    const code = `package com.demo
enum class Screen { Home, Battle, Settings }

fun f(s: Screen) = when (s) {
    Screen.Home -> 1
    Screen.Battle -> 2
    Screen.Settings -> 3
}
`;
    const [a] = analyze(code);
    expect(a).toBeDefined();
    expect(a.expected.map(e => e.name)).toEqual(['Home', 'Battle', 'Settings']);
    expect(a.missing).toEqual([]);
  });

  it('nested sealed: inner parent resolved through supertypes', () => {
    const code = `package com.demo
sealed class Nav {
    sealed class Home : Nav() {
        object Feed : Home()
        object Profile : Home()
    }
    object Settings : Nav()
}

fun f(h: Nav.Home) = when (h) {
    is Nav.Home.Feed -> 1
}
`;
    const [a] = analyze(code);
    expect(a).toBeDefined();
    expect(a.parent.name).toBe('Home');
    expect(a.missing.map(e => e.name)).toEqual(['Profile']);
  });

  it('top-level when over nested sealed counts direct subtypes only', () => {
    const code = `package com.demo
sealed class Nav {
    sealed class Home : Nav() {
        object Feed : Home()
    }
    sealed class Battle : Nav() {
        object Setup : Battle()
    }
    object Settings : Nav()
}

fun f(n: Nav) = when (n) {
    is Nav.Home -> 1
    is Nav.Battle -> 2
    is Nav.Settings -> 3
}
`;
    const [a] = analyze(code);
    expect(a).toBeDefined();
    expect(a.expected.map(e => e.name)).toEqual(['Home', 'Battle', 'Settings']);
    expect(a.missing).toEqual([]);
  });

  it('data object subtype is recognized (Kotlin 1.9 idiom)', () => {
    const code = `package com.demo
sealed interface UiState {
    data object Loading : UiState
    data class Ready(val n: Int) : UiState
}

fun f(s: UiState) = when (s) {
    is UiState.Ready -> 1
}
`;
    const [a] = analyze(code);
    expect(a).toBeDefined();
    expect(a.missing.map(e => e.name)).toEqual(['Loading']);
    expect(a.missing[0].kind).toBe('object');
  });
});

describe('buildMissingBranchEdit', () => {
  it('emits `is ` for data classes, bare for objects, mirroring qualification', () => {
    const code = SEALED_MIXED + `
fun f(s: LoadState) = when (s) {
    is LoadState.Loading -> 0
}
`;
    const [a] = analyze(code);
    const edit = buildMissingBranchEdit(a);
    expect(edit.text).toBe(
      '    is LoadState.Success -> TODO()\n' +
      '    is LoadState.Error -> TODO()\n',
    );
    expect(edit.insertAt.line).toBe(a.insertLine);
    expect(edit.insertAt.character).toBe(0);
  });

  it('emits bare object branches without `is `', () => {
    const code = SEALED_OBJECTS + `
fun f(r: CombatResult) = when (r) {
    is CombatResult.Victory -> 1
}
`;
    const [a] = analyze(code);
    const edit = buildMissingBranchEdit(a);
    expect(edit.text).toBe(
      '    CombatResult.Defeat -> TODO()\n' +
      '    CombatResult.Draw -> TODO()\n',
    );
  });

  it('emits bare enum entries with the file qualification style', () => {
    const code = `package com.demo
enum class Color { RED, GREEN, BLUE }

fun f(c: Color) = when (c) {
    Color.RED -> 1
}
`;
    const [a] = analyze(code);
    const edit = buildMissingBranchEdit(a);
    expect(edit.text).toBe(
      '    Color.GREEN -> TODO()\n' +
      '    Color.BLUE -> TODO()\n',
    );
  });

  it('copies non-default indentation', () => {
    const code = SEALED_OBJECTS + `
fun f(r: CombatResult) = when (r) {
        is CombatResult.Victory -> 1
}
`;
    const [a] = analyze(code);
    const edit = buildMissingBranchEdit(a);
    expect(edit.text.startsWith('        CombatResult.Defeat')).toBe(true);
  });
});
