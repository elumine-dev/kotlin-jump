/**
 * Tests pour SuspendMarkerProvider — hints ⚡, skip déclarations, raw strings.
 *
 * Attack surface:
 *  1. CALL_RE — lowercase start [a-z], word boundary
 *  2. Skip déclarations suspend fun
 *  3. isInsideCommentOrString — faux positifs string/commentaire
 *  4. countTripleQuotes — raw string multi-lignes (inRaw guard)
 *  5. paddingRight=true sur chaque hint
 *  6. Setting suspendCallMarkers: false → 0 hints
 *  7. languageId != kotlin/java → 0 hints
 *
 * Tests nommés SP2-SMP-* pour faciliter le grep.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import * as vscodeMock from './__mocks__/vscode';
import { SuspendMarkerProvider } from '../../src/providers/SuspendMarkerProvider';

afterEach(() => vi.restoreAllMocks());

type Entry = { name: string; isSuspend?: boolean };

function makeIndex(entries: Entry[]) {
  const byName = new Map<string, Entry[]>();
  for (const e of entries) {
    const arr = byName.get(e.name) ?? [];
    arr.push(e);
    byName.set(e.name, arr);
  }
  return { lookup: (name: string) => byName.get(name) ?? [] };
}

function setupConfig(enabled: boolean) {
  vi.spyOn(vscodeMock.workspace, 'getConfiguration').mockReturnValue({
    get: (key: string, def: any) => key === 'suspendCallMarkers' ? enabled : def,
  } as any);
}

function makeDoc(lines: string[], lang = 'kotlin') {
  return {
    languageId: lang,
    lineCount: lines.length,
    lineAt: (i: number) => ({ text: lines[i] }),
    fileName: 'file.kt',
  } as any;
}

function hints(entries: Entry[], lines: string[], lang = 'kotlin', enabled = true) {
  setupConfig(enabled);
  const provider = new SuspendMarkerProvider(makeIndex(entries) as any);
  const doc = makeDoc(lines, lang);
  const range = new vscodeMock.Range(0, 0, lines.length - 1, 0);
  return provider.provideInlayHints(doc, range);
}

// ── SP2-SMP-1 ─────────────────────────────────────────────────────────────────

describe('SP2-SMP-1 — appel suspend → 1 hint ⚡', () => {
  it('fetchData() avec isSuspend=true → 1 hint', () => {
    const result = hints([{ name: 'fetchData', isSuspend: true }], ['fetchData()']);
    expect(result).toHaveLength(1);
    expect(result[0].label).toBe('⚡');
  });
});

// ── SP2-SMP-2 ─────────────────────────────────────────────────────────────────

describe('SP2-SMP-2 — appel non-suspend → 0 hints', () => {
  it('fetchData() avec isSuspend=false → 0 hints', () => {
    const result = hints([{ name: 'fetchData', isSuspend: false }], ['fetchData()']);
    expect(result).toHaveLength(0);
  });
});

// ── SP2-SMP-3 ─────────────────────────────────────────────────────────────────

describe('SP2-SMP-3 — ligne de déclaration suspend fun → 0 hints', () => {
  it('suspend fun fetchData() skippé', () => {
    const result = hints([{ name: 'fetchData', isSuspend: true }], ['suspend fun fetchData()']);
    expect(result).toHaveLength(0);
  });
});

// ── SP2-SMP-4 ─────────────────────────────────────────────────────────────────

describe('SP2-SMP-4 — appel dans string → 0 hints', () => {
  it('"fetchData()" ignoré', () => {
    const result = hints([{ name: 'fetchData', isSuspend: true }], ['val s = "fetchData()"']);
    expect(result).toHaveLength(0);
  });
});

// ── SP2-SMP-5 ─────────────────────────────────────────────────────────────────

describe('SP2-SMP-5 — appel dans commentaire → 0 hints', () => {
  it('// fetchData() ignoré', () => {
    const result = hints([{ name: 'fetchData', isSuspend: true }], ['// fetchData()']);
    expect(result).toHaveLength(0);
  });
});

// ── SP2-SMP-6 ─────────────────────────────────────────────────────────────────

describe('SP2-SMP-6 — nom commençant par majuscule → 0 hints', () => {
  it('FetchData() non matché par CALL_RE [a-z]', () => {
    const result = hints([{ name: 'FetchData', isSuspend: true }], ['FetchData()']);
    expect(result).toHaveLength(0);
  });
});

// ── SP2-SMP-7 ─────────────────────────────────────────────────────────────────

describe('SP2-SMP-7 — appel dans raw string single-line → 0 hints', () => {
  it('""" fetchData() """ ignoré (isInsideCommentOrString détecte string)', () => {
    const result = hints([{ name: 'fetchData', isSuspend: true }], ['""" fetchData() """']);
    expect(result).toHaveLength(0);
  });
});

// ── SP2-SMP-8 ─────────────────────────────────────────────────────────────────

describe('SP2-SMP-8 — raw string multi-lignes : code après fermant → hints corrects', () => {
  it('fetchData() dans raw skippé, fetchData() après raw → 1 hint', () => {
    const lines = ['"""', 'fetchData()', '"""', 'fetchData()'];
    const result = hints([{ name: 'fetchData', isSuspend: true }], lines);
    expect(result).toHaveLength(1);
    expect(result[0].position.line).toBe(3);
  });
});

// ── SP2-SMP-9 ─────────────────────────────────────────────────────────────────

describe('SP2-SMP-9 — suspendCallMarkers: false → 0 hints', () => {
  it('feature désactivée par défaut', () => {
    const result = hints([{ name: 'fetchData', isSuspend: true }], ['fetchData()'], 'kotlin', false);
    expect(result).toHaveLength(0);
  });
});

// ── SP2-SMP-10 ────────────────────────────────────────────────────────────────

describe('SP2-SMP-10 — fichier XML → 0 hints', () => {
  it('languageId xml ignoré', () => {
    const result = hints([{ name: 'fetchData', isSuspend: true }], ['fetchData()'], 'xml');
    expect(result).toHaveLength(0);
  });
});

// ── SP2-SMP-11 ────────────────────────────────────────────────────────────────

describe('SP2-SMP-11 — paddingRight=true sur chaque hint', () => {
  it('hint.paddingRight === true', () => {
    const result = hints([{ name: 'fetchData', isSuspend: true }], ['fetchData()']);
    expect(result[0].paddingRight).toBe(true);
  });
});
