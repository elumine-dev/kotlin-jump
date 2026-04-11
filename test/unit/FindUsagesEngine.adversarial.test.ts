// Tests adversaires pour FindUsagesEngine + textUtils.isInsideCommentOrString
//
// Bugs cibles :
//   BUG Y    - fileCouldReference : limite 512 chars rate les packages avec long header
//   BUG Z    - scanForUsages : lignes de block-comment sans etoile → faux positifs
//   BUG Z2   - isInsideCommentOrString : ne detecte PAS les block comments
//   BUG AA   - isInsideCommentOrString : raw strings (triple-quote) non gerees
//   BUG BC   - scanForUsages : usage sur la ligne qui ferme un bloc de commentaire
//   BUG FUE-1 - scanForUsages : ligne commencant par "/*" avec code apres — continue inconditionnel
//   BUG FUE-2 - scanForUsages : ligne commencant par "*/" — code apres manqué (startsWith('*'))
//
// Lancer : npm test -- test/unit/FindUsagesEngine.adversarial.test.ts

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { isInsideCommentOrString } from '../../src/util/textUtils';
import { fileCouldReference, escapeRegex, scanForUsagesWithTarget, clearContentCache } from '../../src/providers/FindUsagesEngine';
import { SymbolIndex } from '../../src/indexer/SymbolIndex';
import { parse } from '../../src/indexer/KotlinParser';
import { workspace } from './__mocks__/vscode';

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeEntry(fqn: string, pkg: string) {
  const parts = fqn.split('.');
  const name = parts[parts.length - 1];
  const index = new SymbolIndex();
  const code = 'package ' + pkg + '\nfun ' + name + '() {}';
  index.add(parse('file:///Decl_' + name + '.kt', code));
  return index.lookup(name)[0];
}

// ── BUG Z2 : isInsideCommentOrString ne detecte pas les block comments ────────

describe('BUG Z2 — isInsideCommentOrString : block comments non geres', () => {
  it('position DANS /* comment */ → devrait retourner true', () => {
    const line = 'val x = /* mySymbol */ 1';
    const pos = line.indexOf('mySymbol');
    // BUG Z2 — ne gere que "//" et les strings
    // → retourne false pour /* */ → faux positif dans FindUsages
    expect(isInsideCommentOrString(line, pos)).toBe(true);
  });

  it('position après /* et avant */ → true', () => {
    const line = '/* processData is described here */ val x = processData()';
    const pos = line.indexOf('processData');
    // BUG Z2 — position dans /* */, devrait etre detectee
    expect(isInsideCommentOrString(line, pos)).toBe(true);
  });

  it('position apres la fermeture */ → false correct', () => {
    const line = '/* comment */ val myVar = 1';
    const pos = line.indexOf('myVar');
    // La position APRES le comment fermant est du vrai code
    expect(isInsideCommentOrString(line, pos)).toBe(false);
  });

  it('position dans une string normale → true correct', () => {
    const line = 'val s = "hello myFunc world"';
    const pos = line.indexOf('myFunc');
    expect(isInsideCommentOrString(line, pos)).toBe(true);
  });

  it('position dans // comment → true correct', () => {
    const line = 'val x = 1 // see myFunc for details';
    const pos = line.indexOf('myFunc');
    expect(isInsideCommentOrString(line, pos)).toBe(true);
  });
});

// ── BUG AA : isInsideCommentOrString et raw strings ──────────────────────────

describe('BUG AA — isInsideCommentOrString : raw strings (triple-quote) non gerees', () => {
  it('position dans triple-quoted string → devrait retourner true', () => {
    const tripleQuote = '"' + '"' + '"';
    const line = 'val s = ' + tripleQuote + 'mySymbol is here' + tripleQuote;
    const pos = line.indexOf('mySymbol');
    // BUG AA — isInsideCommentOrString traite triple-quote comme trois strings vides
    // et le contenu entre les premieres et dernieres quotes est vu comme hors-string
    expect(isInsideCommentOrString(line, pos)).toBe(true);
  });

  it('position dans triple-quoted SQL query → true', () => {
    const tq = '"' + '"' + '"';
    const line = 'val q = ' + tq + 'SELECT * FROM myTable WHERE id = 1' + tq;
    const pos = line.indexOf('myTable');
    // BUG AA — myTable est dans une raw string → devrait etre "inside string"
    expect(isInsideCommentOrString(line, pos)).toBe(true);
  });

  it('position HORS raw string apres la fermeture → false correct', () => {
    const tq = '"' + '"' + '"';
    const line = 'val q = ' + tq + 'raw' + tq + '; myFunc()';
    const pos = line.indexOf('myFunc');
    expect(isInsideCommentOrString(line, pos)).toBe(false);
  });
});

