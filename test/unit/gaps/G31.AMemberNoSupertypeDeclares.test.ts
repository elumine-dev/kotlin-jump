import { describe, it, expect } from 'vitest';
import { importOrNull } from '../kj/harness';

/**
 * G31 — un membre qu aucun supertype ne declare.
 *
 * Dernier filtre du recensement de `unusedMembers`. M3 ecarte tout membre d
 * une classe JAVA portant un supertype, quel qu il soit, parce que
 * `@Override` est optionnel en Java : une methode peut implementer une
 * interface sans le dire. 1238 membres.
 *
 * Le code assume ce compromis et demande explicitement le chiffre sur lequel
 * le juger (unusedMembers.ts:458-462). Le voici.
 *
 * ## La mesure, et ses trois etapes d affinage
 *
 *   1238  M3:java-supertyped
 *    184  dont toute la chaine de supertypes est declaree par le corpus
 *    170  et dont le nom n est declare par AUCUN de ces supertypes,
 *         donc qui ne peuvent PAS etre des surcharges non marquees
 *     19  moins ceux qu un XML nomme (data binding, layouts)
 *    149  moins ceux que le code nomme ailleurs
 *      2  restent
 *
 * **M3 coute deux membres.** Le compromis est donc justifie, et c est le
 * resultat le plus utile de ce fichier : une garde large qu on a mesuree et
 * qu on garde.
 *
 * ## Les deux
 *
 *       `public static void setCacheEnabled(boolean)`
 *       `CacheService` declare six methodes, aucune de ce nom. La methode est
 *       `static`, donc aucun supertype ne peut l appeler par polymorphisme, et
 *       rien dans le depot ne la nomme.
 *
 *       `UNDEFINED_MODEL`
 *
 * La meme classe avait deja livre `evictFromCaches` a G30 : deux membres
 * morts, deux filtres differents, un seul fichier.
 *
 * ## Les deux gardes que l affinage a revelees
 *
 * **Le data binding.** 19 des 170 sont des champs publics de modeles de vue,
 * nommes par un layout en `@{viewModel.key}` et jamais par du code. Exemple :
 * `AdContextOverrideKeyValueViewModel.key`
 * Ma premiere mesure les annonçait morts.
 *
 * **La chaine complete.** Comme en G30, il faut remonter TOUS les ancetres :
 * un supertype hors corpus peut declarer la methode sans qu on le sache.
 */

const memb: any = await importOrNull('src/providers/unusedMembers');

const M = '/w/app/src/main/java/com/x';
const f = (nom: string, texte: string) => ({ path: `${M}/${nom}`, text: texte });

const base = (sources: { path: string; text: string }[]) =>
  ({ sources, testSourceSets: ['/src/test/'], includeSelfOnly: false } as any);

const membre = (nom: string, ...sources: { path: string; text: string }[]) =>
  (memb.explainMembers(base(sources)) as any[]).find((m: any) => m.name === nom);

const morts = (...sources: { path: string; text: string }[]) =>
  (memb.findUnusedMembers(base(sources)) as any[]).map((m: any) => m.name);

// ── Le motif reel, reduit ───────────────────────────────────────────────────

/** app/.../common/service/CacheService.java:7, six methodes. */
const INTERFACE = f('CacheService.java', [
  'package com.x;',
  '',
  'public interface CacheService {',
  '',
  '\tvoid clear();',
  '',
  '\tvoid evictFromCaches(String netUrl);',
  '}',
  '',
].join('\n'));

/**
 * `setCacheEnabled` est `static` et ne figure dans aucune interface.
 */
const IMPLEMENTATION = f('CacheServiceImpl.java', [
  'package com.x;',
  '',
  'public class CacheServiceImpl implements CacheService {',
  '',
  '\tpublic void clear() {}',
  '',
  '\tpublic void evictFromCaches(String netUrl) {}',
  '',
  '\tpublic static void setCacheEnabled(final boolean cacheEnabled) {}',
  '}',
  '',
].join('\n'));

const APPELANT = f('Main.kt', [
  'package com.x',
  '',
  'fun main() {',
  '    CacheServiceImpl().clear()',
  '}',
  '',
].join('\n'));

// ── Temoin de bonne formation ───────────────────────────────────────────────

