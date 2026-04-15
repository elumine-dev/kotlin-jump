/**
 * Tests adversariaux pour KotlinHoverProvider.
 *
 * Bugs ciblés :
 *
 *   ADV-HP-1  Héritage KDoc en chaîne (A → B → C) :
 *             C ne documente pas, B ne documente pas, A documente.
 *             findBaseMethod doit remonter récursivement jusqu'à A.
 *
 *   ADV-HP-2  Interface parente sans KDoc :
 *             Hover sur un override sans KDoc quand la parente n'a pas de KDoc
 *             non plus → aucun KDoc montré, pas de crash.
 *
 *   ADV-HP-3  override val/var — ne déclenche pas l'héritage KDoc :
 *             La logique ne s'applique qu'à fun et composable.
 *
 *   ADV-HP-4  Classe abstraite comme parente :
 *             Même comportement que pour une interface.
 *
 *   ADV-HP-5  Hover sur un appel dans un fichier tiers (pas l'impl) :
 *             Quand le symbole résolu est dans un autre fichier,
 *             le KDoc de la déclaration est montré.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { SymbolIndex } from '../../src/indexer/SymbolIndex';
import { parse } from '../../src/indexer/KotlinParser';
import { KotlinHoverProvider } from '../../src/providers/HoverProvider';
import { mockDocument, positionOf } from './helpers';
import * as vscode from 'vscode';

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

// ── ADV-HP-1 : Héritage KDoc en chaîne A → B → C ─────────────────────────────
//
// Interface A (has KDoc) → Abstract class B implements A (override, no KDoc)
// → class C implements B (override, no KDoc)
// Hover on C's override must walk two levels and show A's KDoc.

const CHAIN_A_URI = 'file:///data/InterfaceA.kt';
const CHAIN_B_URI = 'file:///data/AbstractB.kt';
const CHAIN_C_URI = 'file:///data/ConcreteC.kt';

const CHAIN_A_KT = `package com.example

interface InterfaceA {
    /**
     * Root documentation from InterfaceA.
     *
     * @param x The input value
     */
    fun doWork(x: Int): String
}`;

const CHAIN_B_KT = `package com.example

abstract class AbstractB : InterfaceA {
    override fun doWork(x: Int): String = x.toString()
}`;

const CHAIN_C_KT = `package com.example

class ConcreteC : AbstractB() {
    override fun doWork(x: Int): String = "C:$x"
}`;

describe('ADV-HP-1 — héritage KDoc en chaîne (A → B → C)', () => {
  it('hover sur ConcreteC.doWork montre le KDoc de InterfaceA', async () => {
    const index = new SymbolIndex();
    addFile(index, CHAIN_A_URI, CHAIN_A_KT);
    addFile(index, CHAIN_B_URI, CHAIN_B_KT);
    addFile(index, CHAIN_C_URI, CHAIN_C_KT);
    const provider = new KotlinHoverProvider(index);
    setupWorkspace({
      [CHAIN_A_URI]: CHAIN_A_KT,
      [CHAIN_B_URI]: CHAIN_B_KT,
      [CHAIN_C_URI]: CHAIN_C_KT,
    });

    const doc = mockDocument(CHAIN_C_URI, CHAIN_C_KT);
    const pos = positionOf(CHAIN_C_KT, 'doWork', 1);

    const hover = await provider.provideHover(doc, pos, { isCancellationRequested: false } as any);
    expect(hover).not.toBeNull();
    const md = hover!.contents.map((s: any) => s.value ?? '').join('\n');
    expect(md).toContain('Root documentation from InterfaceA');
    expect(md).toContain('`x`');
  });
});

// ── ADV-HP-2 : Parente sans KDoc ─────────────────────────────────────────────
//
// Override with no KDoc, parent also has no KDoc → no KDoc section, no crash.

const NO_KDOC_IFACE_URI = 'file:///data/NoKDocInterface.kt';
const NO_KDOC_IMPL_URI  = 'file:///data/NoKDocImpl.kt';

const NO_KDOC_IFACE_KT = `package com.example

interface NoKDocInterface {
    fun compute(): Int
}`;

const NO_KDOC_IMPL_KT = `package com.example