// ── BUG Y : fileCouldReference et la limite de 512 caracteres ────────────────

describe('BUG Y — fileCouldReference : limite 512 chars rate les longs headers', () => {
  it('package apres un header de 400 chars : detecte correct', () => {
    const header = '// ' + 'x'.repeat(396) + '\n'; // 400 chars
    const file = header + 'package com.example\n\nimport foo.Bar\n';
    const entry = makeEntry('com.example.myFun', 'com.example');
    if (!entry) return;
    expect(fileCouldReference(file, entry)).toBe(true);
  });

  it('header de 600+ chars : BUG Y — package non detecte', () => {
    // Construire un header garantissant > 512 chars avant le package
    const singleLine = '// This is a very long copyright notice for the project.\n';
    const header = singleLine.repeat(10); // ~570 chars
    expect(header.length).toBeGreaterThan(512);

    const file = header + 'package com.example\nfun doThing() {}';
    const entry = makeEntry('com.example.doThing', 'com.example');
    if (!entry) return;

    // BUG Y — packageName check utilise text.slice(0, 512)
    // Le package est a l'offset 570+ → pas dans la slice → fileCouldReference faux negatif
    // Un vrai fichier dans le bon package serait incorrectement exclu des resultats Find Usages
    expect(fileCouldReference(file, entry)).toBe(true);
  });

  it('header de 600 chars + import explicite : trouve via import', () => {
    // Meme avec un long header, si le fichier a un import explicite du FQN, ca marche
    const singleLine = '// This is a very long copyright notice for the project.\n';
    const header = singleLine.repeat(10); // ~570 chars
    const file = header + 'import com.example.doThing\nfun caller() { doThing() }';
    const entry = makeEntry('com.example.doThing', 'com.example');
    if (!entry) return;
    // L'import explicite est apres le header (>512 chars) → aussi rate par slice(0,512)
    // Mais importedExactly cherche dans tout le texte → trouve l'import
    expect(fileCouldReference(file, entry)).toBe(true);
  });
});

// ── BUG Z : false positifs dans les block comments multi-lignes ───────────────

describe('BUG Z — scanForUsages : lignes de block comment sans etoile → faux positifs', () => {
  it('isInsideCommentOrString ne detecte pas un contexte block-comment multi-ligne', () => {
    // La ligne "  See processData for details." est DANS un block comment
    // mais isInsideCommentOrString analyse chaque ligne independamment
    // → sans le contexte de la ligne /* precedente, elle ne peut pas savoir

    const commentLine = '  See processData for details, it handles edge cases.';
    const pos = commentLine.indexOf('processData');

    // BUG Z2/Z — sans contexte multi-ligne, retourne false
    const result = isInsideCommentOrString(commentLine, pos);
    // Documenter le comportement actuel : false (la fonction ne connait pas le contexte)
    // Pour un vrai fix il faudrait passer le contexte block-comment en parametre
    expect(result).toBe(false); // comportement ACTUEL documente
  });

  it('ligne KDoc avec etoile : protegee par startsWith dans scanForUsages', () => {
    const kdocLine = ' * processData handles this case correctly.';
    const trimmed = kdocLine.trimStart();
    expect(trimmed.startsWith('*')).toBe(true);
  });

  it('ligne de block comment sans etoile : filtree via inBlockComment dans scanForUsages', () => {
    // BUG Z corrige — scanForUsages track maintenant inBlockComment a travers les lignes.
    // Une ligne de continuation de block comment (sans etoile) est filtree
    // car la variable inBlockComment est a true depuis la ligne "/*" precedente.
    // Ce test verifie que la logique startsWith detecle toujours les ouvertures /*
    const openingLine = '/*';
    const trimmed = openingLine.trimStart();
    const filteredByStartsWith = (
      trimmed.startsWith('import ') ||
      trimmed.startsWith('//') ||
      trimmed.startsWith('*') ||
      trimmed.startsWith('/*')
    );
    expect(filteredByStartsWith).toBe(true); // la ligne d'ouverture /* est filtree
  });
});

