/**
 * Tests adversariaux pour RResourceIndex.
 *
 * Bugs ciblés / comportements à vérifier :
 *
 *   ADV-RR-1  Même clé présente N fois dans le même fichier → N entrées indexées,
 *             toutes supprimées proprement par removeFile sans affecter les autres fichiers.
 *
 *   ADV-RR-2  Suppression partielle : deux fichiers partagent la même clé,
 *             supprimer l'un laisse l'autre intact.
 *
 *   ADV-RR-3  Transition de contenu : old_key → new_key sur reindexFile.
 *             old_key doit disparaître, new_key doit apparaître.
 *
 *   ADV-RR-4  Fichier sans usages R : removeFile ultérieure est un no-op sans crash.
 *             `byFile` ne conserve PAS d'entrée vide.
 *
 *   ADV-RR-5  Deux tokens sur la même ligne : positions de caractère correctes.
 *
 *   ADV-RR-6  Séparation de types : string/plurals/array partagent un même nom de clé
 *             mais vivent dans des maps séparées.
 *
 *   ADV-RR-7  Idempotence complète : reindexFile × 3 = même résultat que × 1.
 *
 *   ADV-RR-8  R.string dans un commentaire `//` → faux positif documenté.
 *             (comportement actuel connu — test de régression pour éviter un fix silencieux)
 *
 *   ADV-RR-9  Numéros de ligne 0-indexed : ligne 0, 1, 2… vérifiés.
 *
 *   ADV-RR-10 Suppression d'un fichier non indexé → pas de crash.
 */

import { describe, it, expect } from 'vitest';
import { RResourceIndex } from '../../src/indexer/RResourceIndex';

const URI_A = 'file:///src/ScreenA.kt';
const URI_B = 'file:///src/ScreenB.kt';
const URI_C = 'file:///src/ScreenC.kt';

// ── ADV-RR-1 : Même clé N fois dans le même fichier ──────────────────────────

describe('ADV-RR-1 — même clé N fois dans le même fichier', () => {
  it('3 occurrences dans A + 1 dans B → 4 usages ; removeFile(A) → 1 seul restant', () => {
    const rIndex = new RResourceIndex();
    rIndex.reindexFile(URI_A, [
      'val a = R.string.foo',  // line 0, char 8
      '// line 1',
      'val b = R.string.foo',  // line 2, char 8
      '// line 3',
      'val c = R.string.foo',  // line 4, char 8
    ].join('\n'));
    rIndex.reindexFile(URI_B, 'val x = R.string.foo'); // line 0, char 8

    expect(rIndex.getUsages('string', 'foo')).toHaveLength(4);

    rIndex.removeFile(URI_A);

    const remaining = rIndex.getUsages('string', 'foo');
    expect(remaining).toHaveLength(1);
    expect(remaining[0].uri).toBe(URI_B);
    expect(remaining[0].line).toBe(0);
  });

  it('removeFile(A) avec clé duplicatée : la map ne casse pas sur la 2e itération de contrib', () => {
    // Quand contributed = [{string,x},{string,x}] et que la 1re itération de removeFile
    // supprime la map entry, la 2e itération doit gérer `arr = undefined` gracieusement.
    const rIndex = new RResourceIndex();
    rIndex.reindexFile(URI_A, 'R.string.x\nR.string.x'); // 2 occurrences → contributed a 2 entrées
    // Pas d'autre fichier → après removeFile, la clé doit être complètement absente
    rIndex.removeFile(URI_A);
    expect(rIndex.getUsages('string', 'x')).toHaveLength(0);
  });
});

// ── ADV-RR-2 : Suppression partielle ─────────────────────────────────────────

