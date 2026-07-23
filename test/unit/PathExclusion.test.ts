/**
 * makeExclusionMatcher + FileWatcher build/ filtering
 *
 * Le scan initial exclut build/ et .gradle/ ; les watchers, eux, réagissaient
 * à TOUT. Un build Gradle régénère des centaines de .kt sous build/generated/
 * → tempête de réindexation, exactement quand le git de VS Code s'agite.
 *
 * PE-1  Les patterns par défaut matchent build/ et .gradle/
 * PE-2  Le code source normal n'est pas exclu
 * PE-3  Liste vide → rien n'est exclu
 * PE-4  FileWatcher : un event sous build/ n'entre jamais dans le batch
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as vscode from 'vscode';
import { makeExclusionMatcher } from '../../src/util/pathExclusion';
import { FileWatcher } from '../../src/watcher/FileWatcher';
import { SymbolIndex } from '../../src/indexer/SymbolIndex';

const DEFAULTS = ['**/build/**', '**/.gradle/**'];

describe('PE-1/2/3 — matcher', () => {
  const m = makeExclusionMatcher(DEFAULTS);
  it('PE-1 — build/ et .gradle/ exclus', () => {
    expect(m('/proj/app/build/generated/source/BuildConfig.java')).toBe(true);
    expect(m('/proj/app/build/tmp/kotlin/Foo.kt')).toBe(true);
    expect(m('/proj/.gradle/8.0/fileHashes/x.kt')).toBe(true);
  });
  it('PE-2 — source normal non exclu', () => {
    expect(m('/proj/app/src/main/kotlin/com/example/Repo.kt')).toBe(false);
    expect(m('/proj/buildSrc/src/main/kotlin/Plugin.kt')).toBe(false); // "buildSrc" ≠ "build"
  });
  it('PE-3 — liste vide', () => {
    const none = makeExclusionMatcher([]);
    expect(none('/proj/app/build/x.kt')).toBe(false);
  });
});

describe('PE-4 — FileWatcher filtre build/', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('un .kt sous build/ n\'est jamais scanné', async () => {
    const scanned: string[] = [];
    const scanner = { scanFile: vi.fn(async (u: vscode.Uri) => { scanned.push(u.toString()); }) } as any;
    const w = new FileWatcher(scanner, new SymbolIndex(), undefined, undefined, undefined,
      makeExclusionMatcher(DEFAULTS));

    (w as any).queue(vscode.Uri.parse('file:///proj/app/build/generated/Gen.kt'));
    (w as any).queue(vscode.Uri.parse('file:///proj/app/src/main/kotlin/Real.kt'));
    for (let i = 0; i < 10; i++) await vi.advanceTimersByTimeAsync(200);

    expect(scanned).toEqual(['file:///proj/app/src/main/kotlin/Real.kt']);
    w.dispose();
  });
});