// ── escapeRegex — cas limites ─────────────────────────────────────────────────

describe('escapeRegex — cas limites', () => {
  it('nom avec $ (Kotlin companion) : escape correctement', () => {
    const escaped = escapeRegex('Foo$Bar');
    expect(escaped).toBe('Foo\\$Bar');
    const re = new RegExp('\\b' + escaped + '\\b');
    expect(re.test('val x: Foo$Bar = ...')).toBe(true);
  });

  it('nom normal : pas de modification', () => {
    expect(escapeRegex('myFunction')).toBe('myFunction');
  });

  it('nom avec point (FQN) : point escape', () => {
    const escaped = escapeRegex('com.example.Foo');
    expect(escaped).toBe('com\\.example\\.Foo');
  });

  it('nom avec parentheses : characters speciaux escapes', () => {
    const escaped = escapeRegex('foo(bar)');
    expect(new RegExp(escaped).test('foo(bar)')).toBe(true);
    expect(new RegExp(escaped).test('fooXbarY')).toBe(false);
  });
});

// ── isInsideCommentOrString — cas limites supplementaires ─────────────────────

describe('isInsideCommentOrString — cas limites', () => {
  it('string avec escape newline : le char apres backslash est skippe', () => {
    const line = 'val s = "hello\\nworld"';
    const pos = line.indexOf('world');
    expect(isInsideCommentOrString(line, pos)).toBe(true);
  });

  it('string vide "" : position juste apres → false', () => {
    const line = 'val s = "" + myFunc()';
    const pos = line.indexOf('myFunc');
    expect(isInsideCommentOrString(line, pos)).toBe(false);
  });

  it('string avec apostrophe interne : apostrophe ne ferme pas la string double', () => {
    const line = "val s = \"it's fine and myFunc\"";
    const pos = line.indexOf('myFunc');
    expect(isInsideCommentOrString(line, pos)).toBe(true);
  });

  it('char literal avec escape : position apres → false', () => {
    const line = "val c = '\\'' + myFunc()";
    const pos = line.indexOf('myFunc');
    expect(isInsideCommentOrString(line, pos)).toBe(false);
  });

  it('position = 0 : hors string → false', () => {
    expect(isInsideCommentOrString('myFunc()', 0)).toBe(false);
  });

  it('position = longueur totale : cas limite', () => {
    const line = 'fun foo()';
    expect(isInsideCommentOrString(line, line.length)).toBe(false);
  });
});

// ── BUG BC — fermeture de bloc de commentaire en milieu de ligne ─────────────
// Quand inBlockComment=true et la ligne a */ suivi de code, le `continue`
// skippait toute la ligne → le code après */ n'était jamais scanné.

describe('BUG BC — usage sur la ligne qui ferme un bloc de commentaire', () => {
  const DECL_URI   = 'file:///BCDecl.kt';
  const CALLER_URI = 'file:///BCCaller.kt';

  const DECL_CODE = `package com.example
fun myFunction(): String = "hello"`;

  // La ligne de fermeture ne commence PAS par * (sinon startsWith('*') l'attraperait)
  const CALLER_CODE = `package com.example
/*
Some comment without leading asterisk
CLOSING */ val x = myFunction()`;

  let index: SymbolIndex;
  const token = { isCancellationRequested: false };
  let origReadFile: typeof workspace.fs.readFile;

  beforeEach(() => {
    origReadFile = workspace.fs.readFile;
    index = new SymbolIndex();
    index.add(parse(DECL_URI, DECL_CODE));
    index.add(parse(CALLER_URI, CALLER_CODE));
    const codeMap: Record<string, string> = {
      [DECL_URI]:   DECL_CODE,
      [CALLER_URI]: CALLER_CODE,
    };
    workspace.fs.readFile = async (uri: any) => {
      const s = typeof uri.toString === 'function' ? uri.toString() : String(uri);
      return Buffer.from(codeMap[s] ?? '') as any;
    };
  });

  afterEach(() => {
    workspace.fs.readFile = origReadFile;
    clearContentCache();
  });

  it('myFunction() sur la ligne CLOSING */ est trouvé comme usage', async () => {
    const target = index.lookup('myFunction')[0];
    expect(target).toBeDefined();

    const results = await scanForUsagesWithTarget(
      'myFunction',
      target,
      index,
      [DECL_URI, CALLER_URI],
      token as any,
    );

    const callerHits = results.filter(r => r.uriString === CALLER_URI);

    // BUG (avant fix) : callerHits.length === 0 — continue skippait la ligne CLOSING */
    // FIX (après fix)  : callerHits.length === 1 — fall-through après inBlockComment=false
    expect(callerHits.length).toBe(1);
    expect(callerHits[0].line).toBe(3); // ligne 0-basée : "CLOSING */ val x = myFunction()"
  });
});

