import { describe, it, expect } from 'vitest';
import { importOrNull } from '../kj/harness';

/**
 * G11 — un `buildConfigField` declare dans Gradle et que rien ne lit.
 *
 * Voir doc/gaps-detection.md.
 *
 * ## Le cas reel
 *
 * `s:50`
 *
 *     buildConfigField("boolean", "GTM_ENABLED", "true")
 *
 * La chaine `GTM_ENABLED` n apparait qu une seule fois dans tout le corpus :
 * cette ligne. Aucun `BuildConfig.GTM_ENABLED`, aucune mention nulle part.
 * Le champ est genere dans chaque variante, compile, embarque dans l APK, et
 * personne ne le lit.
 *
 * Mesure : 34 `buildConfigField` declares sur le projet de reference, 1 mort.
 * C est peu, mais c est un cas franc, et la famille est entierement invisible.
 *
 * ## Pourquoi le detecteur passe a cote
 *
 * Il n y a aucun detecteur. `grep -rn "buildConfigField\\|BuildConfig\\." src/`
 * ne rend rien : ni `unusedGradleDependencies`, qui lit pourtant les memes
 * fichiers `.gradle.kts` mais n y cherche que des alias de catalogue, ni
 * `unusedRemoteConfigKeys`, qui traite des cles Firebase. La famille n existe
 * pas.
 *
 * ## Deux blocs, deux regimes
 *
 * Le premier bloc s execute contre l API qui existe deja et fixe l etat
 * d aujourd hui. Le second decrit le contrat du detecteur a ecrire ; il est
 * skippe tant que le module n existe pas, ce qui est la convention du harnais
 * KJ (voir: « tant que le module n existe pas,
 * `importOrNull` retourne null et la suite est skippee »). Les corps de tests
 * sont le contrat, ne pas les transformer en `.todo`.
 */

const gradle: any = await importOrNull('src/providers/unusedGradleDependencies');
const futur: any = await importOrNull('src/providers/unusedBuildConfigFields');

const f = (path: string, text: string) => ({ path, text });

// ── Fixtures, reduites de s ──────────────────────

/** Un champ lu, un champ mort, dans le meme bloc : le temoin est interne. */
const BUILD = f('/w/app/build.gradle.kts', [
  'android {',
  '    defaultConfig {',
  '        buildConfigField("boolean", "GTM_ENABLED", "true")',
  '        buildConfigField("String", "API_HOST", "\\"https://x\\"")',
  '    }',
  '}',
  '',
].join('\n'));

const LECTEUR = f('/w/app/src/main/java/com/x/Api.kt', [
  'package com.x',
  '',
  'class Api {',
  '    fun host() = BuildConfig.API_HOST',
  '}',
  '',
].join('\n'));

describe.skipIf(!gradle)('G11 — ce que les detecteurs actuels en disent', () => {
  /**
   * SENTINELLE. Le detecteur qui lit ces fichiers ne cherche que des alias de
   * catalogue ; il ne voit donc ni le champ mort ni le champ vivant. Si ce
   * test se met a echouer, quelqu un a etendu la famille Gradle et l entree
   * G11 du document doit etre relue.
   */
  it('aujourd hui, le detecteur Gradle ignore les buildConfigField', () => {
    const trouves = gradle.findUnusedGradleDependencies({
      sources: [BUILD, LECTEUR],
    }) as any[];
    expect(trouves.map(a => a.name ?? a.alias)).not.toContain('GTM_ENABLED');
    expect(trouves.map(a => a.name ?? a.alias)).not.toContain('API_HOST');
  });

  /**
   * Le seul cas ROUGE de ce fichier, et il est volontairement neutre sur le
   * design : peu importe quel module accueillera la famille, il faut qu UN
   * detecteur du depot voie ce champ. Aujourd hui aucun ne le voit, donc ce
   * test echoue, et c est le verdict honnete. Les dix cas du second bloc
   * decrivent le contrat en detail mais restent skippes tant que le module
   * n existe pas : ils ne prouvent rien aujourd hui.
   */
  it.fails('un detecteur du depot devrait voir GTM_ENABLED', () => {
    const trouves = gradle.findUnusedGradleDependencies({
      sources: [BUILD, LECTEUR],
    }) as any[];
    expect(trouves.map(a => a.name ?? a.alias)).toContain('GTM_ENABLED');
  });

  it('aujourd hui, aucun module de src ne nomme buildConfigField', () => {
    // Verifie a la main avant d ecrire ce fichier :
    //   grep -rn "buildConfigField\|BuildConfig\." src/providers src/commands
    // ne rend rien. Ce test garde la trace de cette mesure ; il n a pas
    // d equivalent executable, d ou la forme d une assertion sur le module
    // futur, qui n existe pas encore.
    expect(futur).toBeNull();
  });
});

