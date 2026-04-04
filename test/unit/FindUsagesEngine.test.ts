import { describe, it, expect, beforeEach } from 'vitest';
import { fileCouldReference, escapeRegex } from '../../src/providers/FindUsagesEngine';
import { KotlinDefinitionProvider, getPendingDeclNav, clearPendingDeclNav } from '../../src/providers/DefinitionProvider';
import { SymbolIndex } from '../../src/indexer/SymbolIndex';
import { parse } from '../../src/indexer/KotlinParser';
import { mockDocument, positionOf } from './helpers';

// Helper to create a minimal SymbolEntry for fileCouldReference
function makeEntry(index: SymbolIndex, name: string) {
  const entries = index.lookup(name);
  if (entries.length === 0) throw new Error(`Symbol "${name}" not found in index`);
  return entries[0];
}

// ── BUG: References missing for member FQNs ─────────────────────────────────

describe('fileCouldReference — member FQN parent class import', () => {
  let index: SymbolIndex;

  beforeEach(() => {
    index = new SymbolIndex();
    index.add(parse('file:///delegate/GameDelegate.kt', `package com.example.delegate

interface GameDelegate {
    fun setGameNavigator(nav: Nav)
    fun unregisterGameBus()
}

class GameDelegateImpl : GameDelegate {
    override fun setGameNavigator(nav: Nav) {}
    override fun unregisterGameBus() {}
}`));
  });

  it('file importing GameDelegate CAN reference GameDelegate.unregisterGameBus', () => {
    const entry = makeEntry(index, 'unregisterGameBus');
    // FQN = com.example.delegate.GameDelegate.unregisterGameBus
    const fileText = `package com.example.main
import com.example.delegate.GameDelegate

class ViewModel {
    fun cleanup() {
        gameDelegate.unregisterGameBus()
    }
}`;
    expect(fileCouldReference(fileText, entry)).toBe(true);
  });

  it('file with NO import of GameDelegate CANNOT reference unregisterGameBus', () => {
    const entry = makeEntry(index, 'unregisterGameBus');
    const fileText = `package com.example.other

class Unrelated {
    fun doStuff() {}
}`;
    expect(fileCouldReference(fileText, entry)).toBe(false);
  });

  it('file in SAME package CAN reference without import', () => {
    const entry = makeEntry(index, 'unregisterGameBus');
    const fileText = `package com.example.delegate

class Helper {
    fun cleanup(d: GameDelegate) {
        d.unregisterGameBus()
    }
}`;
    expect(fileCouldReference(fileText, entry)).toBe(true);
  });

  it('file with wildcard import CAN reference', () => {
    const entry = makeEntry(index, 'unregisterGameBus');
    const fileText = `package com.example.main
import com.example.delegate.*

class ViewModel {}`;
    expect(fileCouldReference(fileText, entry)).toBe(true);
  });

  it('sub-package does NOT match parent package', () => {
    const entry = makeEntry(index, 'GameDelegate');
    // com.example.delegate vs com.example.delegate.impl — should NOT match
    const fileText = `package com.example.delegate.impl

class Something {}`;
    expect(fileCouldReference(fileText, entry)).toBe(false);
  });
});

// ── smartNavigation: false behavior ─────────────────────────────────────────

describe('smartNavigation: false — DefinitionProvider command choice', () => {
  // This tests the logic indirectly: when smartNav is false and at declaration,
  // the provider sets _pendingDeclNav (which the selection listener uses to
  // fire editor.action.goToReferences instead of kotlin-jump.findUsages).
  // We verify that _pendingDeclNav IS set (meaning the listener will handle it).

  it('at declaration with no implementations → sets pendingDeclNav', () => {
    const index = new SymbolIndex();
    index.add(parse('file:///Foo.kt', 'package com.example\nclass Foo'));
    clearPendingDeclNav();

    const provider = new KotlinDefinitionProvider(index);
    const doc = mockDocument('file:///Foo.kt', 'package com.example\nclass Foo');
    const pos = positionOf('package com.example\nclass Foo', 'Foo');

    provider.provideDefinition(doc, pos);
    // pendingDeclNav should be set regardless of smartNav setting
    // The selection listener in extension.ts checks smartNav to decide which command to fire
    expect(getPendingDeclNav()).toBeDefined();
    expect(getPendingDeclNav()!.word).toBe('Foo');
  });
});

// ── Enum member / companion const disambiguation ─────────────────────────────
// Regression: searching for REGULAR from StatusType.kt must NOT include
// CategoryType.REGULAR occurrences — fileCouldReference must reject files that
// only import or declare a *different* class with the same member name.

describe('fileCouldReference — enum member disambiguation (StatusType.REGULAR vs CategoryType.REGULAR)', () => {
  let index: SymbolIndex;
  let typeAEntry: ReturnType<typeof makeEntry>;
  let typeBEntry: ReturnType<typeof makeEntry>;

  beforeEach(() => {
    index = new SymbolIndex();
    index.add(parse('file:///model/StatusType.kt', `
package com.example.transport.model
enum class StatusType {
    REGULAR,
    EXTRA
}
`));
    index.add(parse('file:///category/CategoryType.kt', `
package com.example.content
enum class CategoryType(val value: String) {
    REGULAR("ED"),
    UNKNOWN("UNKNOWN")
}
`));
    typeAEntry    = index.lookup('REGULAR').find(e => e.uri.path.includes('StatusType'))!;
    typeBEntry = index.lookup('REGULAR').find(e => e.uri.path.includes('CategoryType'))!;
  });

  it('StatusType.kt (declaration file) can reference StatusType.REGULAR', () => {
    const text = `package com.example.transport.model\nenum class StatusType {\n    REGULAR, EXTRA\n}\n`;
    expect(fileCouldReference(text, typeAEntry)).toBe(true);
  });

  it('CategoryType.kt cannot reference StatusType.REGULAR', () => {
    const text = `package com.example.content\nenum class CategoryType(val value: String) {\n    REGULAR("ED")\n}\n`;
    expect(fileCouldReference(text, typeAEntry)).toBe(false);
  });

  it('caller importing StatusType can reference StatusType.REGULAR but not CategoryType.REGULAR', () => {
    const callerText = `package com.example.transport.ui
import com.example.transport.model.StatusType

fun onStatus(r: StatusType) {
    if (r == StatusType.REGULAR) println("regular")
}`;
    expect(fileCouldReference(callerText, typeAEntry)).toBe(true);
    expect(fileCouldReference(callerText, typeBEntry)).toBe(false);
  });

  it('caller importing CategoryType can reference CategoryType.REGULAR but not StatusType.REGULAR', () => {
    const callerText = `package com.example.ui
import com.example.content.CategoryType

fun onCategory(e: CategoryType) {
    if (e == CategoryType.REGULAR) println("regular")
}`;
    expect(fileCouldReference(callerText, typeBEntry)).toBe(true);
    expect(fileCouldReference(callerText, typeAEntry)).toBe(false);
  });
});

// ── escapeRegex ─────────────────────────────────────────────────────────────

describe('escapeRegex', () => {
  it('escapes dots', () => {
    expect(escapeRegex('com.example')).toBe('com\\.example');
  });

  it('escapes special regex chars', () => {
    expect(escapeRegex('foo+bar*baz')).toBe('foo\\+bar\\*baz');
  });
});