describe.skipIf(!memb)('le detecteur juge bien une classe Java sans supertype', () => {
  /**
   * C est exactement la population que M3 laisse passer, selon son propre
   * commentaire : « seules les classes Java sans supertype restent en jeu,
   * utilitaires et constantes ».
   */
  it('une methode statique morte y est rapportee', () => {
    const utils = f('Utils.java', [
      'package com.x;',
      '',
      'public class Utils {',
      '',
      '\tpublic static void used() {}',
      '',
      '\tpublic static void dead() {}',
      '}',
      '',
    ].join('\n'));
    const appel = f('Main.kt', 'package com.x\n\nfun main() {\n    Utils.used()\n}\n');
    expect(morts(utils, appel)).toContain('dead');
  });
});

// ── M3 ne s applique plus qu a ce qu il ne sait pas juger ──────────────────

describe.skipIf(!memb)('un supertype n eteint plus toute la classe', () => {
  /**
   * M3 dit « ce membre implemente peut-etre une interface sans le dire ».
   * `setCacheEnabled` est `static`, aucun supertype ne peut l appeler par
   * polymorphisme, et l interface ne declare pas ce nom : il n y a rien a
   * deviner.
   */
  it('la methode statique hors interface est jugee', () => {
    expect(membre('setCacheEnabled', INTERFACE, IMPLEMENTATION, APPELANT))
      .toMatchObject({ outcome: 'unreferenced' });
  });

  /**
   * Celle qui EST une implementation reste en M3, et c est exactement son
   * territoire : une methode Java qui implemente une interface SANS le dire.
   * L interface declare ce nom, donc `ancestorDecls` vaut un et la relache ne
   * s applique pas.
   *
   * Elle n a pas d `@Override`, donc M11 (la garde de contrat de KJ-073) ne la
   * voit meme pas : c est bien M3 qui la retient, et c est le cas pour lequel
   * il a ete ecrit.
   */
  it('et celle qui EST une implementation reste en M3', () => {
    expect(membre('evictFromCaches', INTERFACE, IMPLEMENTATION, APPELANT))
      .toMatchObject({ outcome: 'M3:java-supertyped' });
  });

  it('la methode statique est bien rapportee sur ce corpus', () => {
    expect(morts(INTERFACE, IMPLEMENTATION, APPELANT)).toEqual(['setCacheEnabled']);
  });

  /**
   * La meme classe SANS sa clause `implements` redevient jugeable. La seule
   * difference est le supertype, pas le contenu.
   */
  it('la meme classe sans sa clause implements redevient jugeable', () => {
    const sansClause = f('CacheServiceImpl.java', [
      'package com.x;',
      '',
      'public class CacheServiceImpl {',
      '',
      '\tpublic void clear() {}',
      '',
      '\tpublic static void setCacheEnabled(final boolean cacheEnabled) {}',
      '}',
      '',
    ].join('\n'));
    expect(morts(sansClause, APPELANT)).toContain('setCacheEnabled');
  });
});

// ── Ce que le detecteur devrait rapporter ───────────────────────────────────

describe.skipIf(!memb)('un membre qu aucun supertype ne declare est juge', () => {
  it('la methode statique hors interface est rapportee', () => {
    expect(morts(INTERFACE, IMPLEMENTATION, APPELANT)).toContain('setCacheEnabled');
  });

  /**
   * La surcharge, elle, demande la coupe LIEE de G44 : retirer
   * `evictFromCaches` en laissant sa declaration d interface ne compile pas.
   * Ce cas reste donc ouvert, et c est la meme limite qu en G30.
   */
  it.fails('la surcharge non appelee attend encore la coupe liee', () => {
    expect(morts(INTERFACE, IMPLEMENTATION, APPELANT)).toContain('evictFromCaches');
  });

  /**
   * Motif reel :
   * Une constante que l interface ne declare pas et que rien ne lit.
   */
  it('une constante hors interface est rapportee', () => {
    const iface = f('AnalyticsEditionModel.java', [
      'package com.x;',
      '',
      'public interface AnalyticsEditionModel {',
      '',
      '\tString getName();',
      '}',
      '',
    ].join('\n'));
    const impl = f('AnalyticsEditionModelImpl.java', [
      'package com.x;',
      '',
      'public class AnalyticsEditionModelImpl implements AnalyticsEditionModel {',
      '',
      '\tpublic static final String UNDEFINED_MODEL = "undefined";',
      '',
      '\tpublic String getName() { return ""; }',
      '}',
      '',
    ].join('\n'));
    const appel = f('Main.kt', 'package com.x\n\nfun main() {\n    AnalyticsEditionModelImpl().getName()\n}\n');
    expect(morts(iface, impl, appel)).toContain('UNDEFINED_MODEL');
  });
});