class NoKDocImpl : NoKDocInterface {
    override fun compute(): Int = 42
}`;

describe('ADV-HP-2 — parente sans KDoc', () => {
  it('override sans KDoc sur parente sans KDoc → aucun KDoc, pas de crash', async () => {
    const index = new SymbolIndex();
    addFile(index, NO_KDOC_IFACE_URI, NO_KDOC_IFACE_KT);
    addFile(index, NO_KDOC_IMPL_URI,  NO_KDOC_IMPL_KT);
    const provider = new KotlinHoverProvider(index);
    setupWorkspace({
      [NO_KDOC_IFACE_URI]: NO_KDOC_IFACE_KT,
      [NO_KDOC_IMPL_URI]:  NO_KDOC_IMPL_KT,
    });

    const doc = mockDocument(NO_KDOC_IMPL_URI, NO_KDOC_IMPL_KT);
    const pos = positionOf(NO_KDOC_IMPL_KT, 'compute', 1);

    const hover = await provider.provideHover(doc, pos, { isCancellationRequested: false } as any);
    expect(hover).not.toBeNull(); // hover still shows signature
    const md = hover!.contents.map((s: any) => s.value ?? '').join('\n');
    expect(md).not.toContain('/**');
    expect(md).not.toContain('@param');
  });
});

// ── ADV-HP-3 : override val — héritage KDoc ne s'applique pas ─────────────────
//
// `override val name: String` has kind='val', not fun/composable.
// The inherited-KDoc branch must NOT fire for properties.

const VAL_OVERRIDE_IFACE_URI = 'file:///data/ValInterface.kt';
const VAL_OVERRIDE_IMPL_URI  = 'file:///data/ValImpl.kt';

const VAL_OVERRIDE_IFACE_KT = `package com.example

interface ValInterface {
    /**
     * KDoc on a property declaration.
     */
    val description: String
}`;

const VAL_OVERRIDE_IMPL_KT = `package com.example

class ValImpl : ValInterface {
    override val description: String = "impl"
}`;

describe('ADV-HP-3 — override val ne déclenche pas l\'héritage KDoc', () => {
  it('hover sur override val → signature affichée, aucun KDoc hérité', async () => {
    const index = new SymbolIndex();
    addFile(index, VAL_OVERRIDE_IFACE_URI, VAL_OVERRIDE_IFACE_KT);
    addFile(index, VAL_OVERRIDE_IMPL_URI,  VAL_OVERRIDE_IMPL_KT);
    const provider = new KotlinHoverProvider(index);
    setupWorkspace({
      [VAL_OVERRIDE_IFACE_URI]: VAL_OVERRIDE_IFACE_KT,
      [VAL_OVERRIDE_IMPL_URI]:  VAL_OVERRIDE_IMPL_KT,
    });

    const doc = mockDocument(VAL_OVERRIDE_IMPL_URI, VAL_OVERRIDE_IMPL_KT);
    const pos = positionOf(VAL_OVERRIDE_IMPL_KT, 'description', 1);

    const hover = await provider.provideHover(doc, pos, { isCancellationRequested: false } as any);
    // Hover still works (shows signature), but does NOT inherit KDoc from interface
    expect(hover).not.toBeNull();
    const md = hover!.contents.map((s: any) => s.value ?? '').join('\n');
    expect(md).not.toContain('KDoc on a property declaration');
  });
});

// ── ADV-HP-4 : Classe abstraite comme parente ─────────────────────────────────
//
// Behaviour must be the same as with interfaces.

const ABSTRACT_URI = 'file:///data/AbstractParent.kt';
const CONCRETE_URI = 'file:///data/ConcreteChild.kt';

const ABSTRACT_KT = `package com.example

abstract class AbstractParent {
    /**
     * Abstract KDoc visible in subclasses.
     *
     * @param n The count
     * @return Processed result
     */
    abstract fun process(n: Int): String
}`;

const CONCRETE_KT = `package com.example

class ConcreteChild : AbstractParent() {
    override fun process(n: Int): String = n.toString()
}`;

describe('ADV-HP-4 — classe abstraite comme parente', () => {
  it('override d\'une méthode abstraite sans KDoc → montre le KDoc de la classe abstraite', async () => {
    const index = new SymbolIndex();
    addFile(index, ABSTRACT_URI, ABSTRACT_KT);
    addFile(index, CONCRETE_URI, CONCRETE_KT);
    const provider = new KotlinHoverProvider(index);
    setupWorkspace({
      [ABSTRACT_URI]: ABSTRACT_KT,
      [CONCRETE_URI]: CONCRETE_KT,
    });

    const doc = mockDocument(CONCRETE_URI, CONCRETE_KT);
    const pos = positionOf(CONCRETE_KT, 'process', 1);

    const hover = await provider.provideHover(doc, pos, { isCancellationRequested: false } as any);
    expect(hover).not.toBeNull();
    const md = hover!.contents.map((s: any) => s.value ?? '').join('\n');
    expect(md).toContain('Abstract KDoc visible in subclasses');
    expect(md).toContain('`n`');
  });
});

// ── ADV-HP-5 : KDoc affiché depuis un fichier appelant (symbole non ambigu) ───
//
// isAtOwnDeclaration = (position.line === entry.line && same URI)
// When the caller is in a DIFFERENT file, isAtOwnDeclaration is always false.
// The KDoc must be shown — the suppression only applies at the declaration line.

const EXT_LOGGER_URI = 'file:///data/ext/Logger.kt';
const EXT_SCREEN_URI = 'file:///data/ext/MainScreen.kt';

const EXT_LOGGER_KT = `package com.example.ext