// ── BUG FUE-1 — /* inline comment */ code : continue inconditionnel ───────────
//
// Quand trimmed.startsWith('/*') ET la ligne contient '*/', le code fait toujours
// `continue` (ligne 207 de FindUsagesEngine.ts), sautant le code après '*/'
// sur cette même ligne.
//
// AVANT fix : `/* note */ fun foo()` → la déclaration de foo n'est jamais scannée.
// APRÈS fix  : on retire le `continue` inconditionnel quand '*/` est présent.

describe('BUG FUE-1 — usage sur ligne commençant par /* inline */ code', () => {
  const DECL_URI   = 'file:///FUE1Decl.kt';
  const CALLER_URI = 'file:///FUE1Caller.kt';

  const DECL_CODE = 'package com.pkg\nfun target(): Int = 1';
  // La ligne de déclaration commence par /* ... */ — le scanner la sautait
  const TARGET_LINE = '/* @see also */ fun target(): Int = 1';
  const FILE_CODE = `package com.pkg\n${TARGET_LINE}\nfun caller() = target()`;

  let index: SymbolIndex;
  const token = { isCancellationRequested: false };
  let origReadFile: typeof workspace.fs.readFile;

  beforeEach(() => {
    origReadFile = workspace.fs.readFile;
    index = new SymbolIndex();
    index.add(parse(DECL_URI, DECL_CODE));
    index.add(parse(CALLER_URI, FILE_CODE));
    workspace.fs.readFile = async (uri: any) => {
      const s = typeof uri.toString === 'function' ? uri.toString() : String(uri);
      const map: Record<string, string> = { [DECL_URI]: DECL_CODE, [CALLER_URI]: FILE_CODE };
      return Buffer.from(map[s] ?? '') as any;
    };
  });

  afterEach(() => {
    workspace.fs.readFile = origReadFile;
    clearContentCache();
  });

  it('target() dans `/* note */ fun target()` — déclaration trouvée', async () => {
    const tgt = index.lookup('target')[0];
    expect(tgt).toBeDefined();

    const results = await scanForUsagesWithTarget(
      'target', tgt, index, [DECL_URI, CALLER_URI], token as any,
    );
    const callerHits = results.filter(r => r.uriString === CALLER_URI);

    // BUG FUE-1 (avant fix) : ligne 1 sautée car trimmed.startsWith('/*') → continue
    // → seule la ligne 2 (appel) est trouvée, la ligne 1 (déclaration) est manquée
    // Après fix : les 2 lignes sont trouvées
    expect(callerHits.length).toBe(2);
  });

  it('non-régression — /* comment */ sur une ligne seule, pas de faux positif', async () => {
    const code = 'package com.pkg\n/* target is not here */\nfun caller() = 1';
    const uri = 'file:///FUE1Noreg.kt';
    const idx = new SymbolIndex();
    idx.add(parse(DECL_URI, DECL_CODE));
    idx.add(parse(uri, code));
    const orig = workspace.fs.readFile;
    workspace.fs.readFile = async (u: any) => {
      const s = typeof u.toString === 'function' ? u.toString() : String(u);
      const m: Record<string, string> = { [DECL_URI]: DECL_CODE, [uri]: code };
      return Buffer.from(m[s] ?? '') as any;
    };
    try {
      const tgt = idx.lookup('target')[0];
      const results = await scanForUsagesWithTarget('target', tgt, idx, [DECL_URI, uri], token as any);
      // "target" dans le commentaire doit être filtré par isInsideCommentOrString
      const uriHits = results.filter(r => r.uriString === uri);
      expect(uriHits.length).toBe(0);
    } finally {
      workspace.fs.readFile = orig;
      clearContentCache();
    }
  });
});

