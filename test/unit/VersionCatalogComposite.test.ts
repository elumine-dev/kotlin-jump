/**
 * Un catalogue partage par un build composite.
 *
 *   /w/gradle/libs.versions.toml        le catalogue, lu `libs` par le parent
 *   /w/buildA/settings.gradle.kts       create("deps") { from(files("../gradle/libs.versions.toml")) }
 *
 * Le MEME fichier est donc expose sous deux racines a la fois, `libs` pour le
 * projet parent et `deps` pour le build inclus. Le modele n'en gardait
 * qu'une, et selon la version c'etait la mauvaise moitie qui gagnait :
 * avant v1.42.132, `deps` pour tout le monde, donc le parent muet ; depuis,
 * `libs` pour tout le monde, donc le build inclus muet.
 *
 * Les deux providers bouclent deja sur les racines : il suffit de leur en
 * donner plusieurs.
 */
import { describe, it, expect } from 'vitest';
import { VersionCatalogIndex } from '../../src/indexer/VersionCatalogIndex';
import { VersionCatalogHoverProvider } from '../../src/providers/VersionCatalogHoverProvider';
import { VersionCatalogDefinitionProvider } from '../../src/providers/VersionCatalogDefinitionProvider';
import { Position } from './__mocks__/vscode';

const NL = String.fromCharCode(10);
const TOML = ['[versions]', 'kotlin = "2.0.21"', '', '[libraries]',
  'retrofit = { module = "com.squareup.retrofit2:retrofit", version.ref = "kotlin" }'].join(NL);
const CATALOGUE = '/w/gradle/libs.versions.toml';

const SET_COMPOSITE = {
  path: '/w/buildA/settings.gradle.kts',
  text: ['versionCatalogs {',
    '  create("deps") { from(files("../gradle/libs.versions.toml")) }', '}'].join(NL),
};
const SET_RACINE = { path: '/w/settings.gradle.kts', text: 'rootProject.name = "w"' };

function docDe(nom: string, ligne: string) {
  const code = ['dependencies {', ligne, '}'];
  return {
    fileName: nom,
    uri: { fsPath: nom, toString: () => 'file://' + nom },
    lineAt: (n: number) => ({ text: code[n] ?? '' }),
  } as any;
}

function lesDeuxVues(index: VersionCatalogIndex, buildFile: string, racine: string) {
  const ligne = '    implementation(' + racine + '.retrofit)';
  const doc = docDe(buildFile, ligne);
  const col = ligne.indexOf(racine) + 2;
  return {
    survol: new VersionCatalogHoverProvider(index).provideHover(doc, new Position(1, col) as any),
    clic: new VersionCatalogDefinitionProvider(index).provideDefinition(doc, new Position(1, col) as any),
  };
}

function indexComposite(): VersionCatalogIndex {
  const i = new VersionCatalogIndex();
  i.setSettings([SET_RACINE, SET_COMPOSITE]);
  i.reindexFile(TOML, CATALOGUE);
  return i;
}

describe('un catalogue expose sous deux racines a la fois', () => {
  it('les deux racines sont offertes', () => {
    expect([...indexComposite().rootsFor('/w/app/build.gradle.kts')].sort()).toEqual(['deps', 'libs']);
  });

  it('le parent navigue toujours avec libs', () => {
    const { survol, clic } = lesDeuxVues(indexComposite(), '/w/app/build.gradle.kts', 'libs');
    expect(survol, 'survol de libs.retrofit dans le parent').toBeDefined();
    expect(clic).toBeDefined();
  });

  it('et le build inclus navigue avec deps', () => {
    const { survol, clic } = lesDeuxVues(indexComposite(), '/w/buildA/app/build.gradle.kts', 'deps');
    expect(survol, 'survol de deps.retrofit dans le build inclus').toBeDefined();
    expect(clic).toBeDefined();
  });
});

