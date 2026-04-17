/**
 * Tests pour VersionCatalogHoverProvider — hover libs.xxx sur .kts/.gradle.
 *
 * Attack surface:
 *  1. LIBS_RE — /\blibs\.([A-Za-z0-9_.]+)\b/g
 *  2. dot→hyphen accessor conversion (compose.ui → compose-ui)
 *  3. Filtrage par extension (.kts et .gradle uniquement)
 *  4. Position inclusive : character <= end
 *  5. Setting versionCatalogHover: false → undefined
 *  6. Range du hover vérifiée
 *
 * Tests nommés SP2-VHP-* pour faciliter le grep.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import * as vscodeMock from './__mocks__/vscode';
import { VersionCatalogHoverProvider } from '../../src/providers/VersionCatalogHoverProvider';
import { VersionCatalogIndex } from '../../src/indexer/VersionCatalogIndex';

afterEach(() => vi.restoreAllMocks());

const TOML = `
[versions]
kotlin = "1.9.22"
compose = "1.6.2"

[libraries]
core-ktx = { group = "androidx.core", name = "core-ktx", version.ref = "kotlin" }
compose-ui = { group = "androidx.compose.ui", name = "ui", version.ref = "compose" }
`.trim();

function makeIdx(): VersionCatalogIndex {
  const idx = new VersionCatalogIndex();
  idx.reindexFile(TOML);
  return idx;
}

function makeDoc(line: string, fileName: string) {
  return {
    fileName,
    lineAt: (_i: number) => ({ text: line }),
  } as any;
}

function makePos(char: number) {
  return new vscodeMock.Position(0, char);
}

// ── SP2-VHP-1 ─────────────────────────────────────────────────────────────────

describe('SP2-VHP-1 — libs.core.ktx sur .kts → hover avec coordonnées', () => {
  it('contents = `androidx.core:core-ktx:1.9.22`', () => {
    const provider = new VersionCatalogHoverProvider(makeIdx());
    const doc = makeDoc('libs.core.ktx', 'build.gradle.kts');
    const hover = provider.provideHover(doc, makePos(5));
    expect(hover).toBeDefined();
    expect(hover!.contents[0].value).toBe('`androidx.core:core-ktx:1.9.22`');
  });
});

// ── SP2-VHP-2 ─────────────────────────────────────────────────────────────────

describe('SP2-VHP-2 — libs.compose.ui (dot→hyphen compose-ui) → hover', () => {
  it('version résolue depuis compose-ui', () => {
    const provider = new VersionCatalogHoverProvider(makeIdx());
    const doc = makeDoc('libs.compose.ui', 'build.gradle.kts');
    const hover = provider.provideHover(doc, makePos(5));
    expect(hover).toBeDefined();
    expect(hover!.contents[0].value).toBe('`androidx.compose.ui:ui:1.6.2`');
  });
});

// ── SP2-VHP-3 ─────────────────────────────────────────────────────────────────

describe('SP2-VHP-3 — libs.unknown.lib absent → undefined', () => {
  it('entrée inconnue → pas de hover', () => {
    const provider = new VersionCatalogHoverProvider(makeIdx());
    const doc = makeDoc('libs.unknown.lib', 'build.gradle.kts');
    expect(provider.provideHover(doc, makePos(5))).toBeUndefined();
  });
});

// ── SP2-VHP-4 ─────────────────────────────────────────────────────────────────

describe('SP2-VHP-4 — curseur avant libs. → undefined', () => {
  it('position.character < start → pas de hover', () => {
    const provider = new VersionCatalogHoverProvider(makeIdx());
    // "implementation libs.core.ktx" — libs. démarre à position 15
    const line = 'implementation libs.core.ktx';
    const doc = makeDoc(line, 'build.gradle.kts');
    expect(provider.provideHover(doc, makePos(10))).toBeUndefined();
  });
});

// ── SP2-VHP-5 ─────────────────────────────────────────────────────────────────

describe('SP2-VHP-5 — curseur à end (boundary inclusive) → hover retourné', () => {
  it('position.character === end → hover trouvé', () => {
    const provider = new VersionCatalogHoverProvider(makeIdx());
    // libs.core.ktx = 13 chars, start=0, end=13
    const doc = makeDoc('libs.core.ktx', 'build.gradle.kts');
    const hover = provider.provideHover(doc, makePos(13));
    expect(hover).toBeDefined();
  });
});

// ── SP2-VHP-6 ─────────────────────────────────────────────────────────────────

describe('SP2-VHP-6 — fichier .kt → undefined', () => {
  it('extension .kt non supportée', () => {
    const provider = new VersionCatalogHoverProvider(makeIdx());
    const doc = makeDoc('libs.core.ktx', 'Main.kt');
    expect(provider.provideHover(doc, makePos(5))).toBeUndefined();
  });
});

// ── SP2-VHP-7 ─────────────────────────────────────────────────────────────────

describe('SP2-VHP-7 — fichier .gradle → hover retourné', () => {
  it('extension .gradle supportée', () => {
    const provider = new VersionCatalogHoverProvider(makeIdx());
    const doc = makeDoc('libs.core.ktx', 'build.gradle');
    const hover = provider.provideHover(doc, makePos(5));
    expect(hover).toBeDefined();
  });
});

// ── SP2-VHP-8 ─────────────────────────────────────────────────────────────────

describe('SP2-VHP-8 — versionCatalogHover: false → undefined', () => {
  it('setting désactivé', () => {
    vi.spyOn(vscodeMock.workspace, 'getConfiguration').mockReturnValue({
      get: (key: string, def: any) => key === 'versionCatalogHover' ? false : def,
    } as any);
    const provider = new VersionCatalogHoverProvider(makeIdx());
    const doc = makeDoc('libs.core.ktx', 'build.gradle.kts');
    expect(provider.provideHover(doc, makePos(5))).toBeUndefined();
  });
});

// ── SP2-VHP-9 ─────────────────────────────────────────────────────────────────

describe('SP2-VHP-9 — range du hover = position exacte de libs.xxx', () => {
  it('range.start.character = index de libs., range.end.character = end', () => {
    const provider = new VersionCatalogHoverProvider(makeIdx());
    // "  libs.core.ktx" — libs. commence à 2, se termine à 15 (2 + 13)
    const line = '  libs.core.ktx';
    const doc = makeDoc(line, 'build.gradle.kts');
    const hover = provider.provideHover(doc, makePos(5));
    expect(hover).toBeDefined();
    expect(hover!.range!.start.character).toBe(2);
    expect(hover!.range!.end.character).toBe(15);
  });
});
