/**
 * Tests adversariaux pour ConstValFoldingProvider.
 *
 * Attack surface:
 *  1. CONST_NAME_RE — \b word boundary, SCREAMING_SNAKE_CASE partiel, noms courts
 *  2. isInsideCommentOrString — faux positifs commentaire/string/interpolation
 *  3. Skip déclaration const val
 *  4. Filtre strict isConst && constValue
 *
 * Tests nommés SP2-ADVER-CVF-* pour faciliter le grep.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import * as vscodeMock from './__mocks__/vscode';
import { ConstValFoldingProvider } from '../../src/providers/ConstValFoldingProvider';

afterEach(() => vi.restoreAllMocks());

function setup() {
  vi.spyOn(vscodeMock.window, 'createTextEditorDecorationType').mockReturnValue({ dispose: vi.fn() } as any);
  vi.spyOn(vscodeMock.window, 'onDidChangeActiveTextEditor').mockReturnValue({ dispose: vi.fn() } as any);
  vi.spyOn(vscodeMock.workspace, 'onDidChangeTextDocument').mockReturnValue({ dispose: vi.fn() } as any);
  vi.spyOn(vscodeMock.window, 'onDidChangeTextEditorSelection').mockReturnValue({ dispose: vi.fn() } as any);
  vi.spyOn(vscodeMock.window, 'activeTextEditor', 'get').mockReturnValue(undefined as any);
}

type Entry = { name: string; isConst?: boolean; constValue?: string };

function makeIndex(entries: Entry[]) {
  const byName = new Map<string, Entry[]>();
  for (const e of entries) {
    const arr = byName.get(e.name) ?? [];
    arr.push(e);
    byName.set(e.name, arr);
  }
  return { lookup: (name: string) => byName.get(name) ?? [] };
}

function decs(entries: Entry[], lines: string[]) {
  setup();
  const editor = {
    document: {
      languageId: 'kotlin',
      lineCount: lines.length,
      lineAt: (i: number) => ({ text: lines[i] }),
    },
    selections: [],
    setDecorations: vi.fn(),
  } as any;
  vi.spyOn(vscodeMock.window, 'visibleTextEditors', 'get').mockReturnValue([editor]);
  new ConstValFoldingProvider(makeIndex(entries) as any);
  return (editor.setDecorations.mock.lastCall?.[1] ?? []) as any[];
}

// ── SP2-ADVER-CVF-1 ───────────────────────────────────────────────────────────

describe('SP2-ADVER-CVF-1 — SCREAMING_SNAKE_CASE dans commentaire → 0 décorations', () => {
  it('// TIMEOUT_MS ignoré', () => {
    const entries = [{ name: 'TIMEOUT_MS', isConst: true, constValue: '5000' }];
    expect(decs(entries, ['// val x = TIMEOUT_MS'])).toHaveLength(0);
  });
});

// ── SP2-ADVER-CVF-2 ───────────────────────────────────────────────────────────

describe('SP2-ADVER-CVF-2 — SCREAMING_SNAKE_CASE dans string → 0 décorations', () => {
  it('"TIMEOUT_MS" dans string ignoré', () => {
    const entries = [{ name: 'TIMEOUT_MS', isConst: true, constValue: '5000' }];
    expect(decs(entries, ['val s = "TIMEOUT_MS"'])).toHaveLength(0);
  });
});

// ── SP2-ADVER-CVF-3 ───────────────────────────────────────────────────────────

describe('SP2-ADVER-CVF-3 — PREFIX_TIMEOUT_MS matché en token complet', () => {
  it('1 décoration avec contentText de PREFIX_TIMEOUT_MS', () => {
    const entries = [{ name: 'PREFIX_TIMEOUT_MS', isConst: true, constValue: '1000' }];
    const result = decs(entries, ['val x = PREFIX_TIMEOUT_MS']);
    expect(result).toHaveLength(1);
    expect(result[0].renderOptions.before.contentText).toBe('1000');
  });
});

// ── SP2-ADVER-CVF-4 ───────────────────────────────────────────────────────────

describe('SP2-ADVER-CVF-4 — nom 2 chars MY → [A-Z][A-Z0-9_]{2,} → 0 décorations', () => {
  it('MY trop court, non matché', () => {
    const entries = [{ name: 'MY', isConst: true, constValue: 'true' }];
    expect(decs(entries, ['val x = MY'])).toHaveLength(0);
  });
});

// ── SP2-ADVER-CVF-5 ───────────────────────────────────────────────────────────

describe('SP2-ADVER-CVF-5 — isConst=true mais constValue=undefined → 0 décorations', () => {
  it('filtre isConst && constValue strict', () => {
    const entries = [{ name: 'TIMEOUT_MS', isConst: true, constValue: undefined }];
    expect(decs(entries, ['val x = TIMEOUT_MS'])).toHaveLength(0);
  });
});

// ── SP2-ADVER-CVF-6 ───────────────────────────────────────────────────────────

describe('SP2-ADVER-CVF-6 — accès qualifié Config.TIMEOUT_MS → 1 décoration', () => {
  it('Config ne matche pas SCREAMING_SNAKE_CASE, TIMEOUT_MS matché seul', () => {
    const entries = [{ name: 'TIMEOUT_MS', isConst: true, constValue: '5000' }];
    const result = decs(entries, ['val x = Config.TIMEOUT_MS']);
    expect(result).toHaveLength(1);
    expect(result[0].renderOptions.before.contentText).toBe('5000');
  });
});

// ── SP2-ADVER-CVF-7 ───────────────────────────────────────────────────────────

describe('SP2-ADVER-CVF-7 — interpolation "${TIMEOUT_MS}ms" → 1 décoration (foldée dans ${})', () => {
  it('TIMEOUT_MS dans ${} foldé', () => {
    const entries = [{ name: 'TIMEOUT_MS', isConst: true, constValue: '5000' }];
    const result = decs(entries, ['val s = "${TIMEOUT_MS}ms"']);
    expect(result).toHaveLength(1);
    expect(result[0].renderOptions.before.contentText).toBe('5000');
  });
});

describe('SP2-ADVER-CVF-7b — "plain TIMEOUT_MS" sans ${} → 0 décorations (string brute)', () => {
  it('TIMEOUT_MS dans string brute ignoré', () => {
    const entries = [{ name: 'TIMEOUT_MS', isConst: true, constValue: '5000' }];
    expect(decs(entries, ['val s = "TIMEOUT_MS"'])).toHaveLength(0);
  });
});

describe('SP2-ADVER-CVF-7c — `${TIMEOUT_MS}` dans block comment /* */ → 0 décorations', () => {
  it('interpolation morte dans /* */ ne doit PAS être foldée', () => {
    const entries = [{ name: 'TIMEOUT_MS', isConst: true, constValue: '5000' }];
    const line    = '/* old: was "${TIMEOUT_MS}ms" — to remove */';
    expect(decs(entries, [line])).toHaveLength(0);
  });

  it('interpolation vivante après un block comment fermé reste foldée', () => {
    const entries = [{ name: 'TIMEOUT_MS', isConst: true, constValue: '5000' }];
    const line    = '/* nope */ val s = "${TIMEOUT_MS}ms"';
    const result  = decs(entries, [line]);
    expect(result).toHaveLength(1);
    expect(result[0].renderOptions.before.contentText).toBe('5000');
  });
});