describe.skipIf(!futur)('G11 — le contrat du detecteur a ecrire', () => {
  const champs = (...sources: { path: string; text: string }[]) =>
    futur.findUnusedBuildConfigFields({ sources }) as any[];

  const nomme = (trouves: any[], nom: string) => trouves.some(c => c.name === nom);

  it('rapporte un champ que rien ne lit', () => {
    expect(nomme(champs(BUILD, LECTEUR), 'GTM_ENABLED')).toBe(true);
  });

  it('donne le fichier et la ligne de sa declaration', () => {
    const c = champs(BUILD, LECTEUR).find(x => x.name === 'GTM_ENABLED');
    expect(c).toMatchObject({ path: '/w/app/build.gradle.kts', line: 2 });
  });

  it('rapporte la forme Groovy autant que la forme Kotlin', () => {
    const groovy = f('/w/app/build.gradle', [
      'android {',
      '    defaultConfig {',
      "        buildConfigField 'boolean', 'LEGACY_FLAG', 'true'",
      '    }',
      '}',
      '',
    ].join('\n'));
    expect(nomme(champs(groovy), 'LEGACY_FLAG')).toBe(true);
  });

  it('rapporte un champ declare dans une variante et lu nulle part', () => {
    const variante = f('/w/app/build.gradle.kts', [
      'android {',
      '    buildTypes {',
      '        getByName("debug") {',
      '            buildConfigField("boolean", "DEBUG_PANEL", "true")',
      '        }',
      '    }',
      '}',
      '',
    ].join('\n'));
    expect(nomme(champs(variante), 'DEBUG_PANEL')).toBe(true);
  });

  // ── Les gardes ───────────────────────────────────────────────────────────

  it('ne touche pas un champ lu par BuildConfig.X', () => {
    expect(nomme(champs(BUILD, LECTEUR), 'API_HOST')).toBe(false);
  });

  it('ne touche pas un champ lu avec un import statique du BuildConfig', () => {
    const importe = f('/w/app/src/main/java/com/x/Api.kt', [
      'package com.x',
      '',
      'import com.x.BuildConfig.GTM_ENABLED',
      '',
      'class Api {',
      '    fun on() = GTM_ENABLED',
      '}',
      '',
    ].join('\n'));
    expect(nomme(champs(BUILD, importe), 'GTM_ENABLED')).toBe(false);
  });

  it('ne touche pas un champ lu par un fichier Java', () => {
    const java = f('/w/app/src/main/java/com/x/Api.java', [
      'package com.x;',
      '',
      'public class Api {',
      '',
      '\tboolean on() {',
      '\t\treturn BuildConfig.GTM_ENABLED;',
      '\t}',
      '}',
      '',
    ].join('\n'));
    expect(nomme(champs(BUILD, java), 'GTM_ENABLED')).toBe(false);
  });

  it('ne touche pas un champ lu seulement par un test', () => {
    const test = f('/w/app/src/test/java/com/x/ApiTest.kt', [
      'package com.x',
      '',
      'class ApiTest {',
      '    fun check() = BuildConfig.GTM_ENABLED',
      '}',
      '',
    ].join('\n'));
    const c = champs(BUILD, test).find(x => x.name === 'GTM_ENABLED');
    expect(c?.verdict).not.toBe('unreferenced');
  });

  /**
   * Un champ nomme dans un manifeste, une regle de shrinker ou un XML est lu
   * par un outil, pas par du Kotlin. Le detecteur ne peut pas trancher.
   */
  it('ne touche pas un champ nomme par un manifeste ou une regle', () => {
    const manifeste = f('/w/app/src/main/AndroidManifest.xml', [
      '<manifest>',
      '    <application>',
      '        <meta-data android:name="gtm" android:value="${GTM_ENABLED}" />',
      '    </application>',
      '</manifest>',
      '',
    ].join('\n'));
    expect(nomme(champs(BUILD, manifeste), 'GTM_ENABLED')).toBe(false);
  });

  it('se tait sur un corpus tronque, qui ne prouve aucune absence', () => {
    expect(futur.findUnusedBuildConfigFields({
      sources: [BUILD], truncated: true,
    })).toHaveLength(0);
  });
});