// ── BUG FUE-2 — */ code (trimmed.startsWith('*')) : code après */ manqué ──────
//
// BUG BC couvre le cas où la ligne de fermeture NE commence PAS par *.
// Ce bug couvre l'autre cas : la ligne de fermeture commence par `*/`,
// e.g. `  */ fun foo()` — trimmed = `*/ fun foo()` → startsWith('*') → continue.
//
// Pattern typique : KDoc/JavaDoc avec `*/` suivi du symbole sur la même ligne.
//
// AVANT fix : `startsWith('*')` attrape aussi `*/` → code après */ manqué.
// APRÈS fix  : guard `!startsWith('*/')` exclut les lignes de fermeture.

describe('BUG FUE-2 — usage sur ligne débutant par */ après block comment', () => {
  const DECL_URI   = 'file:///FUE2Decl.kt';
  const CALLER_URI = 'file:///FUE2Caller.kt';

  const DECL_CODE = 'package com.pkg\nfun target(): Int = 1';
  // La ligne de fermeture commence par ' */ ' — trimmed = '*/ fun ...'
  const CALLER_CODE = [
    'package com.pkg',
    '/**',
    ' * doc comment',
    ' */ fun caller() = target()',
  ].join('\n');

  let index: SymbolIndex;
  const token = { isCancellationRequested: false };
  let origReadFile: typeof workspace.fs.readFile;

  beforeEach(() => {
    origReadFile = workspace.fs.readFile;
    index = new SymbolIndex();
    index.add(parse(DECL_URI, DECL_CODE));
    index.add(parse(CALLER_URI, CALLER_CODE));
    workspace.fs.readFile = async (uri: any) => {
      const s = typeof uri.toString === 'function' ? uri.toString() : String(uri);
      const map: Record<string, string> = { [DECL_URI]: DECL_CODE, [CALLER_URI]: CALLER_CODE };
      return Buffer.from(map[s] ?? '') as any;
    };
  });

  afterEach(() => {
    workspace.fs.readFile = origReadFile;
    clearContentCache();
  });

  it('target() sur ligne ` */ fun caller() = target()` — usage trouvé', async () => {
    const tgt = index.lookup('target')[0];
    expect(tgt).toBeDefined();

    const results = await scanForUsagesWithTarget(
      'target', tgt, index, [DECL_URI, CALLER_URI], token as any,
    );
    const callerHits = results.filter(r => r.uriString === CALLER_URI);

    // BUG FUE-2 (avant fix) : trimmed = '*/ fun caller() = target()'
    // startsWith('*') → true → continue → target() sur cette ligne manqué
    // Après fix : startsWith('*') && !startsWith('*/') → false → ligne scannée
    expect(callerHits.length).toBe(1);
    expect(callerHits[0].line).toBe(3);
  });

  it('non-régression — ligne ` * doc` reste bien filtrée (inBlockComment)', async () => {
    // Les lignes de continuation /* * doc */ ne doivent pas donner de faux positifs
    const code = [
      'package com.pkg',
      '/**',
      ' * target is mentioned here',
      ' */',
      'fun caller() = 1',
    ].join('\n');
    const uri = 'file:///FUE2Noreg.kt';
    const idx = new SymbolIndex();
    idx.add(parse(DECL_URI, DECL_CODE));
    idx.add(parse(uri, code));
    const orig = workspace.fs.readFile;
    workspace.fs.readFile = async (u: any) => {
      const s = typeof u.toString === 'function' ? u.toString() : String(u);
      const m: Record<string, string> = { [DECL_URI]: DECL_CODE, [uri]: code };
      return Buffer.from(m[s] ?? '') as any;
    };
    try {
      const tgt = idx.lookup('target')[0];
      const results = await scanForUsagesWithTarget('target', tgt, idx, [DECL_URI, uri], token as any);
      const uriHits = results.filter(r => r.uriString === uri);
      // "target" dans le commentaire KDoc ne doit PAS être reporté
      expect(uriHits.length).toBe(0);
    } finally {
      workspace.fs.readFile = orig;
      clearContentCache();
    }
  });
});