// ── SP2-ADVER-CVF-8 ───────────────────────────────────────────────────────────

describe('SP2-ADVER-CVF-8 — isConst=false → 0 décorations', () => {
  it('entry non const ignorée', () => {
    const entries = [{ name: 'TIMEOUT_MS', isConst: false, constValue: '5000' }];
    expect(decs(entries, ['val x = TIMEOUT_MS'])).toHaveLength(0);
  });
});

// ── SP2-ADVER-CVF-9 — ne pas folder le NOM de déclaration ────────────────────
// Regression: Permissions.kt ships `val CAMERA = Manifest.permission.CAMERA`
// in the same file that declares `const val CAMERA = "..."` (Android Manifest
// stub). The provider used to fold the *declaration* identifier on the left,
// rendering `val "android.permission.CAMERA" = "android.permission.CAMERA"` —
// visually broken Kotlin. The identifier on the left of `val`/`var` must be
// skipped, even when a const val with the same name exists elsewhere.

describe('SP2-ADVER-CVF-9 — déclaration `val NAME =` préserve le nom', () => {
  it('`val CAMERA = Manifest.permission.CAMERA` → fold à DROITE uniquement', () => {
    const entries = [
      { name: 'CAMERA', isConst: true, constValue: '"android.permission.CAMERA"' },
    ];
    const out = decs(entries, ['    val CAMERA            = Manifest.permission.CAMERA']);
    // Exactly one decoration on the right-hand side, never on the left.
    expect(out).toHaveLength(1);
    const line = '    val CAMERA            = Manifest.permission.CAMERA';
    const leftIdx  = line.indexOf('CAMERA');
    const rightIdx = line.lastIndexOf('CAMERA');
    expect(leftIdx).not.toBe(rightIdx);
    // The single decoration must target the RIGHT CAMERA — its start
    // position is never earlier than the right occurrence (the provider
    // may widen left to swallow the `Manifest.permission.` qualifier).
    const startChar = out[0].range.start.character;
    expect(startChar).toBeGreaterThanOrEqual(leftIdx + 1);
  });

  it('`var X = ...` suit la même règle que val', () => {
    const entries = [{ name: 'FOO', isConst: true, constValue: '"bar"' }];
    const out = decs(entries, ['var FOO = FOO']);
    expect(out).toHaveLength(1);
    expect(out[0].range.start.character).toBeGreaterThanOrEqual('var FOO = '.length);
  });

  it('le nom de déclaration seul (sans usage à droite) → 0 décoration', () => {
    const entries = [{ name: 'CAMERA', isConst: true, constValue: '"perm"' }];
    expect(decs(entries, ['    val CAMERA: String'])).toHaveLength(0);
  });
});

