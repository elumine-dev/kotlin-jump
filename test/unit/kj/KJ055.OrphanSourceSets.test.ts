import { describe, it, expect } from 'vitest';
import { importOrNull } from './harness';

/**
 * KJ-055 — un dossier sous `src/` que Gradle ne compile jamais.
 *
 * Les noms de source sets suivent une algebre : `main`, `test`,
 * `androidTest`, puis un par build type, un par flavor, un par combinaison de
 * flavors, un par variante, chacun avec son jumeau `test` et `androidTest`.
 * Un nom que l'algebre ne peut pas produire n'est lu par personne.
 *
 * Pourquoi un outil de code mort s'en occupe : tout balayage compte ce qu'il
 * lit, et un source set orphelin est du code, donc il vote. Sur le projet de
 * reference les dossiers `savedAndroidTest` portent 149 fichiers qu'aucune
 * tache Gradle ne compile, et leurs mentions etaient la seule chose qui
 * gardait sept declarations de production en vie.
 *
 * Le detecteur se tait au moindre doute : flavors, dimensions et build types
 * sont mis en commun depuis TOUS les fichiers de build du projet, tout
 * `src/<nom>/` ecrit dans un build est legal, et un module illisible ou
 * multiplateforme est saute en entier.
 */

const mod: any = await importOrNull('src/providers/orphanSourceSets');

/** Le build de variant/app, reduit a ce que l'algebre lit. */
const APP_GRADLE = [
  'plugins { alias(libs.plugins.android.application) }',
  'android {',
  '    buildTypes {',
  '        getByName("debug") { isMinifyEnabled = false }',
  '        getByName("release") { isMinifyEnabled = true }',
  '        register("staging") { initWith(getByName("release")) }',
  '    }',
  '    flavorDimensions += listOf("app", "brand")',
  '    productFlavors {',
  '        create("variant") { dimension = "app" }',
  '        create("preview") { dimension = "app" }',
  '        create("exampleapp") { dimension = "brand" }',
  '    }',
  '    sourceSets {',
  '        getByName("test") {',
  '            kotlin.setSrcDirs(kotlin.directories + "src/sharedTest/java")',
  '        }',
  '    }',
  '}',
].join('\n');

const scan = (sources: { path: string; text: string }[], moduleDirs: string[], extra: Record<string, unknown> = {}) =>
  mod.findOrphanSourceSets({ sources, moduleDirs, ...extra });

const kt = (path: string) => ({ path, text: 'package com.x\n\nclass T\n' });

describe.skipIf(!mod)('findOrphanSourceSets', () => {
  it('savedAndroidTest est orphelin, et chaque source set de variante est legal', () => {
    // Les seize dossiers mesures sous variant/app/src. Quatorze sont produits
    // par l'algebre, `sharedTest` est cable a la main dans le build, et les
    // deux `saved*` demandent une variante qui n'existe nulle part.
    const legaux = [
      'main', 'test', 'testFixtures', 'androidTest',
      'debug', 'release', 'staging',
      'variant', 'preview', 'exampleapp',
      'variantExampleappRelease', 'previewExampleappRelease',
      'testVariant', 'testPreview',
      'testVariantExampleappRelease', 'testPreviewExampleappRelease',
      'sharedTest',
    ];
    const sources = [
      { path: '/p/variant/app/build.gradle.kts', text: APP_GRADLE },
      ...legaux.map(s => kt(`/p/variant/app/src/${s}/java/com/x/T.kt`)),
      kt('/p/variant/app/src/savedAndroidTest/java/com/x/Saved.kt'),
      kt('/p/variant/app/src/savedAndroidTest/java/com/x/Saved2.kt'),
      kt('/p/variant/app/src/savedAndroidTestExampleapp/java/com/x/SavedBrand.kt'),
    ];
    const found = scan(sources, ['/p/variant/app']);
    expect(found.map((o: any) => o.name)).toEqual(['savedAndroidTest', 'savedAndroidTestExampleapp']);
    expect(found[0].files).toHaveLength(2);
    expect(found[0].path).toBe('/p/variant/app/src/savedAndroidTest');
    expect(found[0].module).toBe('/p/variant/app');
  });

  it('la raison nomme la piece qui manque', () => {
    const found = scan([
      { path: '/p/a/build.gradle.kts', text: APP_GRADLE },
      kt('/p/a/src/savedAndroidTest/java/com/x/T.kt'),
    ], ['/p/a']);
    expect(found[0].reason).toContain('saved');
    expect(found[0].reason).not.toContain('undefined');
  });

  it('un flavor declare dans UN module protege le nom dans tous les autres', () => {
    // La raison : un plugin de convention peut ajouter le flavor, et ce que le
    // detecteur lit du module ne le dira pas. Se taire est le bon defaut.
    const found = scan([
      { path: '/p/a/build.gradle.kts', text: 'android { productFlavors { create("kiosk") { dimension = "app" } } }' },
      { path: '/p/b/build.gradle.kts', text: 'android { }' },
      kt('/p/b/src/kiosk/java/com/x/T.kt'),
      kt('/p/b/src/testKiosk/java/com/x/T2.kt'),
    ], ['/p/a', '/p/b']);
    expect(found).toEqual([]);
  });

  it('un module sans fichier de build lisible est saute en entier', () => {
    const found = scan([kt('/p/a/src/whatever/java/com/x/T.kt')], ['/p/a']);
    expect(found).toEqual([]);
  });

  it('un module multiplateforme est saute : ses source sets portent le nom de la cible', () => {
    const found = scan([
      { path: '/p/a/build.gradle.kts', text: 'plugins { kotlin("multiplatform") }' },
      kt('/p/a/src/commonMain/kotlin/com/x/T.kt'),
      kt('/p/a/src/iosArm64Main/kotlin/com/x/T2.kt'),
    ], ['/p/a']);
    expect(found).toEqual([]);
  });

  it('un module imbrique reclame son propre src', () => {
    const found = scan([
      { path: '/p/a/build.gradle.kts', text: 'android { }' },
      { path: '/p/a/b/build.gradle.kts', text: 'android { productFlavors { create("kiosk") { } } }' },
      kt('/p/a/b/src/kiosk/java/com/x/T.kt'),
      kt('/p/a/src/ghost/java/com/x/T2.kt'),
    ], ['/p/a', '/p/a/b']);
    expect(found.map((o: any) => o.path)).toEqual(['/p/a/src/ghost']);
  });

  it('les dossiers sous src qui ne sont pas des source sets ne sont pas signales', () => {
    const found = scan([
      { path: '/p/a/build.gradle.kts', text: 'android { }' },
      { path: '/p/a/src/proto/x.kt', text: 'package com.x\n' },
      { path: '/p/a/src/sqldelight/y.kt', text: 'package com.x\n' },
    ], ['/p/a']);
    expect(found).toEqual([]);
  });

  it('un corpus tronque ne prouve rien', () => {
    const found = scan([
      { path: '/p/a/build.gradle.kts', text: 'android { }' },
      kt('/p/a/src/ghost/java/com/x/T.kt'),
    ], ['/p/a'], { truncated: true });
    expect(found).toEqual([]);
  });

  it('le resume compte ce qu il y a, et rien quand il n y a rien', () => {
    expect(mod.orphanSummary([])).toBe('No orphan source set: every directory under src/ belongs to a variant.');
    expect(mod.orphanSummary([{ files: ['a', 'b'] }, { files: ['c'] }]))
      .toBe('2 orphan source sets Gradle never compiles, 3 files.');
  });
});
