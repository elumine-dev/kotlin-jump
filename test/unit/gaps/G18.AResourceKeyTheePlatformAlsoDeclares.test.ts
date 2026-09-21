import { describe, it, expect } from 'vitest';
import { importOrNull } from '../kj/harness';

/**
 * G18 — une cle de ressource que la plateforme declare aussi.
 *
 * Voir doc/gaps-detection.md. Quatrieme et dernier etage du motif de G15,
 * G16 et G17 : apres les entrees d enum, les symboles et les membres, les
 * cles de ressources.
 *
 * ## Mesure honnete : zero trouvaille manquee aujourd hui
 *
 * Le corpus contient 32 references a une ressource de la PLATEFORME :
 *
 *   android.R.string.ok                              18
 *   android.R.color.transparent                       8
 *   android.R.string.cancel                           3
 *   android.R.string.unknown                          1
 *   android.R.string.dialog_alert_title               1
 *   android.R.dimen.notification_large_icon_height    1
 *
 * Des six noms, un seul est aussi declare par le projet : `transparent`,
 * dans et
 *. Et il est bien vivant,
 * `@color/transparent` apparaissant 22 fois dans les XML du projet.
 *
 * Aucune cle n est donc perdue sur ce corpus. Le mecanisme, lui, est bien la.
 *
 * ## Le mecanisme, mesure en isolant
 *
 * Un `strings.xml` declarant `cancel` et une cle au nom unique, puis le meme
 * corpus avec differentes formes de reference :
 *
 *   les deux cles, rien ne les nomme        -> cancel, never_used_unique_key
 *   + R.string.cancel du PROJET             -> never_used_unique_key   correct
 *   + android.R.string.cancel               -> never_used_unique_key   PERDUE
 *   + AppCompatR.string.cancel              -> never_used_unique_key   PERDUE
 *
 * Les deux dernieres lignes sont des faux negatifs. `android.R.string.cancel`
 * nomme explicitement le paquet de la plateforme : c est la ressource
 * d Android, pas celle du projet, et le prefixe le dit sans ambiguite.
 *
 * Precision trouvee en ecrivant ce fichier : la forme XML equivalente,
 * `@android:string/cancel`, est DEJA traitee correctement. Le trou ne
 * concerne que la forme code, ou la qualification s ecrit en points plutot
 * qu en deux points. Le correctif a donc un modele sous la main.
 *
 * ## La famille est complete
 *
 * Quatre etages, un seul mecanisme : une mention QUALIFIEE par un autre
 * porteur compte quand meme pour le nom local.
 *
 *   G15  entrees d enum   Proxy.Type.HTTP masque UriScheme.HTTP
 *   G16  symboles          kotlin.Result masque com.x.Result
 *   G17  membres           OtherBuilder.build() masque Builder.build()
 *   G18  cles de ressource android.R.string.cancel masque R.string.cancel
 *
 * Leur gravite differe : G17 touche 59 % des membres, G15 coute une entree
 * mesuree, G16 et G18 zero aujourd hui mais la configuration a risque est
 * presente dans les deux cas.
 */

const mod: any = await importOrNull('src/providers/unusedResourceKeys');

const MAIN = '/w/app/src/main';
const f = (path: string, text: string) => ({ path, text });

const STRINGS = f(`${MAIN}/res/values/strings.xml`, [
  '<?xml version="1.0" encoding="utf-8"?>',
  '<resources>',
  '    <string name="cancel">Annuler</string>',
  '    <string name="never_used_unique_key">Jamais</string>',
  '</resources>',
  '',
].join('\n'));

const DECLARATIONS = [
  { kind: 'string', name: 'cancel', path: `${MAIN}/res/values/strings.xml`,
    moduleDir: '/w/app', start: 0, end: 0, line: 2 },
  { kind: 'string', name: 'never_used_unique_key', path: `${MAIN}/res/values/strings.xml`,
    moduleDir: '/w/app', start: 0, end: 0, line: 3 },
];

const cles = (...sources: { path: string; text: string }[]) =>
  (mod.findUnusedResourceKeys({
    declarations: DECLARATIONS,
    sources: [STRINGS, ...sources],
    modulesWithCode: ['/w/app'],
  }) as any[]).map(x => x.name).sort();

/** Le canari : une cle au nom unique, que rien ne peut masquer. */
const CANARI = 'never_used_unique_key';

const epargne = (trouves: string[], cible: string) => {
  expect(trouves).toContain(CANARI);
  expect(trouves).not.toContain(cible);
};

describe.skipIf(!mod)('G18 — le corpus de test est lisible', () => {
  it('rapporte les deux cles quand rien ne les nomme', () => {
    expect(cles()).toEqual(['cancel', CANARI]);
  });

  it('ne rapporte plus cancel quand le PROJET la reference', () => {
    const usage = f(`${MAIN}/java/com/x/Dialog.kt`, [
      'package com.x',
      '',
      'fun show() = getString(R.string.cancel)',
      '',
    ].join('\n'));
    expect(cles(usage)).toEqual([CANARI]);
  });

  /**
   * SENTINELLE. Elle fixe le trou mesure : une reference a la ressource de la
   * PLATEFORME suffit a masquer la cle du projet. Si ce test se met a
   * echouer, la qualification est prise en compte et l entree G18 du document
   * doit etre relue avec G15, G16 et G17.
   */
  it('aujourd hui, android.R.string.cancel masque la cle du projet', () => {
    const plateforme = f(`${MAIN}/java/com/x/Dialog.kt`, [
      'package com.x',
      '',
      'fun show() = getString(android.R.string.cancel)',
      '',
    ].join('\n'));
    expect(cles(plateforme)).toEqual([CANARI]);
  });
});

