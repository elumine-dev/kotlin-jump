/**
 * Adversarial tests for member-symbol disambiguation in Find Usages.
 *
 * Root cause being guarded: when two classes in different packages both have a
 * member with the same simple name (e.g. StatusType.REGULAR and
 * CategoryType.REGULAR), Find Usages must not cross-contaminate results.
 * The fix is in resolveSearchTarget() — it uses fileCouldReference() on the
 * caller document to pick the one whose parent class is visible there.
 *
 * These tests challenge every path through both functions.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { resolveSearchTarget, fileCouldReference } from '../../src/providers/FindUsagesEngine';
import { SymbolIndex } from '../../src/indexer/SymbolIndex';
import { parse } from '../../src/indexer/KotlinParser';
import { mockDocument } from './helpers';

// ─────────────────────────────────────────────────────────────────────────────
// Shared fixture: two enums in different packages, both having REGULAR / EXTRA
// ─────────────────────────────────────────────────────────────────────────────

const STATUS_CODE = `
package com.example.transport.model
enum class StatusType {
    REGULAR,
    EXTRA
}
`;

const CATEGORY_CODE = `
package com.example.content
enum class CategoryType(val value: String) {
    REGULAR("ED"),
    UNKNOWN("UNKNOWN")
}
`;

function makeIndex(): SymbolIndex {
  const idx = new SymbolIndex();
  idx.add(parse('file:///model/StatusType.kt', STATUS_CODE));
  idx.add(parse('file:///category/CategoryType.kt', CATEGORY_CODE));
  return idx;
}

function typeAEntry(idx: SymbolIndex) {
  return idx.lookup('REGULAR').find(e => e.uri.path.includes('StatusType'))!;
}
function typeBEntry(idx: SymbolIndex) {
  return idx.lookup('REGULAR').find(e => e.uri.path.includes('CategoryType'))!;
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. resolveSearchTarget — exact import cases
// ─────────────────────────────────────────────────────────────────────────────

describe('resolveSearchTarget — exact import picks the right declaration', () => {
  let idx: SymbolIndex;
  beforeEach(() => { idx = makeIndex(); });

  it('caller imports StatusType → resolves to StatusType.REGULAR', () => {
    const doc = mockDocument('file:///ui/Screen.kt', `
package com.example.ui
import com.example.transport.model.StatusType
val x = StatusType.REGULAR
`);
    const result = resolveSearchTarget('REGULAR', doc, idx);
    expect(result).toBeDefined();
    expect(result!.uri.path).toContain('StatusType');
  });

  it('caller imports CategoryType → resolves to CategoryType.REGULAR', () => {
    const doc = mockDocument('file:///ui/Screen.kt', `
package com.example.ui
import com.example.content.CategoryType
val x = CategoryType.REGULAR
`);
    const result = resolveSearchTarget('REGULAR', doc, idx);
    expect(result).toBeDefined();
    expect(result!.uri.path).toContain('CategoryType');
  });

  it('caller imports both → ambiguous, returns undefined', () => {
    const doc = mockDocument('file:///ui/Screen.kt', `
package com.example.ui
import com.example.transport.model.StatusType
import com.example.content.CategoryType
val a = StatusType.REGULAR
val b = CategoryType.REGULAR
`);
    // Both parent classes are visible → can't disambiguate → undefined
    const result = resolveSearchTarget('REGULAR', doc, idx);
    expect(result).toBeUndefined();
  });

  it('caller imports neither → ambiguous, returns undefined', () => {
    const doc = mockDocument('file:///ui/Screen.kt', `
package com.example.unrelated
class Unrelated
`);
    const result = resolveSearchTarget('REGULAR', doc, idx);
    expect(result).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. resolveSearchTarget — same-package disambiguation
// ─────────────────────────────────────────────────────────────────────────────

describe('resolveSearchTarget — same-package caller', () => {
  let idx: SymbolIndex;
  beforeEach(() => { idx = makeIndex(); });

  it('caller in StatusType package → resolves to StatusType.REGULAR', () => {
    const doc = mockDocument('file:///model/Helper.kt', `
package com.example.transport.model
val x = REGULAR
`);
    expect(resolveSearchTarget('REGULAR', doc, idx)!.uri.path).toContain('StatusType');
  });

  it('caller in CategoryType package → resolves to CategoryType.REGULAR', () => {
    const doc = mockDocument('file:///edition/Helper.kt', `
package com.example.content
val x = REGULAR
`);
    expect(resolveSearchTarget('REGULAR', doc, idx)!.uri.path).toContain('CategoryType');
  });

  it('sub-package of StatusType package does NOT match → ambiguous', () => {
    // com.example.transport.model.sub ≠ com.example.transport.model
    const doc = mockDocument('file:///sub/Helper.kt', `
package com.example.transport.model.sub
val x = REGULAR
`);
    expect(resolveSearchTarget('REGULAR', doc, idx)).toBeUndefined();
  });

  it('parent package of StatusType does NOT match → ambiguous', () => {
    // com.example.transport ≠ com.example.transport.model
    const doc = mockDocument('file:///transport/Helper.kt', `
package com.example.transport
val x = REGULAR
`);
    expect(resolveSearchTarget('REGULAR', doc, idx)).toBeUndefined();
  });

  it('package that is a prefix string but different segment does NOT match', () => {
    // com.example.transport.modeler — shares chars but is a different package
    const doc = mockDocument('file:///modeler/Helper.kt', `
package com.example.transport.modeler
val x = REGULAR
`);
    expect(resolveSearchTarget('REGULAR', doc, idx)).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. resolveSearchTarget — wildcard import disambiguation
// ─────────────────────────────────────────────────────────────────────────────

describe('resolveSearchTarget — wildcard imports', () => {
  let idx: SymbolIndex;
  beforeEach(() => { idx = makeIndex(); });

  it('wildcard import of StatusType package → resolves to StatusType.REGULAR', () => {
    const doc = mockDocument('file:///ui/Screen.kt', `
package com.example.ui
import com.example.transport.model.*
val x = StatusType.REGULAR
`);
    expect(resolveSearchTarget('REGULAR', doc, idx)!.uri.path).toContain('StatusType');
  });

  it('wildcard import of CategoryType package → resolves to CategoryType.REGULAR', () => {
    const doc = mockDocument('file:///ui/Screen.kt', `
package com.example.ui
import com.example.content.*
val x = CategoryType.REGULAR
`);
    expect(resolveSearchTarget('REGULAR', doc, idx)!.uri.path).toContain('CategoryType');
  });

  it('wildcard at grandparent level does NOT cover either type → ambiguous', () => {
    // import com.example.* does NOT cover com.example.transport.model.StatusType
    const doc = mockDocument('file:///ui/Screen.kt', `
package com.example.ui
import com.example.*
val x = REGULAR
`);
    expect(resolveSearchTarget('REGULAR', doc, idx)).toBeUndefined();
  });

  it('wildcard of both packages → ambiguous', () => {
    const doc = mockDocument('file:///ui/Screen.kt', `
package com.example.ui
import com.example.transport.model.*
import com.example.content.*
`);
    expect(resolveSearchTarget('REGULAR', doc, idx)).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. resolveSearchTarget — declaration file is the caller
// ─────────────────────────────────────────────────────────────────────────────

describe('resolveSearchTarget — caller is the declaration file itself', () => {
  let idx: SymbolIndex;
  beforeEach(() => { idx = makeIndex(); });

  it('StatusType.kt searching for REGULAR → resolves to StatusType.REGULAR', () => {
    const doc = mockDocument('file:///model/StatusType.kt', STATUS_CODE);
    expect(resolveSearchTarget('REGULAR', doc, idx)!.uri.path).toContain('StatusType');
  });

  it('CategoryType.kt searching for REGULAR → resolves to CategoryType.REGULAR', () => {
    const doc = mockDocument('file:///category/CategoryType.kt', CATEGORY_CODE);
    expect(resolveSearchTarget('REGULAR', doc, idx)!.uri.path).toContain('CategoryType');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. resolveSearchTarget — direct FQN import of the member
// ─────────────────────────────────────────────────────────────────────────────

describe('resolveSearchTarget — direct member import (import pkg.Class.MEMBER)', () => {
  let idx: SymbolIndex;
  beforeEach(() => { idx = makeIndex(); });

  it('direct import of StatusType.REGULAR → resolves to StatusType', () => {
    const doc = mockDocument('file:///ui/Screen.kt', `
package com.example.ui
import com.example.transport.model.StatusType.REGULAR
val x = REGULAR
`);
    const result = resolveSearchTarget('REGULAR', doc, idx);
    expect(result).toBeDefined();
    expect(result!.uri.path).toContain('StatusType');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 6. resolveSearchTarget — three-way ambiguity
// ─────────────────────────────────────────────────────────────────────────────

describe('resolveSearchTarget — three classes with same member', () => {
  let idx: SymbolIndex;

  beforeEach(() => {
    idx = makeIndex();
    idx.add(parse('file:///display/DisplayType.kt', `
package com.example.scroll
enum class DisplayType {
    REGULAR,
    SMOOTH
}
`));
  });

  it('importing only DisplayType → resolves to DisplayType.REGULAR', () => {
    const doc = mockDocument('file:///ui/Screen.kt', `
package com.example.ui
import com.example.scroll.DisplayType
val x = DisplayType.REGULAR
`);
    expect(resolveSearchTarget('REGULAR', doc, idx)!.uri.path).toContain('DisplayType');
  });

  it('importing two of three → ambiguous', () => {
    const doc = mockDocument('file:///ui/Screen.kt', `
package com.example.ui
import com.example.transport.model.StatusType
import com.example.scroll.DisplayType
`);
    expect(resolveSearchTarget('REGULAR', doc, idx)).toBeUndefined();
  });

  it('importing none → ambiguous', () => {
    const doc = mockDocument('file:///ui/Screen.kt', `
package com.example.unrelated
class Foo
`);
    expect(resolveSearchTarget('REGULAR', doc, idx)).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 7. resolveSearchTarget — companion object constants (non-enum)
// ─────────────────────────────────────────────────────────────────────────────

describe('resolveSearchTarget — companion object const val', () => {
  let idx: SymbolIndex;

  beforeEach(() => {
    idx = new SymbolIndex();
    idx.add(parse('file:///net/NetworkConfig.kt', `
package com.example.network
class NetworkConfig {
    companion object {
        const val TIMEOUT = 30
    }
}
`));
    idx.add(parse('file:///db/DatabaseConfig.kt', `
package com.example.db
class DatabaseConfig {
    companion object {
        const val TIMEOUT = 60
    }
}
`));
  });

  it('caller imports NetworkConfig → resolves to NetworkConfig.TIMEOUT', () => {
    const doc = mockDocument('file:///ui/NetworkCaller.kt', `
package com.example.ui
import com.example.network.NetworkConfig
val t = NetworkConfig.TIMEOUT
`);
    const result = resolveSearchTarget('TIMEOUT', doc, idx);
    expect(result).toBeDefined();
    expect(result!.uri.path).toContain('NetworkConfig');
  });

  it('caller imports DatabaseConfig → resolves to DatabaseConfig.TIMEOUT', () => {
    const doc = mockDocument('file:///ui/DatabaseCaller.kt', `
package com.example.ui
import com.example.db.DatabaseConfig
val t = DatabaseConfig.TIMEOUT
`);
    const result = resolveSearchTarget('TIMEOUT', doc, idx);
    expect(result).toBeDefined();
    expect(result!.uri.path).toContain('DatabaseConfig');
  });

  it('caller imports both → ambiguous', () => {
    const doc = mockDocument('file:///ui/BothCaller.kt', `
package com.example.ui
import com.example.network.NetworkConfig
import com.example.db.DatabaseConfig
`);
    expect(resolveSearchTarget('TIMEOUT', doc, idx)).toBeUndefined();
  });

  it('caller in network package → resolves to NetworkConfig.TIMEOUT', () => {
    const doc = mockDocument('file:///net/Helper.kt', `
package com.example.network
val t = NetworkConfig.TIMEOUT
`);
    expect(resolveSearchTarget('TIMEOUT', doc, idx)!.uri.path).toContain('NetworkConfig');
  });

  it('caller in db package → resolves to DatabaseConfig.TIMEOUT', () => {
    const doc = mockDocument('file:///db/Helper.kt', `
package com.example.db
val t = DatabaseConfig.TIMEOUT
`);
    expect(resolveSearchTarget('TIMEOUT', doc, idx)!.uri.path).toContain('DatabaseConfig');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 8. resolveSearchTarget — unique global symbol (decls.length === 1)
// ─────────────────────────────────────────────────────────────────────────────

describe('resolveSearchTarget — unique symbol always resolves', () => {
  it('single EXTRA declaration → resolves regardless of imports', () => {
    const idx = new SymbolIndex();
    idx.add(parse('file:///model/StatusType.kt', STATUS_CODE));
    // EXTRA only exists in StatusType — no ambiguity needed

    const doc = mockDocument('file:///ui/Screen.kt', `
package com.example.unrelated
class Foo
`);
    // No import, but only one decl → target is resolved
    const result = resolveSearchTarget('EXTRA', doc, idx);
    expect(result).toBeDefined();
    expect(result!.uri.path).toContain('StatusType');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 9. resolveSearchTarget — word not in index
// ─────────────────────────────────────────────────────────────────────────────

describe('resolveSearchTarget — word not in index', () => {
  it('returns undefined for unknown word', () => {
    const idx = new SymbolIndex();
    idx.add(parse('file:///model/StatusType.kt', STATUS_CODE));
    const doc = mockDocument('file:///ui/Screen.kt', 'package com.example');
    expect(resolveSearchTarget('NONEXISTENT', doc, idx)).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 10. fileCouldReference — package boundary edge cases
// ─────────────────────────────────────────────────────────────────────────────

describe('fileCouldReference — package boundary must be exact', () => {
  let idx: SymbolIndex;
  beforeEach(() => { idx = makeIndex(); });

  it('exact package match → true', () => {
    const e = typeAEntry(idx);
    expect(fileCouldReference('package com.example.transport.model\nclass X', e)).toBe(true);
  });

  it('trailing space after package name → true (word boundary)', () => {
    const e = typeAEntry(idx);
    expect(fileCouldReference('package com.example.transport.model \nclass X', e)).toBe(true);
  });

  it('sub-package (extra segment) → false', () => {
    const e = typeAEntry(idx);
    expect(fileCouldReference('package com.example.transport.model.extra\nclass X', e)).toBe(false);
  });

  it('parent package (one segment short) → false', () => {
    const e = typeAEntry(idx);
    expect(fileCouldReference('package com.example.transport\nclass X', e)).toBe(false);
  });

  it('unrelated package with same name prefix → false', () => {
    // "com.example.transport.models" must NOT match "com.example.transport.model"
    const e = typeAEntry(idx);
    expect(fileCouldReference('package com.example.transport.models\nclass X', e)).toBe(false);
  });

  it('package name appearing only in a comment → false', () => {
    const e = typeAEntry(idx);
    const text = '// package com.example.transport.model\npackage com.other';
    expect(fileCouldReference(text, e)).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 11. fileCouldReference — import variants
// ─────────────────────────────────────────────────────────────────────────────

describe('fileCouldReference — import variants', () => {
  let idx: SymbolIndex;
  beforeEach(() => { idx = makeIndex(); });

  it('exact class import → true', () => {
    const e = typeAEntry(idx);
    expect(fileCouldReference('package other\nimport com.example.transport.model.StatusType\n', e)).toBe(true);
  });

  it('exact member import → true (fqn match)', () => {
    const e = typeAEntry(idx);
    const fqn = e.fqn; // com.example.transport.model.StatusType.REGULAR
    expect(fileCouldReference(`package other\nimport ${fqn}\n`, e)).toBe(true);
  });

  it('wildcard package import → true', () => {
    const e = typeAEntry(idx);
    expect(fileCouldReference('package other\nimport com.example.transport.model.*\n', e)).toBe(true);
  });

  it('wildcard at wrong level → false', () => {
    const e = typeAEntry(idx);
    // import com.example.* does NOT cover com.example.transport.model.StatusType
    expect(fileCouldReference('package other\nimport com.example.*\n', e)).toBe(false);
  });

  it('import of a different class in the same package → false', () => {
    // Importing OtherClass from the same package does NOT expose StatusType members
    const e = typeAEntry(idx);
    expect(fileCouldReference('package other\nimport com.example.transport.model.OtherClass\n', e)).toBe(false);
  });

  it('import that is a prefix string of the right import → false', () => {
    // "com.example.transport.model.StatusTyped" must NOT match "com.example.transport.model.StatusType"
    const e = typeAEntry(idx);
    expect(fileCouldReference('package other\nimport com.example.transport.model.StatusTyped\n', e)).toBe(false);
  });

  it('edition import does NOT allow referencing StatusType.REGULAR → false', () => {
    const e = typeAEntry(idx);
    expect(fileCouldReference('package other\nimport com.example.content.CategoryType\n', e)).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 12. Enum member disambiguation — two classes with same member name
// ─────────────────────────────────────────────────────────────────────────────

describe('Enum member disambiguation — two classes with same member name', () => {
  const STATUS_PKG = `package com.example.app.ui.transport.model
enum class StatusType {
    REGULAR, EXTRA
}
`;
  const CATEGORY_PKG = `package com.example.app.content
enum class CategoryType(val value: String) {
    REGULAR("ED"),
    PROMOTIONAL_SPECIAL_EDITION("SP"),
    PUBLISHER_SPECIAL_EDITION("SR"),
    UNKNOWN("UNKNOWN");
    companion object {
        @JvmStatic fun fromCode(v: String): CategoryType = REGULAR
    }
}
`;
  const TRANSPORT_VM = `package com.example.app.ui.transport
import com.example.app.ui.transport.model.StatusType
private fun onStatusChanged(rail: StatusType) {
    if (rail == StatusType.REGULAR) println("ok")
}
`;
  const TRANSPORT_SCREEN = `package com.example.app.ui.transport.composable
import com.example.app.ui.transport.model.StatusType
val x = StatusType.REGULAR
`;

  let idx: SymbolIndex;
  beforeEach(() => {
    idx = new SymbolIndex();
    idx.add(parse('file:///model/StatusType.kt', STATUS_PKG));
    idx.add(parse('file:///content/CategoryType.kt', CATEGORY_PKG));
  });

  it('transport caller → resolves to StatusType.REGULAR (not CategoryType)', () => {
    const doc = mockDocument('file:///transport/TransportViewModel.kt', TRANSPORT_VM);
    const result = resolveSearchTarget('REGULAR', doc, idx);
    expect(result).toBeDefined();
    expect(result!.fqn).toContain('StatusType');
    expect(result!.fqn).not.toContain('CategoryType');
  });

  it('composable screen → resolves to StatusType.REGULAR (not CategoryType)', () => {
    const doc = mockDocument('file:///composable/TransportScreen.kt', TRANSPORT_SCREEN);
    const result = resolveSearchTarget('REGULAR', doc, idx);
    expect(result).toBeDefined();
    expect(result!.fqn).toContain('StatusType');
    expect(result!.fqn).not.toContain('CategoryType');
  });

  it('CategoryType.kt itself → resolves to CategoryType.REGULAR (not StatusType)', () => {
    const doc = mockDocument('file:///content/CategoryType.kt', CATEGORY_PKG);
    const result = resolveSearchTarget('REGULAR', doc, idx);
    expect(result).toBeDefined();
    expect(result!.fqn).toContain('CategoryType');
    expect(result!.fqn).not.toContain('StatusType');
  });

  it('fileCouldReference — transport caller CANNOT reference CategoryType.REGULAR', () => {
    const edEntry = idx.lookup('REGULAR').find(e => e.uri.path.includes('CategoryType'))!;
    expect(fileCouldReference(TRANSPORT_VM, edEntry)).toBe(false);
  });

  it('fileCouldReference — CategoryType.kt CANNOT reference StatusType.REGULAR', () => {
    const railEnt = idx.lookup('REGULAR').find(e => e.uri.path.includes('StatusType'))!;
    expect(fileCouldReference(CATEGORY_PKG, railEnt)).toBe(false);
  });

  it('fileCouldReference — transport screen CAN reference StatusType.REGULAR', () => {
    const railEnt = idx.lookup('REGULAR').find(e => e.uri.path.includes('StatusType'))!;
    expect(fileCouldReference(TRANSPORT_SCREEN, railEnt)).toBe(true);
  });

  it('DisplayType in same package as StatusType — caller imports DisplayType → resolves to DisplayType.REGULAR', () => {
    // Both types live in the same package; the caller imports DisplayType (not StatusType).
    // The parent-class import check must pick DisplayType, not StatusType.
    idx.add(parse('file:///model/DisplayType.kt', `
package com.example.app.ui.transport.model
enum class DisplayType {
    REGULAR,
    SMOOTH
}
`));
    const doc = mockDocument('file:///composable/Screen.kt', `
package com.example.app.ui.transport.composable
import com.example.app.ui.transport.model.DisplayType
val x = DisplayType.REGULAR
`);
    // fileCouldReference: StatusType → no StatusType import → false
    // fileCouldReference: DisplayType → DisplayType import present → true
    const result = resolveSearchTarget('REGULAR', doc, idx);
    expect(result).toBeDefined();
    expect(result!.uri.path).toContain('DisplayType');
  });
});
