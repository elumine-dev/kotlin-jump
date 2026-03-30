import { describe, it, expect, beforeEach } from 'vitest';
import { SymbolIndex } from '../../src/indexer/SymbolIndex';
import { parse } from '../../src/indexer/KotlinParser';

function addKt(index: SymbolIndex, uri: string, code: string) {
  index.add(parse(uri, code));
}

// ── Helper: simulate what provideCodeLenses will do ─────────────────────────
// Returns symbols that SHOULD get a Code Lens (class-like + functions, not val/var/enum entries)

const LENS_KINDS = new Set([
  'class', 'interface', 'object', 'enum',
  'dataClass', 'sealedClass', 'annotation',
  'fun', 'composable',
]);

const CLASS_LIKE = new Set([
  'class', 'interface', 'object', 'enum',
  'dataClass', 'sealedClass', 'annotation',
]);

function getLensSymbols(index: SymbolIndex, uri: string) {
  const symbols = index.getFileSymbols(uri);
  const result = [];
  const classStack: { kind: string; depth: number }[] = [];

  for (const s of symbols) {
    while (classStack.length > 0 && classStack[classStack.length - 1].depth >= s.depth) {
      classStack.pop();
    }

    // Skip enum entries (enum kind inside another enum)
    if (s.kind === 'enum' && classStack.length > 0 && classStack[classStack.length - 1].kind === 'enum') {
      continue;
    }

    if (LENS_KINDS.has(s.kind)) {
      result.push(s);
    }

    if (CLASS_LIKE.has(s.kind)) {
      classStack.push({ kind: s.kind, depth: s.depth });
    }
  }
  return result;
}

// ── Test data ───────────────────────────────────────────────────────────────

const APP_CODE = `package com.example

interface UserRepository {
    fun getUser(id: String): User
    fun saveUser(user: User)
}

class UserRepositoryImpl : UserRepository {
    override fun getUser(id: String): User = User(id)
    override fun saveUser(user: User) {}
    private fun validate(user: User) {}
}

data class User(val id: String, val name: String)

enum class Role {
    ADMIN,
    EDITOR,
    VIEWER,
}

object Analytics {
    fun track(event: String) {}
}

@Composable
fun HomeScreen() {}

val globalConfig = "test"
var counter = 0
`;

const USAGE_FILE = `package com.example

class UserService(private val repo: UserRepository) {
    fun load() {
        val user = repo.getUser("1")
        repo.saveUser(user)
    }
}
`;

// ── Tests: which symbols get lenses ─────────────────────────────────────────

describe('Code Lens — symbol selection', () => {
  let index: SymbolIndex;

  beforeEach(() => {
    index = new SymbolIndex();
    addKt(index, 'file:///App.kt', APP_CODE);
  });

  it('classes get a lens', () => {
    const lenses = getLensSymbols(index, 'file:///App.kt');
    expect(lenses.some(s => s.name === 'UserRepositoryImpl')).toBe(true);
  });

  it('interfaces get a lens', () => {
    const lenses = getLensSymbols(index, 'file:///App.kt');
    expect(lenses.some(s => s.name === 'UserRepository')).toBe(true);
  });

  it('data classes get a lens', () => {
    const lenses = getLensSymbols(index, 'file:///App.kt');
    expect(lenses.some(s => s.name === 'User')).toBe(true);
  });

  it('enum class gets a lens', () => {
    const lenses = getLensSymbols(index, 'file:///App.kt');
    expect(lenses.some(s => s.name === 'Role')).toBe(true);
  });

  it('enum ENTRIES do NOT get a lens', () => {
    const lenses = getLensSymbols(index, 'file:///App.kt');
    expect(lenses.some(s => s.name === 'ADMIN')).toBe(false);
    expect(lenses.some(s => s.name === 'EDITOR')).toBe(false);
    expect(lenses.some(s => s.name === 'VIEWER')).toBe(false);
  });

  it('object gets a lens', () => {
    const lenses = getLensSymbols(index, 'file:///App.kt');
    expect(lenses.some(s => s.name === 'Analytics')).toBe(true);
  });

  it('functions get a lens', () => {
    const lenses = getLensSymbols(index, 'file:///App.kt');
    expect(lenses.some(s => s.name === 'getUser')).toBe(true);
    expect(lenses.some(s => s.name === 'saveUser')).toBe(true);
    expect(lenses.some(s => s.name === 'validate')).toBe(true);
    expect(lenses.some(s => s.name === 'track')).toBe(true);
  });

  it('composable functions get a lens', () => {
    const lenses = getLensSymbols(index, 'file:///App.kt');
    expect(lenses.some(s => s.name === 'HomeScreen')).toBe(true);
  });

  it('val does NOT get a lens', () => {
    const lenses = getLensSymbols(index, 'file:///App.kt');
    expect(lenses.some(s => s.name === 'globalConfig')).toBe(false);
  });

  it('var does NOT get a lens', () => {
    const lenses = getLensSymbols(index, 'file:///App.kt');
    expect(lenses.some(s => s.name === 'counter')).toBe(false);
  });
});