describe('la racine supplementaire ne contamine pas les voisins', () => {
  // Le `from` doit etre resolu RELATIVEMENT au settings qui le declare. Le
  // comparer au seul nom de fichier ramenerait la contamination corrigee en
  // v1.42.132, tous les catalogues par defaut portant le meme nom.
  const SET_A = {
    path: '/w/projetA/settings.gradle.kts',
    text: ['versionCatalogs {',
      '  create("deps") { from(files("gradle/libs.versions.toml")) }', '}'].join(NL),
  };

  it('le voisin garde libs, et seulement libs', () => {
    const i = new VersionCatalogIndex();
    i.setSettings([SET_A]);
    i.reindexFile(TOML, '/w/projetA/gradle/libs.versions.toml');
    i.reindexFile(TOML, '/w/projetB/gradle/libs.versions.toml');
    expect(i.rootsFor('/w/projetB/app/build.gradle.kts')).toEqual(['libs']);
    expect(i.rootsFor('/w/projetA/app/build.gradle.kts')).toEqual(['deps']);
  });

  it('un projet ordinaire n a toujours qu une racine', () => {
    const i = new VersionCatalogIndex();
    i.reindexFile(TOML, '/p/gradle/libs.versions.toml');
    expect(i.rootsFor('/p/app/build.gradle.kts')).toEqual(['libs']);
  });
});

/**
 * Le chemin du `from` peut passer par `rootDir`.
 *
 * Dans un `settings.gradle(.kts)`, `rootDir` EST le dossier qui contient ce
 * settings, donc le chemin reste resoluble exactement. Mais le corps du bloc
 * `create(...) { ... }` etait lu avec `[^}]*`, qui s'arrete sur l'accolade de
 * `${rootDir}` : le `from` n'etait plus visible et la racine secondaire
 * disparaissait. Le calcul de la racine PRINCIPALE, lui, a un repli sur le
 * texte entier et s'en sortait, d'ou une moitie qui marchait et pas l'autre.
 */
describe('un from qui passe par rootDir', () => {
  const D = String.fromCharCode(36); // dollar
  const compositeAvec = (chemin: string) => {
    const i = new VersionCatalogIndex();
    i.setSettings([{
      path: '/w/buildA/settings.gradle.kts',
      text: ['versionCatalogs {', '  create("deps") {',
        '    from(files("' + chemin + '"))', '  }', '}'].join(NL),
    }]);
    i.reindexFile(TOML, CATALOGUE);
    return i;
  };

  it('avec accolades', () => {
    expect([...compositeAvec(D + '{rootDir}/../gradle/libs.versions.toml')
      .rootsFor('/w/buildA/app/build.gradle.kts')].sort()).toEqual(['deps', 'libs']);
  });

  it('sans accolades', () => {
    expect([...compositeAvec(D + 'rootDir/../gradle/libs.versions.toml')
      .rootsFor('/w/buildA/app/build.gradle.kts')].sort()).toEqual(['deps', 'libs']);
  });

  it('et par rootProject.projectDir, qui designe le meme dossier', () => {
    expect([...compositeAvec(D + '{rootProject.projectDir}/../gradle/libs.versions.toml')
      .rootsFor('/w/buildA/app/build.gradle.kts')].sort()).toEqual(['deps', 'libs']);
  });

  it('une variable inconnue est ignoree plutot que devinee', () => {
    // La deviner reviendrait a comparer les noms de fichier, ce qui ramene la
    // contamination entre projets voisins corrigee en v1.42.132.
    expect(compositeAvec(D + '{maVariable}/gradle/libs.versions.toml')
      .rootsFor('/w/buildA/app/build.gradle.kts')).toEqual(['libs']);
  });

  it('un bloc suivi d un sous bloc reste lu', () => {
    const i = new VersionCatalogIndex();
    i.setSettings([{
      path: '/w/buildA/settings.gradle.kts',
      text: ['versionCatalogs {', '  create("deps") {',
        '    from(files("../gradle/libs.versions.toml"))',
        '    version("x") { require("1.0") }', '  }', '}'].join(NL),
    }]);
    i.reindexFile(TOML, CATALOGUE);
    expect([...i.rootsFor('/w/app/build.gradle.kts')].sort()).toEqual(['deps', 'libs']);
  });

  it('rootDir ne contamine pas le catalogue du voisin', () => {
    const i = new VersionCatalogIndex();
    i.setSettings([{
      path: '/w/projetA/settings.gradle.kts',
      text: ['versionCatalogs {', '  create("deps") {',
        '    from(files("' + D + '{rootDir}/gradle/libs.versions.toml"))', '  }', '}'].join(NL),
    }]);
    i.reindexFile(TOML, '/w/projetA/gradle/libs.versions.toml');
    i.reindexFile(TOML, '/w/projetB/gradle/libs.versions.toml');
    expect(i.rootsFor('/w/projetB/app/build.gradle.kts')).toEqual(['libs']);
  });
});
