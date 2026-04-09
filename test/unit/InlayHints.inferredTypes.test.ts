/**
 * Tests pour la passe 2 de KotlinInlayHintsProvider — hints de types inférés.
 *
 * Couvre : émission correcte, propriétés du hint, position de colonne,
 * lignes exclues (type explicite, destructuring, by lazy…), RHS sans appel,
 * constructeurs, Unit/Nothing, appels imbriqués, flags, interaction pass1+pass2,
 * cache, annulation, précision callOffset.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { KotlinInlayHintsProvider } from '../../src/providers/InlayHintsProvider';
import { SymbolIndex } from '../../src/indexer/SymbolIndex';
import { parse } from '../../src/indexer/KotlinParser';
import { mockDocument } from './helpers';
import { Position, Range } from './__mocks__/vscode';
import * as vscodeMock from './__mocks__/vscode';

// ── Helpers ──────────────────────────────────────────────────────────────────

let _id = 0;
function freshUri() { return `file:///IIT_${_id++}.kt`; }

function addFile(index: SymbolIndex, uri: string, code: string) {
  index.add(parse(uri, code));
}

function fullRange(code: string): Range {
  const lines = code.split('\n');
  return new Range(new Position(0, 0), new Position(lines.length - 1, lines[lines.length - 1].length));
}

const token = { isCancellationRequested: false } as any;
const cancelledToken = { isCancellationRequested: true } as any;

afterEach(() => vi.restoreAllMocks());

// Helpers pour mocker kotlinJump settings (lus dynamiquement dans provideInlayHints)
function mockConfig(opts: { paramNames?: boolean; inferredTypes?: boolean }) {
  vi.spyOn(vscodeMock.workspace, 'getConfiguration').mockReturnValue({
    get: (key: string, def: any) => {
      if (key === 'inlayHints.parameterNames') return opts.paramNames ?? def;
      if (key === 'inlayHints.inferredTypes')  return opts.inferredTypes ?? def;
      return def;
    },
  } as any);
}

// Provider isolé : showParamNames=false, showInferredTypes=true
function inferredProvider(index: SymbolIndex) {
  mockConfig({ paramNames: false, inferredTypes: true });
  return new KotlinInlayHintsProvider(index);
}

// ── Groupe 1 : Cas de base ────────────────────────────────────────────────────

describe('InlayHints inferredTypes — cas de base', () => {
  it('val x = fetch() → 1 hint `: String`', async () => {
    const declUri = freshUri();
    const callUri = freshUri();
    const decl = 'fun fetch(): String {}';
    const call = 'val x = fetch()';
    const index = new SymbolIndex();
    addFile(index, declUri, decl);
    vi.spyOn(vscodeMock.workspace, 'openTextDocument').mockResolvedValue(mockDocument(declUri, decl) as any);

    const hints = await inferredProvider(index).provideInlayHints(mockDocument(callUri, call), fullRange(call), token);

    expect(hints.length).toBe(1);
    const label = hints[0].label as vscodeMock.InlayHintLabelPart[];
    expect(label[0].value).toBe(': String');
  });

  it('var x = fetch() → 1 hint (var fonctionne)', async () => {
    const declUri = freshUri();
    const callUri = freshUri();
    const decl = 'fun fetch(): String {}';
    const call = 'var x = fetch()';
    const index = new SymbolIndex();
    addFile(index, declUri, decl);
    vi.spyOn(vscodeMock.workspace, 'openTextDocument').mockResolvedValue(mockDocument(declUri, decl) as any);

    const hints = await inferredProvider(index).provideInlayHints(mockDocument(callUri, call), fullRange(call), token);

    expect(hints.length).toBe(1);
  });

  it('val n = count() → 1 hint `: Int`', async () => {
    const declUri = freshUri();
    const callUri = freshUri();
    const decl = 'fun count(): Int = 0';
    const call = 'val n = count()';
    const index = new SymbolIndex();
    addFile(index, declUri, decl);
    vi.spyOn(vscodeMock.workspace, 'openTextDocument').mockResolvedValue(mockDocument(declUri, decl) as any);

    const hints = await inferredProvider(index).provideInlayHints(mockDocument(callUri, call), fullRange(call), token);

    expect(hints.length).toBe(1);
    expect((hints[0].label as vscodeMock.InlayHintLabelPart[])[0].value).toBe(': Int');
  });

  it('val u = users() → 1 hint `: List<User>`', async () => {
    const declUri = freshUri();
    const callUri = freshUri();
    const decl = 'fun users(): List<User> = listOf()';
    const call = 'val u = users()';
    const index = new SymbolIndex();
    addFile(index, declUri, decl);
    vi.spyOn(vscodeMock.workspace, 'openTextDocument').mockResolvedValue(mockDocument(declUri, decl) as any);

    const hints = await inferredProvider(index).provideInlayHints(mockDocument(callUri, call), fullRange(call), token);

    expect(hints.length).toBe(1);
    expect((hints[0].label as vscodeMock.InlayHintLabelPart[])[0].value).toBe(': List<User>');
  });
});

// ── Groupe 2 : Propriétés du hint ────────────────────────────────────────────

describe('InlayHints inferredTypes — propriétés du hint émis', () => {
  async function getHint() {
    const declUri = freshUri();
    const callUri = freshUri();
    const decl = 'fun fetch(): String {}';
    const call = 'val x = fetch()';
    const index = new SymbolIndex();
    addFile(index, declUri, decl);
    vi.spyOn(vscodeMock.workspace, 'openTextDocument').mockResolvedValue(mockDocument(declUri, decl) as any);
    const hints = await inferredProvider(index).provideInlayHints(mockDocument(callUri, call), fullRange(call), token);
    return { hints, declUri };
  }

  it('kind = Type (1)', async () => {
    const { hints } = await getHint();
    expect(hints[0].kind).toBe(vscodeMock.InlayHintKind.Type);
  });

  it('paddingLeft = true', async () => {
    const { hints } = await getHint();
    expect(hints[0].paddingLeft).toBe(true);
  });

  it('label contient `: String`', async () => {
    const { hints } = await getHint();
    const label = hints[0].label as vscodeMock.InlayHintLabelPart[];
    expect(label[0].value).toBe(': String');
  });

  it('textEdits contient 1 TextEdit.insert', async () => {
    const { hints } = await getHint();
    expect(hints[0].textEdits).toHaveLength(1);
    expect(hints[0].textEdits![0].newText).toBe(': String');
  });

  it('label[0].location pointe vers la déclaration', async () => {
    const { hints, declUri } = await getHint();
    const label = hints[0].label as vscodeMock.InlayHintLabelPart[];
    expect(label[0].location?.uri.toString()).toBe(declUri);
  });
});

// ── Groupe 3 : Position précise de la colonne ─────────────────────────────────

describe('InlayHints inferredTypes — position précise du hint', () => {
  async function charOf(call: string) {
    const declUri = freshUri();
    const callUri = freshUri();
    const decl = 'fun fetch(): String {}';
    const index = new SymbolIndex();
    addFile(index, declUri, decl);
    vi.spyOn(vscodeMock.workspace, 'openTextDocument').mockResolvedValue(mockDocument(declUri, decl) as any);
    const hints = await inferredProvider(index).provideInlayHints(mockDocument(callUri, call), fullRange(call), token);
    return hints.length > 0 ? hints[0].position.character : -1;
  }

  // Calcul attendu : varNameCol = matchStr.indexOf(varName, kwEnd)
  it('`val x = fetch()` → col 5', async () => expect(await charOf('val x = fetch()')).toBe(5));
  it('`val value = fetch()` → col 9', async () => expect(await charOf('val value = fetch()')).toBe(9));
  it('`var result = fetch()` → col 10', async () => expect(await charOf('var result = fetch()')).toBe(10));
  it('`  val x = fetch()` (2 espaces) → col 7', async () => expect(await charOf('  val x = fetch()')).toBe(7));
  it('`private val count = fetch()` → col 17', async () => expect(await charOf('private val count = fetch()')).toBe(17));
});

// ── Groupe 4 : Lignes sans hint ───────────────────────────────────────────────

describe('InlayHints inferredTypes — lignes qui ne produisent pas de hint', () => {
  async function hints0(call: string) {
    const declUri = freshUri();
    const callUri = freshUri();
    const decl = 'fun fetch(): String {}';
    const index = new SymbolIndex();
    addFile(index, declUri, decl);
    vi.spyOn(vscodeMock.workspace, 'openTextDocument').mockResolvedValue(mockDocument(declUri, decl) as any);
    const hints = await inferredProvider(index).provideInlayHints(mockDocument(callUri, call), fullRange(call), token);
    return hints.length;
  }

  it('type explicite `val x: String = fetch()`', async () => expect(await hints0('val x: String = fetch()')).toBe(0));
  it('type nullable explicite `val x: String? = fetch()`', async () => expect(await hints0('val x: String? = fetch()')).toBe(0));
  it('destructuring `val (a, b) = fetch()`', async () => expect(await hints0('val (a, b) = fetch()')).toBe(0));
  it('by lazy `val x by lazy { fetch() }`', async () => expect(await hints0('val x by lazy { fetch() }')).toBe(0));
  it('assignation simple `x = fetch()`', async () => expect(await hints0('x = fetch()')).toBe(0));
  it('ligne commentaire `// val x = fetch()`', async () => expect(await hints0('// val x = fetch()')).toBe(0));
  it('fun expression `fun foo(): String = fetch()`', async () => expect(await hints0('fun foo(): String = fetch()')).toBe(0));
});

// ── Groupe 5 : RHS sans appel → 0 hints ──────────────────────────────────────

describe('InlayHints inferredTypes — RHS sans appel de fonction', () => {
  async function hints0rhs(call: string) {
    const index = new SymbolIndex();
    vi.spyOn(vscodeMock.workspace, 'openTextDocument').mockResolvedValue(null as any);
    return (await inferredProvider(index).provideInlayHints(mockDocument(freshUri(), call), fullRange(call), token)).length;
  }

  it('`val x = 42`', async () => expect(await hints0rhs('val x = 42')).toBe(0));
  it('`val x = "hello"`', async () => expect(await hints0rhs('val x = "hello"')).toBe(0));
  it('`val x = true`', async () => expect(await hints0rhs('val x = true')).toBe(0));
  it('`val x = null`', async () => expect(await hints0rhs('val x = null')).toBe(0));
  it('`val x = someVar`', async () => expect(await hints0rhs('val x = someVar')).toBe(0));
  it('`val x = Color.RED`', async () => expect(await hints0rhs('val x = Color.RED')).toBe(0));
});

// ── Groupe 6 : stdlib non-indexée → 0 hints ──────────────────────────────────

describe('InlayHints inferredTypes — stdlib non-indexée', () => {
  it('listOf() → 0 hints', async () => {
    const index = new SymbolIndex(); // index vide
    vi.spyOn(vscodeMock.workspace, 'openTextDocument').mockResolvedValue(null as any);
    const hints = await inferredProvider(index).provideInlayHints(
      mockDocument(freshUri(), 'val x = listOf(1, 2)'),
      fullRange('val x = listOf(1, 2)'),
      token,
    );
    expect(hints.length).toBe(0);
  });
});

// ── Groupe 7 : Fonction retournant Unit/Nothing → 0 hints ────────────────────

describe('InlayHints inferredTypes — Unit/Nothing filtré', () => {
  async function hintsFor(decl: string, call: string) {
    const declUri = freshUri();
    const callUri = freshUri();
    const index = new SymbolIndex();
    addFile(index, declUri, decl);
    vi.spyOn(vscodeMock.workspace, 'openTextDocument').mockResolvedValue(mockDocument(declUri, decl) as any);
    return (await inferredProvider(index).provideInlayHints(mockDocument(callUri, call), fullRange(call), token)).length;
  }

  it('fun foo(): Unit {} → 0 hints', async () =>
    expect(await hintsFor('fun foo(): Unit {}', 'val x = foo()')).toBe(0));

  it('fun foo() {} (pas de type) → 0 hints', async () =>
    expect(await hintsFor('fun foo() {}', 'val x = foo()')).toBe(0));

  it('fun foo(): Nothing = TODO() → 0 hints', async () =>
    expect(await hintsFor('fun foo(): Nothing = TODO()', 'val x = foo()')).toBe(0));
});

// ── Groupe 8 : Constructeur (class) → 0 hints ────────────────────────────────

describe('InlayHints inferredTypes — constructeurs class → 0 hints', () => {
  async function hintsFor(decl: string, call: string) {
    const declUri = freshUri();
    const callUri = freshUri();
    const index = new SymbolIndex();
    addFile(index, declUri, decl);
    vi.spyOn(vscodeMock.workspace, 'openTextDocument').mockResolvedValue(mockDocument(declUri, decl) as any);
    return (await inferredProvider(index).provideInlayHints(mockDocument(callUri, call), fullRange(call), token)).length;
  }

  it('class Foo(val x: Int) → 0 hints (extractReturnType null pour class)', async () =>
    expect(await hintsFor('class Foo(val x: Int)', 'val f = Foo(1)')).toBe(0));

  it('data class Point → 0 hints', async () =>
    expect(await hintsFor('data class Point(val x: Int, val y: Int)', 'val p = Point(0, 0)')).toBe(0));
});

// ── Groupe 9 : Appels imbriqués — trouve le premier ──────────────────────────

describe('InlayHints inferredTypes — appels imbriqués (premier match)', () => {
  it('val x = foo(bar()) → type de retour de foo', async () => {
    const declUri = freshUri();
    const callUri = freshUri();
    const decl = 'fun foo(): String {}\nfun bar(): Int {}';
    const call = 'val x = foo(bar())';
    const index = new SymbolIndex();
    addFile(index, declUri, decl);
    vi.spyOn(vscodeMock.workspace, 'openTextDocument').mockResolvedValue(mockDocument(declUri, decl) as any);

    const hints = await inferredProvider(index).provideInlayHints(mockDocument(callUri, call), fullRange(call), token);

    expect(hints.length).toBe(1);
    expect((hints[0].label as vscodeMock.InlayHintLabelPart[])[0].value).toBe(': String');
  });
});

// ── Groupe 10 : showInferredTypes flag ────────────────────────────────────────

describe('InlayHints inferredTypes — flag showInferredTypes', () => {
  async function setupHints(provider: KotlinInlayHintsProvider, decl: string, declUri: string, call: string) {
    vi.spyOn(vscodeMock.workspace, 'openTextDocument').mockResolvedValue(mockDocument(declUri, decl) as any);
    return provider.provideInlayHints(mockDocument(freshUri(), call), fullRange(call), token);
  }

  it('default (showInferredTypes=true) → 1 hint de type avec val x = fetch()', async () => {
    const declUri = freshUri();
    const decl = 'fun fetch(): String {}';
    const index = new SymbolIndex();
    addFile(index, declUri, decl);

    const provider = new KotlinInlayHintsProvider(index); // defaults: paramNames=true, inferredTypes=true
    const hints = await setupHints(provider, decl, declUri, 'val x = fetch()');
    const typeHints = hints.filter(h => h.kind === vscodeMock.InlayHintKind.Type);
    expect(typeHints.length).toBe(1);
  });

  it('showInferredTypes=true → 1 hint de type', async () => {
    const declUri = freshUri();
    const decl = 'fun fetch(): String {}';
    const index = new SymbolIndex();
    addFile(index, declUri, decl);

    mockConfig({ paramNames: false, inferredTypes: true });
    const provider = new KotlinInlayHintsProvider(index);
    const hints = await setupHints(provider, decl, declUri, 'val x = fetch()');
    expect(hints.length).toBe(1);
  });

  it('showParamNames=true, showInferredTypes=false → 0 hints de type', async () => {
    const declUri = freshUri();
    const decl = 'fun fetch(): String {}';
    const index = new SymbolIndex();
    addFile(index, declUri, decl);

    mockConfig({ paramNames: true, inferredTypes: false });
    const provider = new KotlinInlayHintsProvider(index);
    const hints = await setupHints(provider, decl, declUri, 'val x = fetch()');
    const typeHints = hints.filter(h => h.kind === vscodeMock.InlayHintKind.Type);
    expect(typeHints.length).toBe(0);
  });
});

// ── Groupe 11 : Interaction pass 1 + pass 2 ──────────────────────────────────

describe('InlayHints inferredTypes — interaction pass 1 + pass 2', () => {
  it('ligne déclaration → pass 1 absent, pass 2 actif', async () => {
    const declUri = freshUri();
    const decl = 'fun fetch(): String {}\nfun greet(name: String) {}';
    const index = new SymbolIndex();
    addFile(index, declUri, decl);
    vi.spyOn(vscodeMock.workspace, 'openTextDocument').mockResolvedValue(mockDocument(declUri, decl) as any);

    mockConfig({ paramNames: true, inferredTypes: true });
    const provider = new KotlinInlayHintsProvider(index);
    const call = 'val x = fetch()';
    const hints = await provider.provideInlayHints(mockDocument(freshUri(), call), fullRange(call), token);

    const paramHints = hints.filter(h => h.kind === vscodeMock.InlayHintKind.Parameter);
    const typeHints  = hints.filter(h => h.kind === vscodeMock.InlayHintKind.Type);
    expect(paramHints.length).toBe(0); // pas de param hints sur une décl
    expect(typeHints.length).toBe(1);  // 1 type hint
  });

  it('ligne appel → pass 1 actif, pass 2 absent', async () => {
    const declUri = freshUri();
    const decl = 'fun fetch(): String {}\nfun greet(name: String) {}';
    const index = new SymbolIndex();
    addFile(index, declUri, decl);
    vi.spyOn(vscodeMock.workspace, 'openTextDocument').mockResolvedValue(mockDocument(declUri, decl) as any);

    mockConfig({ paramNames: true, inferredTypes: true });
    const provider = new KotlinInlayHintsProvider(index);
    const call = 'greet("Alice")';
    const hints = await provider.provideInlayHints(mockDocument(freshUri(), call), fullRange(call), token);

    const paramHints = hints.filter(h => h.kind === vscodeMock.InlayHintKind.Parameter);
    const typeHints  = hints.filter(h => h.kind === vscodeMock.InlayHintKind.Type);
    expect(paramHints.length).toBe(1); // 1 param hint
    expect(typeHints.length).toBe(0);  // pas de type hint
  });

  it('fichier multi-lignes : type hint ligne 0 + param hint ligne 1', async () => {
    const declUri = freshUri();
    const decl = 'fun fetch(): String {}\nfun greet(name: String) {}';
    const index = new SymbolIndex();
    addFile(index, declUri, decl);
    vi.spyOn(vscodeMock.workspace, 'openTextDocument').mockResolvedValue(mockDocument(declUri, decl) as any);

    mockConfig({ paramNames: true, inferredTypes: true });
    const provider = new KotlinInlayHintsProvider(index);
    const code = 'val x = fetch()\ngreet("Alice")';
    const hints = await provider.provideInlayHints(mockDocument(freshUri(), code), fullRange(code), token);

    const typeHints  = hints.filter(h => h.kind === vscodeMock.InlayHintKind.Type);
    const paramHints = hints.filter(h => h.kind === vscodeMock.InlayHintKind.Parameter);
    expect(typeHints.length).toBe(1);
    expect(typeHints[0].position.line).toBe(0);
    expect(paramHints.length).toBe(1);
    expect(paramHints[0].position.line).toBe(1);
  });
});

// ── Groupe 12 : returnTypeCache ───────────────────────────────────────────────

describe('InlayHints inferredTypes — returnTypeCache', () => {
  it('openTextDocument appelé 1× pour le même FQN sur 2 lignes', async () => {
    const declUri = freshUri();
    const decl = 'fun fetch(): String {}';
    const index = new SymbolIndex();
    addFile(index, declUri, decl);

    const spy = vi.spyOn(vscodeMock.workspace, 'openTextDocument').mockResolvedValue(mockDocument(declUri, decl) as any);

    const code = 'val a = fetch()\nval b = fetch()';
    await inferredProvider(index).provideInlayHints(mockDocument(freshUri(), code), fullRange(code), token);

    // openTextDocument doit être appelé 1 seule fois (cache hit pour la 2e ligne)
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('deux providers distincts avec même FQN → caches indépendants', async () => {
    const SAME_URI = `file:///Cache_${_id++}.kt`;
    const decl1 = 'fun foo(): String {}';
    const decl2 = 'fun foo(): Int {}';
    const callCode = 'val x = foo()';

    const index1 = new SymbolIndex();
    const index2 = new SymbolIndex();
    addFile(index1, SAME_URI, decl1);
    addFile(index2, SAME_URI, decl2);

    vi.spyOn(vscodeMock.workspace, 'openTextDocument')
      .mockResolvedValueOnce(mockDocument(SAME_URI, decl1) as any)
      .mockResolvedValueOnce(mockDocument(SAME_URI, decl2) as any);

    const hints1 = await inferredProvider(index1).provideInlayHints(mockDocument(freshUri(), callCode), fullRange(callCode), token);
    vi.restoreAllMocks();
    vi.spyOn(vscodeMock.workspace, 'openTextDocument').mockResolvedValue(mockDocument(SAME_URI, decl2) as any);
    const hints2 = await inferredProvider(index2).provideInlayHints(mockDocument(freshUri(), callCode), fullRange(callCode), token);

    expect((hints1[0].label as vscodeMock.InlayHintLabelPart[])[0].value).toBe(': String');
    expect((hints2[0].label as vscodeMock.InlayHintLabelPart[])[0].value).toBe(': Int');
  });
});

// ── Groupe 13 : Annulation ────────────────────────────────────────────────────

describe('InlayHints inferredTypes — annulation', () => {
  it('token annulé avant le traitement → []', async () => {
    const declUri = freshUri();
    const decl = 'fun fetch(): String {}';
    const index = new SymbolIndex();
    addFile(index, declUri, decl);
    vi.spyOn(vscodeMock.workspace, 'openTextDocument').mockResolvedValue(mockDocument(declUri, decl) as any);

    const hints = await inferredProvider(index).provideInlayHints(
      mockDocument(freshUri(), 'val x = fetch()'),
      fullRange('val x = fetch()'),
      cancelledToken,
    );

    expect(hints).toEqual([]);
  });
});

// ── Groupe 14 : callOffset anti-collision nom/valeur ──────────────────────────

describe('InlayHints inferredTypes — callOffset précision (anti-collision nom/valeur)', () => {
  it('`val result = result()` → hint émis correctement', async () => {
    // varName = "result", callName = "result"
    // callOffset doit pointer sur le 2e "result" (le vrai appel), pas le 1er (varName)
    const declUri = freshUri();
    const decl = 'fun result(): String {}';
    const call = 'val result = result()';
    const index = new SymbolIndex();
    addFile(index, declUri, decl);
    vi.spyOn(vscodeMock.workspace, 'openTextDocument').mockResolvedValue(mockDocument(declUri, decl) as any);

    const hints = await inferredProvider(index).provideInlayHints(mockDocument(freshUri(), call), fullRange(call), token);

    expect(hints.length).toBe(1);
    expect((hints[0].label as vscodeMock.InlayHintLabelPart[])[0].value).toBe(': String');
  });

  it('`val id = id()` → hint émis correctement (varName == callName, 2 chars)', async () => {
    const declUri = freshUri();
    const decl = 'fun id(): Int {}';
    const call = 'val id = id()';
    const index = new SymbolIndex();
    addFile(index, declUri, decl);
    vi.spyOn(vscodeMock.workspace, 'openTextDocument').mockResolvedValue(mockDocument(declUri, decl) as any);

    const hints = await inferredProvider(index).provideInlayHints(mockDocument(freshUri(), call), fullRange(call), token);

    expect(hints.length).toBe(1);
    expect((hints[0].label as vscodeMock.InlayHintLabelPart[])[0].value).toBe(': Int');
  });
});
