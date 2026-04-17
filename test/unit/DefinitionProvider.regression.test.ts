/**
 * Tests de régression pour KotlinDefinitionProvider — bugs corrigés.
 *
 * Attack surface :
 *  1. R.color.NAME → cmd+click ne doit PAS naviguer vers un Kotlin symbol homonyme
 *  2. R.string.NAME, R.drawable.NAME — même protection
 *  3. Config.NAME (deux niveaux, racine non-R) → navigation inchangée
 *  4. Symbole standalone homonyme → navigation préservée
 *
 * Tests nommés DP-REG-* pour faciliter le grep.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { KotlinDefinitionProvider, isAndroidResourceRef } from '../../src/providers/DefinitionProvider';
import { SymbolIndex } from '../../src/indexer/SymbolIndex';
import { parse } from '../../src/indexer/KotlinParser';
import { mockDocument, positionOf } from './helpers';

function addFile(index: SymbolIndex, uri: string, code: string) {
  index.add(parse(uri, code));
}

// ── Code de référence ────────────────────────────────────────────────────────

// Fichier qui déclare des propriétés Kotlin dont les noms collisionnent
// avec des IDs de ressources Android (error, warning, primary…).
const URI_THEME = 'file:///ui/Theme.kt';
const CODE_THEME = `package com.example.ui

object Theme {
    val error   = "#FF0000"
    val warning = "#FFA500"
    val primary = "#7F52FF"
}`;

// Fichier qui utilise des ressources Android via R.type.name ET des usages Kotlin normaux.
const URI_SCREEN = 'file:///ui/Screen.kt';

// ── DP-REG-1 : R.color.NAME → null ──────────────────────────────────────────

describe('DP-REG-1 — R.color.error → null (ne doit pas trouver Theme.error)', () => {
  let provider: KotlinDefinitionProvider;

  beforeEach(() => {
    const index = new SymbolIndex();
    addFile(index, URI_THEME, CODE_THEME);
    provider = new KotlinDefinitionProvider(index);
  });

  it('cursor sur "error" dans R.color.error → null', () => {
    const code = `package com.example.ui
fun render() { val tint = R.color.error }`;
    const doc = mockDocument(URI_SCREEN, code);
    expect(provider.provideDefinition(doc, positionOf(code, 'error'))).toBeNull();
  });

  it('cursor sur "warning" dans R.color.warning → null', () => {
    const code = `package com.example.ui
fun render() { val tint = R.color.warning }`;
    const doc = mockDocument(URI_SCREEN, code);
    expect(provider.provideDefinition(doc, positionOf(code, 'warning'))).toBeNull();
  });

  it('cursor sur "primary" dans R.color.primary → null', () => {
    const code = `package com.example.ui
fun render() { val tint = R.color.primary }`;
    const doc = mockDocument(URI_SCREEN, code);
    expect(provider.provideDefinition(doc, positionOf(code, 'primary'))).toBeNull();
  });
});

// ── DP-REG-2 : R.string.NAME → null ─────────────────────────────────────────

describe('DP-REG-2 — R.string.NAME → null (pas de faux match Kotlin)', () => {
  let provider: KotlinDefinitionProvider;

  beforeEach(() => {
    const index = new SymbolIndex();
    // Propriété Kotlin "app_name" indexée — doit être ignorée quand précédée R.string.
    addFile(index, URI_THEME, `package com.example.ui\nobject Strings { val app_name = "Demo" }`);
    provider = new KotlinDefinitionProvider(index);
  });

  it('cursor sur "app_name" dans R.string.app_name → null', () => {
    const code = `package com.example.ui
fun init() { val label = R.string.app_name }`;
    const doc = mockDocument(URI_SCREEN, code);
    expect(provider.provideDefinition(doc, positionOf(code, 'app_name'))).toBeNull();
  });

  it('cursor sur "error_unknown" dans R.string.error_unknown → null', () => {
    const code = `package com.example.ui
fun init() { val msg = R.string.error_unknown }`;
    const doc = mockDocument(URI_SCREEN, code);
    expect(provider.provideDefinition(doc, positionOf(code, 'error_unknown'))).toBeNull();
  });
});

// ── DP-REG-3 : R.drawable.NAME et autres types → null ───────────────────────

describe('DP-REG-3 — R.drawable / R.id / R.layout → null', () => {
  let provider: KotlinDefinitionProvider;

  beforeEach(() => {
    const index = new SymbolIndex();
    addFile(index, URI_THEME, `package com.example.ui\nobject Ids { val ic_logo = 42; val main = "main" }`);
    provider = new KotlinDefinitionProvider(index);
  });

  it('R.drawable.ic_logo → null', () => {
    const code = `fun f() { val d = R.drawable.ic_logo }`;
    const doc = mockDocument(URI_SCREEN, code);
    expect(provider.provideDefinition(doc, positionOf(code, 'ic_logo'))).toBeNull();
  });

  it('R.id.main → null', () => {
    const code = `fun f() { val v = R.id.main }`;
    const doc = mockDocument(URI_SCREEN, code);
    expect(provider.provideDefinition(doc, positionOf(code, 'main'))).toBeNull();
  });
});

// ── DP-REG-4 : symbole standalone (hors R.*.*) — navigation préservée ────────

describe('DP-REG-4 — symbole homonyme standalone hors R.*.* → navigation inchangée', () => {
  let provider: KotlinDefinitionProvider;

  beforeEach(() => {
    const index = new SymbolIndex();
    addFile(index, URI_THEME, CODE_THEME);
    provider = new KotlinDefinitionProvider(index);
  });

  it('standalone "error" sans qualificateur → navigue vers Theme.error', () => {
    const code = `package com.example.ui
import com.example.ui.Theme
fun f() { val x = error }`;
    const doc = mockDocument(URI_SCREEN, code);
    const result = provider.provideDefinition(doc, positionOf(code, 'error'));
    expect(result).toBeDefined();
    expect(result).not.toBeNull();
  });
});

// ── DP-REG-5 : isAndroidResourceRef — tests unitaires de la fonction ─────────

describe('DP-REG-5 — isAndroidResourceRef : vrai positifs', () => {
  it('R.color.error → true', () => expect(isAndroidResourceRef('R.color.error', 8)).toBe(true));
  it('R.color.warning → true', () => expect(isAndroidResourceRef('val x = R.color.warning', 16)).toBe(true));
  it('R.string.app_name → true', () => expect(isAndroidResourceRef('val s = R.string.app_name', 17)).toBe(true));
  it('R.drawable.ic_logo → true', () => expect(isAndroidResourceRef('R.drawable.ic_logo', 11)).toBe(true));
  it('R.id.btn_ok → true', () => expect(isAndroidResourceRef('R.id.btn_ok', 5)).toBe(true));
  it('indentation : "    R.color.primary" → true', () => {
    const line = '    val c = R.color.primary';
    expect(isAndroidResourceRef(line, line.indexOf('primary'))).toBe(true);
  });
});

describe('DP-REG-5b — isAndroidResourceRef : vrais négatifs', () => {
  it('Config.error (racine non-R) → false', () => {
    const line = 'val x = Config.error';
    expect(isAndroidResourceRef(line, line.indexOf('error'))).toBe(false);
  });
  it('error seul (sans qualificateur) → false', () => {
    expect(isAndroidResourceRef('val x = error', 8)).toBe(false);
  });
  it('R.error (un seul niveau) → false', () => {
    expect(isAndroidResourceRef('val x = R.error', 10)).toBe(false);
  });
  it('RR.color.error (racine != R) → false', () => {
    const line = 'val x = RR.color.error';
    expect(isAndroidResourceRef(line, line.indexOf('error'))).toBe(false);
  });
  it('Config.Companion.CONST → false (racine = Config ≠ R)', () => {
    const line = 'val x = Config.Companion.CONST';
    expect(isAndroidResourceRef(line, line.indexOf('CONST'))).toBe(false);
  });
  it('color seul (qualificateur, pas le nom) → false', () => {
    const line = 'val x = R.color';
    // cursor sur "color" — c'est le type, pas le name
    expect(isAndroidResourceRef(line, line.indexOf('color'))).toBe(false);
  });
});

// ── DP-REG-6 : R.color multi-occurrences sur la même ligne ───────────────────

describe('DP-REG-6 — plusieurs R.color.* sur la même ligne → chacun retourne null', () => {
  let provider: KotlinDefinitionProvider;

  beforeEach(() => {
    const index = new SymbolIndex();
    addFile(index, URI_THEME, CODE_THEME);
    provider = new KotlinDefinitionProvider(index);
  });

  it('R.color.error, R.color.warning, R.color.primary sur même ligne → null × 3', () => {
    const code = `fun f() { val a = R.color.error; val b = R.color.warning; val c = R.color.primary }`;
    const doc = mockDocument(URI_SCREEN, code);
    expect(provider.provideDefinition(doc, positionOf(code, 'error'))).toBeNull();
    expect(provider.provideDefinition(doc, positionOf(code, 'warning'))).toBeNull();
    expect(provider.provideDefinition(doc, positionOf(code, 'primary'))).toBeNull();
  });
});

// ── DP-REG-8 : override val/var navigue vers la déclaration de l'interface ────
// Régression pour BUG-1 : DefinitionProvider ne gérait que 'fun' et 'composable'.
// Les overrides de propriétés (val/var) restaient sur eux-mêmes au lieu de
// naviguer vers la base.

describe('DP-REG-8 — override val → navigue vers la base (fix BUG-1)', () => {
  const URI_IFACE = 'file:///Iface.kt';
  const URI_IMPL  = 'file:///Impl.kt';

  const CODE_IFACE = `package com.example
interface MyInterface {
    val myProp: String
}`;

  const CODE_IMPL = `package com.example
import com.example.MyInterface
class MyClass : MyInterface {
    override val myProp: String = "hello"
}`;

  let provider: KotlinDefinitionProvider;

  beforeEach(() => {
    const index = new SymbolIndex();
    addFile(index, URI_IFACE, CODE_IFACE);
    addFile(index, URI_IMPL,  CODE_IMPL);
    provider = new KotlinDefinitionProvider(index);
  });

  it('cursor sur "myProp" dans override val → location vers MyInterface.myProp', () => {
    const doc = mockDocument(URI_IMPL, CODE_IMPL);
    const pos = positionOf(CODE_IMPL, 'myProp');
    const result = provider.provideDefinition(doc, pos) as any;
    expect(result).not.toBeNull();
    const loc = Array.isArray(result) ? result[0] : result;
    expect(loc?.uri.toString()).toBe(URI_IFACE);
    // mock Location stocke une Position (pas Range) → .range.line = numéro de ligne
    expect(loc?.range?.line).toBe(2); // ligne de val myProp dans l'interface
  });

  it('override fun inchangé — ne régresse pas', () => {
    const codeIface = `package com.example\ninterface I { fun doIt() }`;
    const codeImpl  = `package com.example\nimport com.example.I\nclass C : I { override fun doIt() {} }`;
    const index2 = new SymbolIndex();
    addFile(index2, URI_IFACE, codeIface);
    addFile(index2, URI_IMPL,  codeImpl);
    const p2 = new KotlinDefinitionProvider(index2);
    const doc = mockDocument(URI_IMPL, codeImpl);
    const pos = positionOf(codeImpl, 'doIt'); // seule occurrence dans codeImpl = l'override
    const result = p2.provideDefinition(doc, pos) as any;
    expect(result).not.toBeNull();
    const loc = Array.isArray(result) ? result[0] : result;
    expect(loc?.uri.toString()).toBe(URI_IFACE);
    expect(loc?.range?.line).toBe(1); // doIt est sur la ligne 1 (0-indexed) dans codeIface
  });
});

describe('DP-REG-9 — override var → navigue vers la base (fix BUG-1)', () => {
  const URI_IFACE = 'file:///IVar.kt';
  const URI_IMPL  = 'file:///ImplVar.kt';

  const CODE_IFACE = `package com.example
interface Configurable {
    var timeout: Int
}`;

  const CODE_IMPL = `package com.example
import com.example.Configurable
class Config : Configurable {
    override var timeout: Int = 30
}`;

  let provider: KotlinDefinitionProvider;

  beforeEach(() => {
    const index = new SymbolIndex();
    addFile(index, URI_IFACE, CODE_IFACE);
    addFile(index, URI_IMPL,  CODE_IMPL);
    provider = new KotlinDefinitionProvider(index);
  });

  it('cursor sur "timeout" dans override var → location vers Configurable.timeout', () => {
    const doc = mockDocument(URI_IMPL, CODE_IMPL);
    const pos = positionOf(CODE_IMPL, 'timeout'); // seule occurrence dans CODE_IMPL = l'override
    const result = provider.provideDefinition(doc, pos) as any;
    expect(result).not.toBeNull();
    const loc = Array.isArray(result) ? result[0] : result;
    expect(loc?.uri.toString()).toBe(URI_IFACE);
    expect(loc?.range?.line).toBe(2);
  });
});

// ── DP-REG-7 : R.color dans ${} string interpolation → null ──────────────────

describe('DP-REG-7 — R.color dans string interpolation — null (pas de faux match)', () => {
  let provider: KotlinDefinitionProvider;

  beforeEach(() => {
    const index = new SymbolIndex();
    addFile(index, URI_THEME, CODE_THEME);
    provider = new KotlinDefinitionProvider(index);
  });

  it('"${R.color.error}" → null', () => {
    const code = `fun f() { val s = "\${R.color.error}" }`;
    const doc = mockDocument(URI_SCREEN, code);
    expect(provider.provideDefinition(doc, positionOf(code, 'error'))).toBeNull();
  });
});
