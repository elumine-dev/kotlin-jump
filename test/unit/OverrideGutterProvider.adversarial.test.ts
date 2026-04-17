/**
 * Tests adversariaux pour OverrideGutterProvider.
 *
 * Bugs couverts :
 *   OGP-ADV-1 — Désambiguïsation : deux interfaces "Handler" dans des packages distincts
 *                → chaque lens affiche le bon compte (1, pas 2)
 *   OGP-ADV-2 — Command class-level = goToClassImpl (pas goToMethodImpl)
 *   OGP-ADV-3 — Command method-level = toujours goToMethodImpl (inchangé)
 *   OGP-ADV-4 — Interface sans packageName → pas de crash
 *   OGP-ADV-5 — Sealed class avec sous-types disambiguïsés correctement
 */

import { describe, it, expect } from 'vitest';
import { parse } from '../../src/indexer/KotlinParser';
import { SymbolIndex } from '../../src/indexer/SymbolIndex';
import { OverrideGutterProvider } from '../../src/providers/OverrideGutterProvider';

function addKt(index: SymbolIndex, uri: string, code: string) {
  index.add(parse(uri, code));
}

function makeDoc(uri: string, lang = 'kotlin') {
  return {
    uri: { toString: () => uri, path: uri.replace('file://', '') },
    languageId: lang,
  } as any;
}

// ── OGP-ADV-1 : désambiguïsation — deux interfaces "Handler" ─────────────────

describe('OGP-ADV-1 — désambiguïsation Handler com.a vs com.b', () => {
  const URI_A_BASE = 'file:///a/Handler.kt';
  const URI_A_IMPL = 'file:///a/HandlerA.kt';
  const URI_B_BASE = 'file:///b/Handler.kt';
  const URI_B_IMPL = 'file:///b/HandlerB.kt';

  const CODE_A_BASE = 'package com.a\ninterface Handler';
  const CODE_A_IMPL = 'package com.a\nclass HandlerA : Handler';
  const CODE_B_BASE = 'package com.b\ninterface Handler';
  const CODE_B_IMPL = 'package com.b\nclass HandlerB : Handler';

  function setup() {
    const index = new SymbolIndex();
    addKt(index, URI_B_BASE, CODE_B_BASE);
    addKt(index, URI_B_IMPL, CODE_B_IMPL);
    addKt(index, URI_A_BASE, CODE_A_BASE);
    addKt(index, URI_A_IMPL, CODE_A_IMPL);
    return new OverrideGutterProvider(index as any);
  }

  it('lens de com.a.Handler → "⬇ 1 implementation" (pas 2)', () => {
    const provider = setup();
    const lenses = provider.provideCodeLenses(makeDoc(URI_A_BASE));
    const classLens = lenses.find(l => l.command?.title.startsWith('⬇'));
    expect(classLens).toBeDefined();
    expect(classLens!.command!.title).toBe('⬇ 1 implementation');
  });

  it('lens de com.b.Handler → "⬇ 1 implementation" également', () => {
    const provider = setup();
    const lenses = provider.provideCodeLenses(makeDoc(URI_B_BASE));
    const classLens = lenses.find(l => l.command?.title.startsWith('⬇'));
    expect(classLens).toBeDefined();
    expect(classLens!.command!.title).toBe('⬇ 1 implementation');
  });
});

// ── OGP-ADV-2 : command class-level = goToClassImpl ──────────────────────────

describe('OGP-ADV-2 — command class-level = kotlin-jump.goToClassImpl', () => {
  const IFACE_URI  = 'file:///adv/Repo.kt';
  const IMPL_URI   = 'file:///adv/RepoImpl.kt';
  const IFACE_CODE = 'package com.adv\ninterface Repo';
  const IMPL_CODE  = 'package com.adv\nclass RepoImpl : Repo';

  it('interface avec impl → commande goToClassImpl', () => {
    const index = new SymbolIndex();
    addKt(index, IFACE_URI, IFACE_CODE);
    addKt(index, IMPL_URI,  IMPL_CODE);
    const provider = new OverrideGutterProvider(index as any);
    const lenses = provider.provideCodeLenses(makeDoc(IFACE_URI));
    const classLens = lenses.find(l => l.command?.title.startsWith('⬇'));
    expect(classLens).toBeDefined();
    expect(classLens!.command!.command).toBe('kotlin-jump.goToClassImpl');
  });
});

