import { describe, it, expect } from 'vitest';
import { importOrNull } from '../kj/harness';

/**
 * G2 — un `@Module` qui n est installe dans aucun composant.
 *
 * Voir doc/gaps-detection.md. Sur le projet de reference, 175 classes portent
 * `@Module`, 134 apparaissent dans un `modules = [...]` ou un
 * `includes = [...]`, et n est
 * nomme NULLE PART : sa declaration est la seule occurrence de son nom dans
 * les 5050 fichiers du corpus.
 *
 * ## Pourquoi le detecteur passe a cote
 *
 * Mesure faite avant d ecrire ces tests, avec `explainSymbols` :
 *
 *     MainActivityV2Module  -> class / F5:@Module
 *     MainActivityV2Wiring  -> class / F5:@Module     (meme corps, autre nom)
 *
 * Ce n est donc PAS le suffixe `Module` de `FRAMEWORK_NAME_SUFFIXES` qui
 * mord ici, c est la garde des annotations etrangeres sur les declarations de
 * haut niveau : `@Module` n est pas dans `BENIGN_TOPLEVEL_ANNOTATIONS`, donc
 * la classe sort du jeu avant meme d etre comptee. Renommer la classe ne
 * change rien, ce que le deuxieme test ci dessous verrouille.
 *
 * La garde a une bonne raison d exister : un module Dagger est bien
 * instancie par du code genere que le corpus ne lit pas. Mais le code genere
 * ne l instancie QUE s il est installe, et l installation, elle, s ecrit dans
 * les sources.
 *
 * Note de fidelite: le vrai `MainActivityV2Module` porte aussi un
 * `@file:Suppress("unused")` en ligne 1, qui le protege legitimement et qu on
 * ne cherche pas a contourner. Les fixtures ci dessous n en portent pas :
 * elles isolent la garde `@Module`, qui est le seul objet de ce fichier.
 */

const mod: any = await importOrNull('src/providers/unusedSymbols');
const iles: any = await importOrNull('src/providers/deadIslands');
const memb: any = await importOrNull('src/providers/unusedMembers');

const MAIN = '/w/app/src/main/java/com/x';
const f = (path: string, text: string) => ({ path, text });

const symboles = (...sources: { path: string; text: string }[]) =>
  mod.findUnusedSymbols({ sources, testSourceSets: ['/src/test/'] }) as any[];

const nomme = (trouves: any[], nom: string) => trouves.some(s => s.name === nom);

const pourquoi = (nom: string, ...sources: { path: string; text: string }[]) =>
  (mod.explainSymbols({ sources, testSourceSets: ['/src/test/'] }) as any[])
    .find(s => s.name === nom)?.outcome;

// ── Fixtures ───────────────────────────────────────────────────────────────

/** Le corps de `MainActivityV2Module.kt`, parametre par le nom de la classe. */
const moduleNomme = (nom: string) => f(`${MAIN}/${nom}.kt`, [
  'package com.x',
  '',
  'import dagger.Module',
  'import dagger.Provides',
  '',
  '@Module',
  `class ${nom}(private val activity: Activity) {`,
  '',
  '    @Provides',
  '    fun provideActivity() = activity',
  '}',
  '',
].join('\n'));

const ORPHELIN = moduleNomme('MainActivityV2Module');

/**
 * Le canari. Une garde qui dit « ne touche pas au module installe » est vraie
 * par vacuite tant que le detecteur n en juge AUCUN. `epargne` exige donc, du
 * meme appel, que ce module orphelin soit rapporte et que la cible ne le soit
 * pas. Rouge aujourd hui, et c est le verdict honnete.
 */
const CANARI = moduleNomme('CanaryModule');

const epargne = (trouves: any[], cible: string) => {
  expect(trouves.map(s => s.name)).toContain('CanaryModule');
  expect(trouves.map(s => s.name)).not.toContain(cible);
};

/** La meme classe sans son annotation : le temoin de bonne formation. */
const SANS_ANNOTATION = f(`${MAIN}/PlainWiring.kt`, [
  'package com.x',
  '',
  'class PlainWiring(private val activity: Activity) {',
  '',
  '    fun provideActivity() = activity',
  '}',
  '',
].join('\n'));

describe.skipIf(!mod)('G2 — le corpus de test est lisible', () => {
  it('rapporte une classe de haut niveau que rien ne nomme', () => {
    expect(nomme(symboles(SANS_ANNOTATION), 'PlainWiring')).toBe(true);
  });

  /**
   * SENTINELLE. Elle fixe la cause reelle, mesuree et non supposee : c est
   * l annotation qui ecarte, pas le nom. Si ce test se met a echouer, la
   * garde a bouge et l entree G2 du document doit etre relue.
   */
  it('aujourd hui, @Module ecarte la classe quel que soit son nom', () => {
    expect(pourquoi('MainActivityV2Module', ORPHELIN)).toBe('F5:@Module');
    expect(pourquoi('MainActivityV2Wiring', moduleNomme('MainActivityV2Wiring')))
      .toBe('F5:@Module');
  });
});

describe.skipIf(!mod)('G2 — le module que personne n installe', () => {
  it.fails('rapporte un @Module dont le nom n apparait nulle part ailleurs', () => {
    expect(nomme(symboles(ORPHELIN), 'MainActivityV2Module')).toBe(true);
  });

  it.fails('rapporte la forme Java, une classe @Module jamais listee', () => {
    const java = f(`${MAIN}/LegacyModule.java`, [
      'package com.x;',
      '',
      'import dagger.Module;',
      '',
      '@Module',
      'public class LegacyModule {',
      '}',
      '',
    ].join('\n'));
    expect(nomme(symboles(java), 'LegacyModule')).toBe(true);
  });
});