describe('ADV-RR-2 — suppression partielle (deux fichiers, même clé)', () => {
  it('removeFile(A) ne touche pas les usages de B', () => {
    const rIndex = new RResourceIndex();
    rIndex.reindexFile(URI_A, 'val a = R.string.shared');
    rIndex.reindexFile(URI_B, 'val b = R.string.shared');
    rIndex.reindexFile(URI_C, 'val c = R.string.shared');

    rIndex.removeFile(URI_B);

    const usages = rIndex.getUsages('string', 'shared');
    expect(usages).toHaveLength(2);
    expect(usages.map(u => u.uri)).toContain(URI_A);
    expect(usages.map(u => u.uri)).toContain(URI_C);
    expect(usages.map(u => u.uri)).not.toContain(URI_B);
  });

  it('removeFile sur les 3 fichiers → clé totalement absente', () => {
    const rIndex = new RResourceIndex();
    rIndex.reindexFile(URI_A, 'R.string.k');
    rIndex.reindexFile(URI_B, 'R.string.k');
    rIndex.reindexFile(URI_C, 'R.string.k');

    rIndex.removeFile(URI_A);
    rIndex.removeFile(URI_B);
    rIndex.removeFile(URI_C);

    expect(rIndex.getUsages('string', 'k')).toHaveLength(0);
  });
});

// ── ADV-RR-3 : Transition de contenu ─────────────────────────────────────────

describe('ADV-RR-3 — transition old_key → new_key sur reindexFile', () => {
  it('après mise à jour du contenu, old_key disparaît et new_key apparaît', () => {
    const rIndex = new RResourceIndex();
    rIndex.reindexFile(URI_A, 'val x = R.string.old_key');
    rIndex.reindexFile(URI_A, 'val x = R.string.new_key'); // mise à jour

    expect(rIndex.getUsages('string', 'old_key')).toHaveLength(0);
    expect(rIndex.getUsages('string', 'new_key')).toHaveLength(1);
  });

  it('fichier passant de R-usages à aucun usage : état propre', () => {
    const rIndex = new RResourceIndex();
    rIndex.reindexFile(URI_A, 'R.string.gone');
    rIndex.reindexFile(URI_A, '// plus rien');

    expect(rIndex.getUsages('string', 'gone')).toHaveLength(0);
    // removeFile ultérieur doit être un no-op sans crash
    rIndex.removeFile(URI_A);
    expect(rIndex.getUsages('string', 'gone')).toHaveLength(0);
  });

  it('cycle : R-usages → vide → R-usages → correct', () => {
    const rIndex = new RResourceIndex();
    rIndex.reindexFile(URI_A, 'R.string.cycle');
    rIndex.reindexFile(URI_A, '// vide');
    rIndex.reindexFile(URI_A, 'R.string.cycle'); // retour des usages

    expect(rIndex.getUsages('string', 'cycle')).toHaveLength(1);
    expect(rIndex.getUsages('string', 'cycle')[0].uri).toBe(URI_A);
  });
});

// ── ADV-RR-4 : Fichier sans usages R ─────────────────────────────────────────

describe('ADV-RR-4 — fichier sans usages R', () => {
  it('reindexFile sur fichier vide → getUsages retourne [], pas de crash', () => {
    const rIndex = new RResourceIndex();
    rIndex.reindexFile(URI_A, '// juste un commentaire\nfun nothing() {}');
    expect(rIndex.getUsages('string', 'anything')).toHaveLength(0);
  });

  it('removeFile sur ce fichier → no-op sans crash', () => {
    const rIndex = new RResourceIndex();
    rIndex.reindexFile(URI_A, 'fun noop() {}');
    expect(() => rIndex.removeFile(URI_A)).not.toThrow();
  });
});

// ── ADV-RR-5 : Deux tokens sur la même ligne, positions correctes ─────────────

describe('ADV-RR-5 — deux tokens sur la même ligne', () => {
  it('deux clés différentes sur une ligne → deux entrées avec les bons caractères', () => {
    const line = 'setButtons(R.string.ok, R.string.cancel)';
    //            position :  11            24
    const rIndex = new RResourceIndex();
    rIndex.reindexFile(URI_A, line);

    const ok     = rIndex.getUsages('string', 'ok');
    const cancel = rIndex.getUsages('string', 'cancel');

    expect(ok).toHaveLength(1);
    expect(ok[0].character).toBe(line.indexOf('R.string.ok'));

    expect(cancel).toHaveLength(1);
    expect(cancel[0].character).toBe(line.indexOf('R.string.cancel'));
  });

  it('deux types différents sur une ligne → séparés correctement', () => {
    const line = 'val s = R.string.foo; val p = R.plurals.foo';
    const rIndex = new RResourceIndex();
    rIndex.reindexFile(URI_A, line);

    expect(rIndex.getUsages('string', 'foo')).toHaveLength(1);
    expect(rIndex.getUsages('plurals', 'foo')).toHaveLength(1);
    expect(rIndex.getUsages('string', 'foo')[0].character).toBe(line.indexOf('R.string.foo'));
    expect(rIndex.getUsages('plurals', 'foo')[0].character).toBe(line.indexOf('R.plurals.foo'));
  });
});