describe.skipIf(!mod)('G18 — la cle que la plateforme fait disparaitre', () => {
  it.fails('rapporte cancel malgre une reference a android.R.string.cancel', () => {
    const plateforme = f(`${MAIN}/java/com/x/Dialog.kt`, [
      'package com.x',
      '',
      'fun show() = getString(android.R.string.cancel)',
      '',
    ].join('\n'));
    expect(cles(plateforme)).toEqual(['cancel', CANARI]);
  });

  it.fails('la rapporte malgre un R de bibliotheque renomme par un alias', () => {
    const alias = f(`${MAIN}/java/com/x/Dialog.kt`, [
      'package com.x',
      '',
      'import androidx.appcompat.R as AppCompatR',
      '',
      'fun show() = getString(AppCompatR.string.cancel)',
      '',
    ].join('\n'));
    expect(cles(alias)).toContain('cancel');
  });

  it.fails('la rapporte quand plusieurs fichiers citent la cle de plateforme', () => {
    // Le corpus de reference compte 18 `android.R.string.ok` et 8
    // `android.R.color.transparent` : le motif se repete.
    const un = f(`${MAIN}/java/com/x/A.kt`, [
      'package com.x', '', 'fun a() = getString(android.R.string.cancel)', '',
    ].join('\n'));
    const deux = f(`${MAIN}/java/com/x/B.kt`, [
      'package com.x', '', 'fun b() = getString(android.R.string.cancel)', '',
    ].join('\n'));
    expect(cles(un, deux)).toContain('cancel');
  });
});

describe.skipIf(!mod)('G18 — les gardes, qui passent des maintenant', () => {
  /**
   * La contrepartie : resserrer la lecture ne doit pas faire disparaitre une
   * reference legitime. Supprimer une cle encore utilisee casse la
   * compilation des ressources, que le XML la nomme ou que le code la lise.
   */

  /**
   * TROUVE EN ECRIVANT CE FICHIER : la forme XML est DEJA traitee.
   *
   * Ce cas etait marque `it.fails()` et il passe. `@android:string/cancel`
   * porte le prefixe `android:`, et le detecteur ne le compte pas comme une
   * mention de la cle locale. Le trou de G18 ne concerne donc que la forme
   * CODE, `android.R.string.cancel`, ou la qualification s ecrit en points
   * plutot qu en deux points.
   *
   * C est une bonne nouvelle et une precision utile : la moitie du chemin est
   * deja faite, et le correctif a un modele sous la main.
   */
  it('ignore deja @android:string dans un XML', () => {
    const layout = f(`${MAIN}/res/layout/dialog.xml`, [
      '<?xml version="1.0" encoding="utf-8"?>',
      '<Button xmlns:android="http://schemas.android.com/apk/res/android"',
      '    android:text="@android:string/cancel" />',
      '',
    ].join('\n'));
    expect(cles(layout)).toContain('cancel');
  });

  it('ne touche pas une cle lue par R.string depuis le code', () => {
    const usage = f(`${MAIN}/java/com/x/Dialog.kt`, [
      'package com.x', '', 'fun show() = getString(R.string.cancel)', '',
    ].join('\n'));
    epargne(cles(usage), 'cancel');
  });

  it('ne touche pas une cle lue par @string depuis un XML', () => {
    // `@color/transparent` apparait 22 fois dans les XML du corpus reel.
    const layout = f(`${MAIN}/res/layout/dialog.xml`, [
      '<?xml version="1.0" encoding="utf-8"?>',
      '<Button xmlns:android="http://schemas.android.com/apk/res/android"',
      '    android:text="@string/cancel" />',
      '',
    ].join('\n'));
    epargne(cles(layout), 'cancel');
  });

  it('ne touche pas une cle lue avec le R du projet pleinement qualifie', () => {
    const usage = f(`${MAIN}/java/com/x/Dialog.kt`, [
      'package com.x', '', 'fun show() = getString(com.x.R.string.cancel)', '',
    ].join('\n'));
    epargne(cles(usage), 'cancel');
  });

  it('ne touche pas une cle lue par ButterKnife, sous R2', () => {
    const usage = f(`${MAIN}/java/com/x/Dialog.kt`, [
      'package com.x', '', 'fun show() = getString(R2.string.cancel)', '',
    ].join('\n'));
    epargne(cles(usage), 'cancel');
  });

  it('se tait sur un corpus tronque, qui ne prouve aucune absence', () => {
    expect(mod.findUnusedResourceKeys({
      declarations: DECLARATIONS, sources: [STRINGS],
      modulesWithCode: ['/w/app'], truncated: true,
    })).toHaveLength(0);
  });
});