describe.skipIf(!mod)('G2 — les gardes, en echec tant que G2 n est pas fait', () => {
  /**
   * Chacune passe par `epargne`, qui exige le canari. Elles sont ROUGES
   * aujourd hui : rien n est protege tant que rien n est juge. Elles
   * verdiront avec l implementation, et diront alors si elle coupe un module
   * bel et bien installe.
   */

  const COMPOSANT_KOTLIN = f(`${MAIN}/AppComponent.kt`, [
    'package com.x',
    '',
    'import dagger.Component',
    '',
    '@Component(modules = [MainActivityV2Module::class])',
    'interface AppComponent',
    '',
  ].join('\n'));

  it('ne touche pas un module liste dans modules = [...] d un @Component', () => {
    epargne(symboles(ORPHELIN, COMPOSANT_KOTLIN, CANARI), 'MainActivityV2Module');
  });

  it('ne touche pas un module inclus par un autre module', () => {
    const parent = f(`${MAIN}/ParentModule.kt`, [
      'package com.x',
      '',
      'import dagger.Module',
      '',
      '@Module(includes = [MainActivityV2Module::class])',
      'class ParentModule',
      '',
    ].join('\n'));
    epargne(symboles(ORPHELIN, parent, CANARI), 'MainActivityV2Module');
  });

  it('ne touche pas un module liste a la facon Java, modules = {X.class}', () => {
    const java = f(`${MAIN}/AppComponent.java`, [
      'package com.x;',
      '',
      'import dagger.Component;',
      '',
      '@Component(modules = {MainActivityV2Module.class})',
      'public interface AppComponent {',
      '}',
      '',
    ].join('\n'));
    epargne(symboles(ORPHELIN, java, CANARI), 'MainActivityV2Module');
  });

  it('ne touche pas un module nomme par un sous composant', () => {
    const sous = f(`${MAIN}/ActivitySubcomponent.kt`, [
      'package com.x',
      '',
      'import dagger.Subcomponent',
      '',
      '@Subcomponent(modules = [MainActivityV2Module::class])',
      'interface ActivitySubcomponent',
      '',
    ].join('\n'));
    epargne(symboles(ORPHELIN, sous, CANARI), 'MainActivityV2Module');
  });

  it('ne touche pas un module que seul un test installe', () => {
    // Un module de test installe dans un composant de test est vivant : le
    // verdict attendu est `testOnly`, jamais `unreferenced`.
    const test = f('/w/app/src/test/java/com/x/TestComponent.kt', [
      'package com.x',
      '',
      'import dagger.Component',
      '',
      '@Component(modules = [MainActivityV2Module::class])',
      'interface TestComponent',
      '',
    ].join('\n'));
    const trouves = symboles(ORPHELIN, test, CANARI);
    expect(trouves.map(s => s.name)).toContain('CanaryModule');
    expect(trouves.find(s => s.name === 'MainActivityV2Module')?.verdict)
      .not.toBe('unreferenced');
  });

  /**
   * Celle ci mord DES AUJOURD HUI : elle s appuie sur la classe sans
   * annotation, que le detecteur juge deja, donc le tableau vide prouve bien
   * le contrat au lieu d etre vrai pour la mauvaise raison.
   */
  it('se tait sur un corpus tronque, qui ne prouve aucune absence', () => {
    const entier = { sources: [SANS_ANNOTATION], testSourceSets: ['/src/test/'] };
    expect(mod.findUnusedSymbols(entier).length).toBeGreaterThan(0);
    expect(mod.findUnusedSymbols({ ...entier, truncated: true })).toHaveLength(0);
  });
});


/**
 * AUCUNE AUTRE FAMILLE NE VOIT CE MOTIF, verifie.
 *
 * La meme verification que pour G4 : trois familles pourraient attraper un
 * `@Module` orphelin et ses fournitures, aucune ne le fait.
 *
 *   findDeadIslands   -> (rien)   le module n est pas un candidat d ilot
 *   findUnusedSymbols -> (rien)   F5:@Module l ecarte
 *   findUnusedMembers -> (rien)   @Provides est une annotation etrangere
 *
 * Les trois gardes qui ecartent sont differentes, et elles s empilent : meme
 * si l une tombait, les deux autres continueraient de taire le motif. C est
 * ce qui fait de G2 un trou entier plutot qu un defaut d une famille.
 */
describe.skipIf(!mod || !iles || !memb)('G2 — aucune autre famille ne couvre ce motif', () => {
  it('les ilots ne forment rien sur un module orphelin', () => {
    expect(iles.findDeadIslands({
      sources: [ORPHELIN], testSourceSets: ['/src/test/'], maxIslandSize: 8,
    })).toHaveLength(0);
  });

  it('les symboles ne rapportent rien', () => {
    expect(symboles(ORPHELIN)).toHaveLength(0);
  });

  it('les membres ne rapportent pas la fourniture non plus', () => {
    expect(memb.findUnusedMembers({
      sources: [ORPHELIN], testSourceSets: ['/src/test/'], includeSelfOnly: false,
    })).toHaveLength(0);
  });
});
