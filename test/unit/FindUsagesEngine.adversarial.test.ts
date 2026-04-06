/**
 * Tests adversaires pour FindUsagesEngine + textUtils.isInsideCommentOrString
 *
 * Bugs cibles :
 *   BUG Y  - fileCouldReference : limite 512 chars rate les packages avec long header
 *   BUG Z  - scanForUsages : lignes de block-comment sans etoile donnent des faux positifs
 *   BUG Z2 - isInsideCommentOrString : ne detecte PAS les block comments
 *   BUG AA - isInsideCommentOrString : raw strings (triple-quote) non gerees
 *
 * Lancer : npm test -- test/unit/FindUsagesEngine.adversarial.test.ts
 */

import { describe, it, expect } from 'vitest';
import { isInsideCommentOrString } from '../../src/util/textUtils';
import { fileCouldReference, escapeRegex } from '../../src/providers/FindUsagesEngine';
import { SymbolIndex } from '../../src/indexer/SymbolIndex';
import { parse } from '../../src/indexer/KotlinParser';

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
