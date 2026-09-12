/**
 * Le `?` d un glob n etait traduit nulle part, et il fait tomber la commande.
 *
 * Six reglages disent « globs allowed » dans leur description. Trois copies de
 * la meme traduction les servaient, et aucune ne lisait `?`. Laisse tel quel,
 * le caractere reste un quantificateur d expression reguliere : il rend
 * optionnelle la lettre qui le precede. Un motif `**​/Test?.kt` faisait donc
 * exactement l inverse de ce qu il annonce des DEUX cotes, il sortait
 * `Test.kt` du rapport et y laissait `Test1.kt`.
 *
 * Pire, un `?` sans rien devant ne compile pas. `?.kt` leve un SyntaxError qui
 * traverse `findUnusedSymbols` sans etre rattrape : dans la commande
 * d ensemble, la levee emporte les neuf autres detecteurs avec elle.
 *
 * Le reglage voisin, `kotlinJump.excludePatterns`, passe par picomatch et lit
 * `?` correctement depuis toujours. Deux reglages qui promettent des globs et
 * n en parlent pas le meme : c est la divergence qui fabrique le defaut.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import * as path from 'node:path';
import { matchesGlob } from '../../src/util/glob';
import { matchesGlob as viaProvider } from '../../src/providers/unusedSymbols';
import { findUnusedRemoteConfigKeys } from '../../src/providers/unusedRemoteConfigKeys';

describe('matchesGlob - le point d interrogation', () => {
  it('couvre exactement un caractere', () => {
    expect(matchesGlob('Test1.kt', '**/Test?.kt')).toBe(true);
    expect(matchesGlob('a/b/TestA.kt', '**/Test?.kt')).toBe(true);
    expect(matchesGlob('Test.kt', '**/Test?.kt')).toBe(false);
    expect(matchesGlob('Test12.kt', '**/Test?.kt')).toBe(false);
  });

  it('ne rend pas optionnelle la lettre qui le precede', () => {
    // Le symptome exact de la version fautive : `t?` lisait « t facultatif ».
    expect(matchesGlob('Tes.kt', 'Test?.kt')).toBe(false);
  });

  it('un motif qui commence par lui ne fait plus lever', () => {
    expect(() => matchesGlob('x.kt', '?.kt')).not.toThrow();
    expect(matchesGlob('x.kt', '?.kt')).toBe(true);
    expect(matchesGlob('ab.kt', '?.kt')).toBe(false);
    expect(() => matchesGlob('a/b.kt', '?*.kt')).not.toThrow();
  });

  it('ne traverse pas un separateur', () => {
    expect(matchesGlob('a/c', 'a?c')).toBe(false);
    expect(matchesGlob('abc', 'a?c')).toBe(true);
  });

  it('temoin : le prefixe `**` garde ses zero repertoires', () => {
    // La forme `(?:.*/)?` porte un `?` a elle : le remplacer trop tot en
    // faisait une classe de caracteres et cassait ce cas la.
    expect(matchesGlob('buildSrc/src/Conv.kt', '**/buildSrc/**')).toBe(true);
    expect(matchesGlob('sub/buildSrc/Conv.kt', '**/buildSrc/**')).toBe(true);
    expect(matchesGlob('Foo.kt', '**/*.kt')).toBe(true);
  });

  it('temoin : une etoile seule ne traverse toujours pas un separateur', () => {
    expect(matchesGlob('a/Foo.kt', '*.kt')).toBe(false);
  });

  it('les symboles, les membres et les ilots lisent le meme traducteur', () => {
    expect(viaProvider).toBe(matchesGlob);
  });

  it('un nom de cle Remote Config repond au `?` de bout en bout', () => {
    const xml = [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<defaults>',
      ...['ab_test_1', 'ab_test_12'].flatMap(k => [
        '    <entry>', `        <key>${k}</key>`, '        <value>v</value>', '    </entry>',
      ]),
      '</defaults>',
    ].join('\n');
    const sources = [{ path: '/w/app/src/main/res/xml/remote_config_defaults.xml', text: xml }];
    const noms = (ignoreNames: string[]) =>
      findUnusedRemoteConfigKeys({ sources, ignoreNames } as never).map(k => k.name);
    expect(noms([])).toEqual(['ab_test_1', 'ab_test_12']);
    // Un seul caractere : la cle a deux chiffres reste signalee.
    expect(noms(['ab_test_?'])).toEqual(['ab_test_12']);
    expect(noms(['ab_test_*'])).toEqual([]);
  });
});

describe('une seule traduction de glob dans le source', () => {
  it('aucun fournisseur ne recopie la sienne', () => {
    // Trois copies vivaient cote a cote et aucune ne connaissait `?`. La
    // quatrieme ne doit pas naitre en silence.
    const depot = path.resolve(__dirname, '..', '..');
    const TRADUIT = /\.replace\(\/\\\*\/g,/;
    const copies: string[] = [];
    const walk = (dir: string): void => {
      for (const nom of readdirSync(dir)) {
        const complet = path.join(dir, nom);
        if (statSync(complet).isDirectory()) { walk(complet); continue; }
        if (!nom.endsWith('.ts')) continue;
        const rel = path.relative(depot, complet).split(path.sep).join('/');
        if (rel === 'src/util/glob.ts') continue;
        // `tools:keep` est le dialecte d AAPT, pas celui des reglages : les
        // noms de ressources n ont pas de separateur, donc `*` y vaut bien
        // `.*`. Son motif d entree, `[\\w*]+`, refuse deja un `?` au lieu de
        // le traduire ; zero occurrence de `tools:keep` sur le projet reel.
        if (rel === 'src/util/xmlRefs.ts') continue;
        if (TRADUIT.test(readFileSync(complet, 'utf8'))) copies.push(rel);
      }
    };
    walk(path.join(depot, 'src'));
    expect(copies, 'importer matchesGlob de src/util/glob.ts').toEqual([]);
  });
});