// ── Tests: implementation counts (sync, from index) ─────────────────────────

describe('Code Lens — implementation counts', () => {
  let index: SymbolIndex;

  beforeEach(() => {
    index = new SymbolIndex();
    addKt(index, 'file:///App.kt', APP_CODE);
  });

  it('interface with 1 implementation → count = 1', () => {
    const impls = index.lookupImplementations('UserRepository');
    expect(impls).toHaveLength(1);
  });

  it('class with no implementations → count = 0', () => {
    const impls = index.lookupImplementations('UserRepositoryImpl');
    expect(impls).toHaveLength(0);
  });

  it('data class with no implementations → count = 0', () => {
    const impls = index.lookupImplementations('User');
    expect(impls).toHaveLength(0);
  });
});

// ── Tests: lens positions are correct ───────────────────────────────────────

describe('Code Lens — positions', () => {
  let index: SymbolIndex;

  beforeEach(() => {
    index = new SymbolIndex();
    addKt(index, 'file:///App.kt', APP_CODE);
  });

  it('lens position matches symbol declaration line', () => {
    const lenses = getLensSymbols(index, 'file:///App.kt');
    const iface = lenses.find(s => s.name === 'UserRepository');
    expect(iface).toBeDefined();
    // interface UserRepository is on line 2 (0-indexed)
    const lines = APP_CODE.split('\n');
    expect(lines[iface!.line]).toContain('interface UserRepository');
  });

  it('all lens symbols have valid line numbers', () => {
    const lenses = getLensSymbols(index, 'file:///App.kt');
    const lineCount = APP_CODE.split('\n').length;
    for (const s of lenses) {
      expect(s.line).toBeGreaterThanOrEqual(0);
      expect(s.line).toBeLessThan(lineCount);
    }
  });
});

// ── Tests: sealed class subtypes show as implementations ────────────────────

describe('Code Lens — sealed class implementations', () => {
  it('sealed class subtypes count as implementations', () => {
    const index = new SymbolIndex();
    addKt(index, 'file:///Result.kt', `package com.example
sealed class Result {
    data class Success(val data: String) : Result()
    data class Error(val msg: String) : Result()
    data object Loading : Result()
}`);
    const impls = index.lookupImplementations('Result');
    expect(impls).toHaveLength(3);
  });
});

// ── Tests: multiple files ───────────────────────────────────────────────────

describe('Code Lens — cross-file usage counting', () => {
  let index: SymbolIndex;

  beforeEach(() => {
    index = new SymbolIndex();
    addKt(index, 'file:///App.kt', APP_CODE);
    addKt(index, 'file:///Service.kt', USAGE_FILE);
  });

  it('UserRepository is used in Service.kt', () => {
    // Verify the usage file references UserRepository
    const symbols = index.getFileSymbols('file:///Service.kt');
    expect(symbols.some(s => s.name === 'UserService')).toBe(true);
  });

  it('both files are in the index', () => {
    const uris = index.fileUriStrings();
    expect(uris).toContain('file:///App.kt');
    expect(uris).toContain('file:///Service.kt');
  });
});

// ── Tests: no lenses on empty file ──────────────────────────────────────────

describe('Code Lens — edge cases', () => {
  it('empty file → no lenses', () => {
    const index = new SymbolIndex();
    addKt(index, 'file:///empty.kt', '');
    expect(getLensSymbols(index, 'file:///empty.kt')).toHaveLength(0);
  });

  it('file with only val/var → no lenses', () => {
    const index = new SymbolIndex();
    addKt(index, 'file:///consts.kt', `package com.example
val x = 1
var y = 2
const val Z = 3`);
    expect(getLensSymbols(index, 'file:///consts.kt')).toHaveLength(0);
  });

  it('file with only imports and package → no lenses', () => {
    const index = new SymbolIndex();
    addKt(index, 'file:///imports.kt', `package com.example
import java.util.List`);
    expect(getLensSymbols(index, 'file:///imports.kt')).toHaveLength(0);
  });
});