// ── OGP-ADV-3 : command method-level = goToMethodImpl (inchangé) ─────────────

describe('OGP-ADV-3 — command method-level = kotlin-jump.goToMethodImpl (inchangé)', () => {
  const IFACE_URI  = 'file:///adv2/Service.kt';
  const IMPL_URI   = 'file:///adv2/ServiceImpl.kt';
  const IFACE_CODE = `package com.adv2
interface Service {
    fun fetch(): String
}`;
  const IMPL_CODE  = `package com.adv2
class ServiceImpl : Service {
    override fun fetch() = "data"
}`;

  it('méthode d\'interface → commande goToMethodImpl', () => {
    const index = new SymbolIndex();
    addKt(index, IFACE_URI, IFACE_CODE);
    addKt(index, IMPL_URI,  IMPL_CODE);
    const provider = new OverrideGutterProvider(index as any);
    const lenses = provider.provideCodeLenses(makeDoc(IFACE_URI));
    // Le lens de méthode (fetch) doit utiliser goToMethodImpl
    const methodLens = lenses.find(l => l.command?.command === 'kotlin-jump.goToMethodImpl');
    expect(methodLens).toBeDefined();
  });

  it('command class-level et method-level sont distincts', () => {
    const index = new SymbolIndex();
    addKt(index, IFACE_URI, IFACE_CODE);
    addKt(index, IMPL_URI,  IMPL_CODE);
    const provider = new OverrideGutterProvider(index as any);
    const lenses = provider.provideCodeLenses(makeDoc(IFACE_URI));
    const commands = lenses.map(l => l.command?.command);
    expect(commands).toContain('kotlin-jump.goToClassImpl');
    expect(commands).toContain('kotlin-jump.goToMethodImpl');
  });
});

// ── OGP-ADV-4 : interface sans packageName → pas de crash ────────────────────

describe('OGP-ADV-4 — interface sans packageName → pas de crash', () => {
  const URI  = 'file:///nopkg/Bare.kt';
  const CODE = 'interface Bare'; // pas de déclaration package

  it('interface sans package + impl → lens sans crash', () => {
    const index = new SymbolIndex();
    addKt(index, URI, CODE);
    addKt(index, 'file:///nopkg/BareImpl.kt', 'class BareImpl : Bare');
    const provider = new OverrideGutterProvider(index as any);
    expect(() => provider.provideCodeLenses(makeDoc(URI))).not.toThrow();
  });
});

// ── OGP-ADV-5 : sealed class avec sous-types disambiguïsés ───────────────────

describe('OGP-ADV-5 — sealed class avec 2 sous-types disambiguïsés', () => {
  const URI   = 'file:///sealed/Result.kt';
  const URI_A = 'file:///sealed/Success.kt';
  const URI_B = 'file:///sealed/Failure.kt';

  const CODE   = 'package com.sealed\nsealed class Result';
  const CODE_A = 'package com.sealed\nclass Success : Result()';
  const CODE_B = 'package com.sealed\nclass Failure : Result()';

  it('sealed class + 2 impls → "⬇ 2 implementations"', () => {
    const index = new SymbolIndex();
    addKt(index, URI,   CODE);
    addKt(index, URI_A, CODE_A);
    addKt(index, URI_B, CODE_B);
    const provider = new OverrideGutterProvider(index as any);
    const lenses = provider.provideCodeLenses(makeDoc(URI));
    const classLens = lenses.find(l => l.command?.title.startsWith('⬇'));
    expect(classLens).toBeDefined();
    expect(classLens!.command!.title).toBe('⬇ 2 implementations');
  });
});