// ── ADV-RR-6 : Séparation de types ────────────────────────────────────────────

describe('ADV-RR-6 — séparation de types (string / plurals / array)', () => {
  it('même nom de clé dans les 3 types → 3 maps indépendantes', () => {
    const rIndex = new RResourceIndex();
    rIndex.reindexFile(URI_A, [
      'val s = R.string.x',
      'val p = R.plurals.x',
      'val a = R.array.x',
    ].join('\n'));

    expect(rIndex.getUsages('string',  'x')).toHaveLength(1);
    expect(rIndex.getUsages('plurals', 'x')).toHaveLength(1);
    expect(rIndex.getUsages('array',   'x')).toHaveLength(1);

    // removeFile ne doit supprimer que les entrées de ce fichier dans les 3 maps
    rIndex.removeFile(URI_A);
    expect(rIndex.getUsages('string',  'x')).toHaveLength(0);
    expect(rIndex.getUsages('plurals', 'x')).toHaveLength(0);
    expect(rIndex.getUsages('array',   'x')).toHaveLength(0);
  });
});

// ── ADV-RR-7 : Idempotence complète ──────────────────────────────────────────

describe('ADV-RR-7 — idempotence de reindexFile', () => {
  it('reindexFile × 3 = résultat identique à × 1', () => {
    const code = 'val x = R.string.foo\nval y = R.array.bar';
    const rIndex = new RResourceIndex();
    rIndex.reindexFile(URI_A, code);
    rIndex.reindexFile(URI_A, code);
    rIndex.reindexFile(URI_A, code);

    expect(rIndex.getUsages('string', 'foo')).toHaveLength(1);
    expect(rIndex.getUsages('array',  'bar')).toHaveLength(1);
  });
});

// ── ADV-RR-8 : Faux positif — R.string dans un commentaire `//` ──────────────

describe('ADV-RR-8 — faux positif connu : R.string dans un commentaire //', () => {
  it('// R.string.commented est indexé (comportement actuel — faux positif documenté)', () => {
    const rIndex = new RResourceIndex();
    rIndex.reindexFile(URI_A, '// TODO: use R.string.commented\nval x = R.string.real');

    // La ligne commentée EST indexée — c'est un faux positif connu.
    // Ce test sert de régression : si quelqu'un fixe silencieusement ce comportement,
    // le test doit être mis à jour avec la nouvelle attente.
    const usages = rIndex.getUsages('string', 'commented');
    expect(usages).toHaveLength(1); // faux positif attendu

    // La ligne réelle est aussi indexée
    expect(rIndex.getUsages('string', 'real')).toHaveLength(1);
  });
});

// ── ADV-RR-9 : Numéros de ligne 0-indexed ────────────────────────────────────

describe('ADV-RR-9 — numéros de ligne 0-indexed', () => {
  it('premier usage sur ligne 0, second sur ligne 3', () => {
    const rIndex = new RResourceIndex();
    rIndex.reindexFile(URI_A, [
      'R.string.first',   // line 0
      '// skip',           // line 1
      '// skip',           // line 2
      'R.string.third',   // line 3
    ].join('\n'));

    expect(rIndex.getUsages('string', 'first')[0].line).toBe(0);
    expect(rIndex.getUsages('string', 'third')[0].line).toBe(3);
  });
});

// ── ADV-RR-10 : removeFile sur URI jamais indexé ──────────────────────────────

describe('ADV-RR-10 — removeFile sur URI jamais indexé', () => {
  it('aucun crash, aucun effet de bord', () => {
    const rIndex = new RResourceIndex();
    rIndex.reindexFile(URI_A, 'R.string.safe');
    expect(() => rIndex.removeFile('file:///nonexistent.kt')).not.toThrow();
    // L'entrée de A reste intacte
    expect(rIndex.getUsages('string', 'safe')).toHaveLength(1);
  });
});
