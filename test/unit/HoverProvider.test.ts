import { describe, it, expect, beforeEach, vi } from 'vitest';
import { SymbolIndex } from '../../src/indexer/SymbolIndex';
import { parse } from '../../src/indexer/KotlinParser';
import { KotlinHoverProvider } from '../../src/providers/HoverProvider';
import { mockDocument, positionOf } from './helpers';
import * as vscode from 'vscode';

// ── Fixtures ──────────────────────────────────────────────────────────────────

const REPO_URI  = 'file:///data/PokemonRepository.kt';
const IMPL_URI  = 'file:///data/PokemonRepositoryImpl.kt';
const OTHER_URI = 'file:///data/Other.kt';

const REPO_KT = `package com.example.data

interface PokemonRepository {
    /**
     * Catches a Pokémon by its Pokédex ID.
     *
     * @param id The national Pokédex number
     * @return The caught Pokemon instance
     */
    suspend fun catch(id: Int): Pokemon

    /**
     * Releases a Pokémon back into the wild.
     *
     * @param pokemon The Pokemon to release
     */
    suspend fun release(pokemon: Pokemon)
}`;

// catch and release are both override-without-KDoc → should inherit
const IMPL_NO_KDOC_KT = `package com.example.data

class PokemonRepositoryImpl : PokemonRepository {
    override suspend fun catch(id: Int): Pokemon {
        return Pokemon(id, "Unknown")
    }
    override suspend fun release(pokemon: Pokemon) {
        // no-op
    }
}`;

// release has its own KDoc; catch calls release from a helper
const IMPL_OWN_KDOC_KT = `package com.example.data

class PokemonRepositoryImpl : PokemonRepository {
    override suspend fun catch(id: Int): Pokemon {
        return Pokemon(id, "Unknown")
    }
    /**
     * Custom release implementation — stores audit log.
     */
    override suspend fun release(pokemon: Pokemon) {
        // stores audit
    }
    suspend fun releaseAll(pokemons: List<Pokemon>) {
        for (p in pokemons) release(p)
    }
}`;

// Non-override fun — must not trigger inherited KDoc path
const OTHER_KT = `package com.example.data

class Other {
    fun doSomething(): String = "hello"
}`;

// ── Helpers ───────────────────────────────────────────────────────────────────

function addFile(index: SymbolIndex, uri: string, code: string) {
  index.add(parse(uri, code));
}

function setupWorkspace(docMap: Record<string, string>) {
  (vscode.workspace as any).openTextDocument = vi.fn().mockImplementation(async (uri: any) => {
    const uriStr = typeof uri === 'string' ? uri : uri.toString();
    if (uriStr in docMap) return mockDocument(uriStr, docMap[uriStr]);
    return null;
  });
}

// ── Inherited KDoc ────────────────────────────────────────────────────────────

describe('HoverProvider — inherited KDoc on overrides', () => {
  let index: SymbolIndex;
  let provider: KotlinHoverProvider;

  beforeEach(() => {
    index = new SymbolIndex();
    addFile(index, REPO_URI,  REPO_KT);
    addFile(index, IMPL_URI,  IMPL_NO_KDOC_KT);
    provider = new KotlinHoverProvider(index);
    setupWorkspace({ [REPO_URI]: REPO_KT, [IMPL_URI]: IMPL_NO_KDOC_KT });
  });

  it('override with no KDoc shows inherited KDoc from interface', async () => {
    const doc = mockDocument(IMPL_URI, IMPL_NO_KDOC_KT);
    const pos = positionOf(IMPL_NO_KDOC_KT, 'catch', 1);

    const hover = await provider.provideHover(doc, pos, { isCancellationRequested: false } as any);
    expect(hover).not.toBeNull();
    const markdown = hover!.contents.map((s: any) => s.value ?? '').join('\n');
    expect(markdown).toContain('Catches a Pokémon');
    // formatKDoc converts @param to bullet: `- \`id\` — ...`
    expect(markdown).toContain('`id`');
  });

  it('second override without KDoc also inherits', async () => {
    const doc = mockDocument(IMPL_URI, IMPL_NO_KDOC_KT);
    const pos = positionOf(IMPL_NO_KDOC_KT, 'release', 1);

    const hover = await provider.provideHover(doc, pos, { isCancellationRequested: false } as any);
    expect(hover).not.toBeNull();
    const markdown = hover!.contents.map((s: any) => s.value ?? '').join('\n');
    expect(markdown).toContain('Releases a Pokémon');
    // formatKDoc converts @param to bullet: `- \`pokemon\` — ...`
    expect(markdown).toContain('`pokemon`');
  });
});