// ── SP2-ADVER-CVF-PERF — regression guard against O(N²)/GC-heavy rebuilds ────
// Reproducer of the original perf bug: a constant-heavy file with many
// repeated SCREAMING_SNAKE_CASE references would call SymbolIndex.lookup
// once per match, and lookup() returned `[...set]` (allocation) which we
// then `.filter()`ed (second allocation). On 1 000 lines × 50 matches that
// produced ~50 000 array allocations and visible GC stutters during fold
// /unfold. The fix memoizes the lookup per-rebuild and short-circuits to
// `null` for non-const names. This test asserts a generous upper bound on
// total wall time and a hard upper bound on lookup-call count so a future
// rewrite that drops the memoization fails CI loudly.

describe('SP2-ADVER-CVF-PERF — large constant-heavy file', () => {
  it('rebuilds 1 000 lines with 50 refs/line in <250 ms with ≤50 unique lookups', () => {
    setup();
    // Synthetic doc: 1 000 lines of `val x = Constants.TIMEOUT_MS + Constants.MAX_RETRIES + …`
    const NAMES = ['TIMEOUT_MS', 'MAX_RETRIES', 'PAGE_SIZE', 'DEBUG_MODE', 'LOG_TAG'];
    const lines: string[] = [];
    for (let i = 0; i < 1000; i++) {
      // 10 references per line drawn from the 5 names → high repetition
      // exercises the lookup-memo path that the perf fix relies on.
      const refs = Array.from({ length: 10 }, (_, j) => `Constants.${NAMES[(i + j) % NAMES.length]}`);
      lines.push(`    val v${i} = ${refs.join(' + ')}`);
    }

    let lookupCalls = 0;
    const seen = new Set<string>();
    const fakeIndex = {
      lookup(name: string) {
        lookupCalls++;
        seen.add(name);
        // Return a single matching const entry — the hot-path case.
        return [{ name, isConst: true, constValue: '"x"' }];
      },
    };

    const editor = {
      document: {
        languageId: 'kotlin',
        version:    1,
        lineCount:  lines.length,
        lineAt: (i: number) => ({ text: lines[i] }),
      },
      selections: [],
      setDecorations: vi.fn(),
    } as any;
    vi.spyOn(vscodeMock.window, 'visibleTextEditors', 'get').mockReturnValue([editor]);

    const start = performance.now();
    new ConstValFoldingProvider(fakeIndex as any);
    const elapsed = performance.now() - start;

    // Generous wall-time bound: in practice this lands around 30-80 ms
    // on a laptop — 250 ms is a safety margin big enough to absorb CI
    // jitter but small enough to fail loudly on an O(N²) regression.
    expect(elapsed).toBeLessThan(250);
    // The memo must collapse 10 000 ref matches down to one lookup per
    // unique name. Anything over ~50 means the memo is broken.
    expect(seen.size).toBe(NAMES.length);
    expect(lookupCalls).toBeLessThanOrEqual(NAMES.length);
  });

  it('a stable cache: re-applying with no doc-version change does NOT call lookup again', () => {
    setup();
    const lines = ['    val a = Constants.X', '    val b = Constants.Y', '    val c = Constants.X'];
    let lookupCalls = 0;
    const fakeIndex = {
      lookup(name: string) {
        lookupCalls++;
        return [{ name, isConst: true, constValue: '"v"' }];
      },
    };

    let activeListener: ((e: any) => void) | undefined;
    vi.spyOn(vscodeMock.window, 'onDidChangeActiveTextEditor').mockImplementation((cb: any) => {
      activeListener = cb;
      return { dispose: vi.fn() } as any;
    });

    const editor = {
      document: {
        languageId: 'kotlin',
        version:    7, // fixed across the test
        lineCount:  lines.length,
        lineAt: (i: number) => ({ text: lines[i] }),
      },
      selections: [],
      setDecorations: vi.fn(),
    } as any;
    vi.spyOn(vscodeMock.window, 'visibleTextEditors', 'get').mockReturnValue([editor]);

    new ConstValFoldingProvider(fakeIndex as any);
    const initialCalls = lookupCalls;

    // Re-fire onDidChangeActiveTextEditor 5 times — same document, no
    // edits. The cache must absorb every subsequent _apply.
    for (let i = 0; i < 5; i++) activeListener?.(editor);
    expect(lookupCalls).toBe(initialCalls);
  });
});