// ── Gardes : ce que la relache ne doit pas emporter ────────────────────────

describe.skipIf(!memb)('ce que la relache ne doit pas emporter', () => {
  const temoin = () => {
    const utils = f('Utils.java', 'package com.x;\n\npublic class Utils {\n\n\tpublic static void used() {}\n\n\tpublic static void dead() {}\n}\n');
    const appel = f('Autre.kt', 'package com.x\n\nfun autre() = Utils.used()\n');
    expect(morts(utils, appel)).toContain('dead');
  };

  /**
   * Le motif pour lequel M3 existe : une methode qui implemente une interface
   * SANS `@Override`. Rien dans le texte ne la distingue d une methode
   * ordinaire ; seule la lecture de l interface le dit.
   */
  it('une surcharge non marquee, que le supertype appelle', () => {
    temoin();
    const impl = f('Impl2.java', [
      'package com.x;',
      '',
      'public class Impl2 implements CacheService {',
      '',
      '\tpublic void clear() {}',
      '',
      '\tpublic void evictFromCaches(String netUrl) {}',
      '}',
      '',
    ].join('\n'));
    const appel = f('Main.kt', [
      'package com.x',
      '',
      'fun main() {',
      '    val c: CacheService = Impl2()',
      '    c.clear()',
      '}',
      '',
    ].join('\n'));
    expect(morts(INTERFACE, impl, appel)).not.toContain('clear');
  });

  /**
   * La garde du data binding, que l affinage a reclamee. Dix neuf des cent
   * soixante dix candidats sont des champs publics de modeles de vue, nommes
   * par un layout en `@{viewModel.key}` et jamais par du code. Motif reel :
   */
  it('un champ public que seul un layout nomme', () => {
    temoin();
    const modele = f('AdContextOverrideKeyValueViewModel.java', [
      'package com.x;',
      '',
      'public class AdContextOverrideKeyValueViewModel extends AdContextOverridePositionalViewModel {',
      '',
      '\tpublic final ObservableField<String> key = new ObservableField<>();',
      '}',
      '',
    ].join('\n'));
    const parent = f('AdContextOverridePositionalViewModel.java', [
      'package com.x;',
      '',
      'public class AdContextOverridePositionalViewModel {',
      '',
      '\tpublic int position;',
      '}',
      '',
    ].join('\n'));
    const layout = {
      path: '/w/app/src/main/res/layout/ad_override.xml',
      text: [
        '<layout xmlns:android="http://schemas.android.com/apk/res/android">',
        '    <TextView android:text="@{viewModel.key}" />',
        '</layout>',
        '',
      ].join('\n'),
    };
    const appel = f('Main.kt', 'package com.x\n\nfun main() {\n    AdContextOverrideKeyValueViewModel()\n}\n');
    expect(morts(modele, parent, layout, appel)).not.toContain('key');
  });

  /**
   * La garde de la chaine, la meme qu en G30 : un supertype hors corpus peut
   * declarer la methode sans qu on puisse le lire.
   */
  it('une chaine qui sort du corpus', () => {
    temoin();
    const impl = f('Service.java', [
      'package com.x;',
      '',
      'public class Service extends AppCompatActivity {',
      '',
      '\tpublic void onUserLeaveHint() {}',
      '}',
      '',
    ].join('\n'));
    const appel = f('Main.kt', 'package com.x\n\nfun main() {\n    Service()\n}\n');
    expect(morts(impl, appel)).not.toContain('onUserLeaveHint');
  });

  it('un corpus tronque, qui ne prouve aucune absence', () => {
    const utils = f('Utils.java', 'package com.x;\n\npublic class Utils {\n\n\tpublic static void used() {}\n\n\tpublic static void dead() {}\n}\n');
    const appel = f('Autre.kt', 'package com.x\n\nfun autre() = Utils.used()\n');
    const entier = base([utils, appel]);
    expect((memb.findUnusedMembers(entier) as any[]).length).toBeGreaterThan(0);
    expect(memb.findUnusedMembers({ ...entier, truncated: true })).toHaveLength(0);
  });
});