// ── Own KDoc at declaration is suppressed ─────────────────────────────────────

describe('HoverProvider — own KDoc suppressed at declaration', () => {
  it('override with own KDoc at its declaration shows no KDoc (already visible inline)', async () => {
    const index = new SymbolIndex();
    addFile(index, REPO_URI, REPO_KT);
    addFile(index, IMPL_URI, IMPL_OWN_KDOC_KT);
    const provider = new KotlinHoverProvider(index);
    setupWorkspace({ [REPO_URI]: REPO_KT, [IMPL_URI]: IMPL_OWN_KDOC_KT });

    const doc = mockDocument(IMPL_URI, IMPL_OWN_KDOC_KT);
    // occurrence 2 = the `override suspend fun release` declaration (occurrence 1 is in KDoc text)
    const pos = positionOf(IMPL_OWN_KDOC_KT, 'release', 2);

    const hover = await provider.provideHover(doc, pos, { isCancellationRequested: false } as any);
    expect(hover).not.toBeNull(); // hover still shows signature + meta
    const markdown = hover!.contents.map((s: any) => s.value ?? '').join('\n');
    // KDoc text is suppressed — neither own nor inherited shown at declaration
    expect(markdown).not.toContain('Custom release implementation');
    expect(markdown).not.toContain('Releases a Pokémon back into the wild');
  });

  it('own KDoc IS shown when hovering at a call site in the same file', async () => {
    const index = new SymbolIndex();
    addFile(index, REPO_URI, REPO_KT);
    addFile(index, IMPL_URI, IMPL_OWN_KDOC_KT);
    const provider = new KotlinHoverProvider(index);
    setupWorkspace({ [REPO_URI]: REPO_KT, [IMPL_URI]: IMPL_OWN_KDOC_KT });

    const doc = mockDocument(IMPL_URI, IMPL_OWN_KDOC_KT);
    // occurrence 4 = the call `release(p)` inside releaseAll
    // (occurrences 1=KDoc text, 2=declaration, 3='release' prefix in 'releaseAll')
    const pos = positionOf(IMPL_OWN_KDOC_KT, 'release', 4);

    const hover = await provider.provideHover(doc, pos, { isCancellationRequested: false } as any);
    expect(hover).not.toBeNull();
    const markdown = hover!.contents.map((s: any) => s.value ?? '').join('\n');
    // At a call site (not the declaration line) the KDoc is useful — must be shown
    expect(markdown).toContain('Custom release implementation');
  });
});

// ── Non-override fun — unaffected ─────────────────────────────────────────────

describe('HoverProvider — non-override fun is unaffected', () => {
  it('regular method with no KDoc shows no KDoc section', async () => {
    const index = new SymbolIndex();
    addFile(index, OTHER_URI, OTHER_KT);
    const provider = new KotlinHoverProvider(index);
    setupWorkspace({ [OTHER_URI]: OTHER_KT });

    const doc = mockDocument(OTHER_URI, OTHER_KT);
    const pos = positionOf(OTHER_KT, 'doSomething');

    const hover = await provider.provideHover(doc, pos, { isCancellationRequested: false } as any);
    // hover exists (shows signature), but KDoc section is absent
    expect(hover).not.toBeNull();
    const markdown = hover!.contents.map((s: any) => s.value ?? '').join('\n');
    expect(markdown).not.toContain('/**');
    expect(markdown).not.toContain('@param');
  });
});