class Logger {
    /**
     * Records a diagnostic message.
     *
     * @param msg The message to record
     */
    fun recordDiag(msg: String) {
        println(msg)
    }
}`;

const EXT_SCREEN_KT = `package com.example.ext

class MainScreen(private val logger: Logger) {
    fun show() {
        logger.recordDiag("hello")
    }
}`;

describe('ADV-HP-5 — KDoc affiché depuis un fichier appelant (symbole non ambigu)', () => {
  it('hover sur appel recordDiag() depuis MainScreen montre le KDoc de Logger', async () => {
    const index = new SymbolIndex();
    addFile(index, EXT_LOGGER_URI, EXT_LOGGER_KT);
    addFile(index, EXT_SCREEN_URI, EXT_SCREEN_KT);
    const provider = new KotlinHoverProvider(index);
    setupWorkspace({
      [EXT_LOGGER_URI]: EXT_LOGGER_KT,
      [EXT_SCREEN_URI]: EXT_SCREEN_KT,
    });

    const doc = mockDocument(EXT_SCREEN_URI, EXT_SCREEN_KT);
    const pos = positionOf(EXT_SCREEN_KT, 'recordDiag', 1);

    const hover = await provider.provideHover(doc, pos, { isCancellationRequested: false } as any);
    expect(hover).not.toBeNull();
    const md = hover!.contents.map((s: any) => s.value ?? '').join('\n');
    // isAtOwnDeclaration is false (different file) → KDoc must NOT be suppressed
    expect(md).toContain('Records a diagnostic message');
    expect(md).toContain('`msg`');
  });
});

// ── ADV-HP-6 : Inner class masquant les supertypes de la classe englobante ────
//
// BUG: Sans le filtre `s.depth === entry.depth - 1`, une inner class déclarée
// entre la classe parente et la méthode override écrase enclosingSupertypes avec
// ses propres supertypes (souvent vides). Résultat : findBaseMethod retourne
// undefined au lieu de remonter vers l'interface.

const INNER_IFACE_URI = 'file:///data/inner/Engine.kt';
const INNER_IMPL_URI  = 'file:///data/inner/Car.kt';

const INNER_IFACE_KT = `package com.example.inner

interface Engine {
    /**
     * Starts the engine.
     *
     * @param rpm Target RPM
     */
    fun start(rpm: Int)
}`;

// Car implements Engine, but also declares an inner class between the class
// declaration and the override. Without the depth-filter fix, InnerHelper's
// empty supertypes overwrite Engine's, breaking KDoc inheritance.
const INNER_IMPL_KT = `package com.example.inner

class Car : Engine {
    class InnerHelper {
        fun assist() {}
    }
    override fun start(rpm: Int) {
        // drive
    }
}`;

describe('ADV-HP-6 — inner class ne masque pas les supertypes de la classe englobante', () => {
  it('hover sur Car.start montre le KDoc de Engine.start malgré InnerHelper', async () => {
    const index = new SymbolIndex();
    addFile(index, INNER_IFACE_URI, INNER_IFACE_KT);
    addFile(index, INNER_IMPL_URI,  INNER_IMPL_KT);
    const provider = new KotlinHoverProvider(index);
    setupWorkspace({
      [INNER_IFACE_URI]: INNER_IFACE_KT,
      [INNER_IMPL_URI]:  INNER_IMPL_KT,
    });

    const doc = mockDocument(INNER_IMPL_URI, INNER_IMPL_KT);
    // occurrence 1 of 'start' in Car.kt = the override declaration
    const pos = positionOf(INNER_IMPL_KT, 'start', 1);

    const hover = await provider.provideHover(doc, pos, { isCancellationRequested: false } as any);
    expect(hover).not.toBeNull();
    const md = hover!.contents.map((s: any) => s.value ?? '').join('\n');
    expect(md).toContain('Starts the engine');
    expect(md).toContain('`rpm`');
  });
});
