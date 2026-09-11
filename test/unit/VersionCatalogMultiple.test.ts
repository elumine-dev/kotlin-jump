/**
 * Deux catalogues de versions dans le meme dossier `gradle/`.
 *
 * Gradle le permet, et c'est meme la facon recommandee de separer les
 * dependances de test :
 *
 *   versionCatalogs {
 *     create("libs")     { from(files("gradle/libs.versions.toml")) }
 *     create("testLibs") { from(files("gradle/testLibs.versions.toml")) }
 *   }
 *
 * Jusqu'a v1.42.126 la question ne se posait pas : le balayage ne ramassait
 * que `libs.versions.toml`. v1.42.127 a elargi ce balayage a
 * `*.versions.toml`, donc les deux arrivent maintenant dans l'index, et
 * `catalogFor` n'en rend qu'UN : les deux partagent le meme dossier projet,
 * donc le premier lu gagne et l'autre devient injoignable. Selon l'ordre de
 * `findFiles`, cela pouvait faire perdre `libs` lui meme, qui marchait avant.
 *
 * Second defaut du meme lot : le survol n'a jamais lu `rootFor`, son motif
 * est fige sur `libs`. Les notes de v1.42.127 annoncaient pourtant que le
 * survol suivait le nom du fichier.
 */
import { describe, it, expect } from 'vitest';
import { VersionCatalogIndex } from '../../src/indexer/VersionCatalogIndex';
import { VersionCatalogDefinitionProvider } from '../../src/providers/VersionCatalogDefinitionProvider';
import { VersionCatalogHoverProvider } from '../../src/providers/VersionCatalogHoverProvider';
import { Position } from './__mocks__/vscode';

const NL = String.fromCharCode(10);

const LIBS = ['[versions]', 'kotlin = "2.0.21"', '', '[libraries]',
  'retrofit = { module = "com.squareup.retrofit2:retrofit", version.ref = "kotlin" }',
  // Meme nom d'alias des deux cotes, coordonnees differentes : c'est le seul
  // cas ou consulter le mauvais catalogue donne une reponse, mais FAUSSE.
  'coroutines = { module = "org.jetbrains.kotlinx:kotlinx-coroutines-core", version.ref = "kotlin" }'].join(NL);
const TEST_LIBS = ['[versions]', 'junit = "5.10.0"', '', '[libraries]',
  'jupiter = { module = "org.junit.jupiter:junit-jupiter", version.ref = "junit" }',
  'coroutines = { module = "org.jetbrains.kotlinx:kotlinx-coroutines-test", version.ref = "junit" }'].join(NL);

const CHEMIN_LIBS = '/p/gradle/libs.versions.toml';
const CHEMIN_TEST = '/p/gradle/testLibs.versions.toml';
const BUILD = '/p/app/build.gradle.kts';
const CODE = ['dependencies {',
  '    implementation(libs.retrofit)',
  '    testImplementation(testLibs.jupiter)',
  '}'].join(NL);

function docDe(nom: string, code: string) {
  const lignes = code.split(NL);
  return {
    fileName: nom,
    uri: { fsPath: nom, toString: () => 'file://' + nom },
    lineAt: (n: number) => ({ text: lignes[n] ?? '' }),
  } as any;
}

function indexDans(ordre: 'libs' | 'testLibs'): VersionCatalogIndex {
  const index = new VersionCatalogIndex();
  // L'ordre de `findFiles` n'est pas specifie : les deux doivent marcher.
  if (ordre === 'libs') {
    index.reindexFile(LIBS, CHEMIN_LIBS);
    index.reindexFile(TEST_LIBS, CHEMIN_TEST);
  } else {
    index.reindexFile(TEST_LIBS, CHEMIN_TEST);
    index.reindexFile(LIBS, CHEMIN_LIBS);
  }
  return index;
}

for (const ordre of ['libs', 'testLibs'] as const) {
  describe('deux catalogues, ' + ordre + ' lu en premier', () => {
    it('Ctrl+clic sur libs.retrofit', () => {
      const cible = new VersionCatalogDefinitionProvider(indexDans(ordre))
        .provideDefinition(docDe(BUILD, CODE), new Position(1, 25) as any);
      expect(cible, 'libs.retrofit doit mener quelque part').toBeDefined();
      expect(cible!.uri.toString()).toContain('libs.versions.toml');
      expect(cible!.range.start.line, 'la ligne de retrofit').toBe(4);
    });

    it('Ctrl+clic sur testLibs.jupiter', () => {
      const cible = new VersionCatalogDefinitionProvider(indexDans(ordre))
        .provideDefinition(docDe(BUILD, CODE), new Position(2, 32) as any);
      expect(cible, 'testLibs.jupiter doit mener quelque part').toBeDefined();
      expect(cible!.uri.toString()).toContain('testLibs.versions.toml');
      expect(cible!.range.start.line).toBe(4);
    });

    it('survol de libs.retrofit', () => {
      const h = new VersionCatalogHoverProvider(indexDans(ordre))
        .provideHover(docDe(BUILD, CODE), new Position(1, 25) as any);
      expect(h, 'le survol doit repondre').toBeDefined();
      expect(String((h as any).contents[0].value)).toContain('com.squareup.retrofit2:retrofit');
    });

    it('survol de testLibs.jupiter', () => {
      const h = new VersionCatalogHoverProvider(indexDans(ordre))
        .provideHover(docDe(BUILD, CODE), new Position(2, 32) as any);
      expect(h, 'le survol doit repondre pour le second catalogue aussi').toBeDefined();
      expect(String((h as any).contents[0].value)).toContain('org.junit.jupiter:junit-jupiter');
    });
  });
}

for (const ordre of ['libs', 'testLibs'] as const) {
  describe('meme alias dans les deux catalogues, ' + ordre + ' lu en premier', () => {
    const CODE_PARTAGE = ['dependencies {',
      '    implementation(libs.coroutines)',
      '    testImplementation(testLibs.coroutines)',
      '}'].join(NL);

    it('le survol rend les coordonnees du catalogue ECRIT', () => {
      const survol = (ligne: number, col: number) => String((new VersionCatalogHoverProvider(indexDans(ordre))
        .provideHover(docDe(BUILD, CODE_PARTAGE), new Position(ligne, col) as any) as any).contents[0].value);
      expect(survol(1, 25), 'libs.coroutines').toContain('kotlinx-coroutines-core');
      expect(survol(2, 32), 'testLibs.coroutines').toContain('kotlinx-coroutines-test');
    });

    it('et le Ctrl+clic ouvre le bon fichier', () => {
      const cible = (ligne: number, col: number) => new VersionCatalogDefinitionProvider(indexDans(ordre))
        .provideDefinition(docDe(BUILD, CODE_PARTAGE), new Position(ligne, col) as any)!.uri.toString();
      expect(cible(1, 25)).toContain('/libs.versions.toml');
      expect(cible(2, 32)).toContain('/testLibs.versions.toml');
    });
  });
}

describe('un catalogue renomme, seul : le survol doit le suivre', () => {
  it('survol de deps.retrofit', () => {
    const index = new VersionCatalogIndex();
    index.reindexFile(LIBS, '/p/gradle/deps.versions.toml');
    const code = 'dependencies {' + NL + '    implementation(deps.retrofit)' + NL + '}';
    const h = new VersionCatalogHoverProvider(index)
      .provideHover(docDe(BUILD, code), new Position(1, 25) as any);
    expect(h, 'le motif du survol etait fige sur libs').toBeDefined();
    expect(String((h as any).contents[0].value)).toContain('com.squareup.retrofit2:retrofit');
  });
});
