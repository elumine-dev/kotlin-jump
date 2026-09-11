/**
 * Un catalogue de versions qui ne s'appelle pas `libs`.
 *
 * Gradle prend la racine d'accesseur dans le NOM du fichier :
 * `gradle/deps.versions.toml` se lit `deps.retrofit`. L'extension avait deux
 * moitiés qui ne racontaient pas la même histoire :
 *
 *  - la coloration, le repli et la navigation DANS le toml sont enregistrés
 *    sur `**​/*.versions.toml`, donc marchent pour un catalogue renomme ;
 *  - le survol et le Ctrl+clic depuis un build.gradle.kts cherchaient
 *    `**​/gradle/libs.versions.toml` et supposaient la racine `libs`.
 *
 * Sur un projet a catalogue renomme, la premiere moitie marchait et la
 * seconde ne repondait jamais, sans un message.
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { VersionCatalogIndex } from '../../src/indexer/VersionCatalogIndex';
import { VersionCatalogDefinitionProvider } from '../../src/providers/VersionCatalogDefinitionProvider';
import { Position } from './__mocks__/vscode';

const CATALOGUE = [
  '[versions]',
  'kotlin = "2.0.21"',
  '',
  '[libraries]',
  'retrofit = { module = "com.squareup.retrofit2:retrofit", version.ref = "kotlin" }',
  '',
  '[plugins]',
  'android-library = { id = "com.android.library", version.ref = "kotlin" }',
].join(String.fromCharCode(10));

function docDe(nom: string, code: string) {
  const lignes = code.split(String.fromCharCode(10));
  return {
    fileName: nom,
    uri: { fsPath: nom, toString: () => 'file://' + nom },
    lineAt: (n: number) => ({ text: lignes[n] ?? '' }),
  } as any;
}

function indexAvec(cheminToml: string): VersionCatalogIndex {
  const index = new VersionCatalogIndex();
  index.reindexFile(CATALOGUE, cheminToml);
  return index;
}

describe('la racine d accesseur vient du nom du fichier', () => {
  it('libs.versions.toml donne libs', () => {
    expect(indexAvec('/p/gradle/libs.versions.toml').rootFor('/p/app/build.gradle.kts')).toBe('libs');
  });

  it('deps.versions.toml donne deps', () => {
    expect(indexAvec('/p/gradle/deps.versions.toml').rootFor('/p/app/build.gradle.kts')).toBe('deps');
  });

  it('un nom inattendu retombe sur libs plutot que de casser', () => {
    expect(indexAvec('/p/gradle/catalogue.toml').rootFor('/p/app/build.gradle.kts')).toBe('libs');
  });

  it('la racine est bien STOCKEE, pas seulement rendue par rootFor', () => {
    // `rootFor` a son propre `?? 'libs'`, qui masquait une racine laissee a
    // undefined dans le catalogue. Or le scan de dependances mortes lit
    // `catalog.root` directement, et un undefined y empoisonne son Set de
    // racines.
    expect(indexAvec('/p/gradle/deps.versions.toml').parsed().root).toBe('deps');
    expect(indexAvec('/p/gradle/catalogue.toml').parsed().root, 'jamais undefined').toBe('libs');
  });
});

describe('Ctrl+clic depuis un build file sur un catalogue renomme', () => {
  const BUILD = '/p/app/build.gradle.kts';
  const CODE = [
    'plugins {',
    '    alias(deps.plugins.android.library)',
    '}',
    'dependencies {',
    '    implementation(deps.retrofit)',
    '}',
  ].join(String.fromCharCode(10));

  function viser(index: VersionCatalogIndex, ligne: number, caractere: number) {
    return new VersionCatalogDefinitionProvider(index)
      .provideDefinition(docDe(BUILD, CODE), new Position(ligne, caractere) as any);
  }

  it('une librairie ouvre sur sa ligne de declaration', () => {
    const cible = viser(indexAvec('/p/gradle/deps.versions.toml'), 4, 25);
    expect(cible, 'deps.retrofit doit mener quelque part').toBeDefined();
    expect(cible!.range.start.line, 'la ligne de `retrofit` dans le toml').toBe(4);
  });

  it('un plugin aussi', () => {
    const cible = viser(indexAvec('/p/gradle/deps.versions.toml'), 1, 24);
    expect(cible, 'deps.plugins.android.library doit mener quelque part').toBeDefined();
    expect(cible!.range.start.line).toBe(7);
  });

  it('et un catalogue nomme libs continue de marcher', () => {
    const codeLibs = 'dependencies {' + String.fromCharCode(10) + '    implementation(libs.retrofit)' + String.fromCharCode(10) + '}';
    const cible = new VersionCatalogDefinitionProvider(indexAvec('/p/gradle/libs.versions.toml'))
      .provideDefinition(docDe(BUILD, codeLibs), new Position(1, 25) as any);
    expect(cible).toBeDefined();
    expect(cible!.range.start.line).toBe(4);
  });
});

describe('le catalogue renomme doit d abord etre DECOUVERT', () => {
  it('aucun balayage ne fige le nom libs', () => {
    // Sans cela, tout ce qui precede reste theorique : le fichier n arrive
    // jamais jusqu a l index, donc le survol et la navigation depuis un
    // build file ne repondent rien.
    const fautifs: string[] = [];
    for (const rel of ['src/extension.ts', 'src/extension.browser.ts']) {
      const abs = path.resolve(__dirname, '..', '..', rel);
      fs.readFileSync(abs, 'utf8').split(String.fromCharCode(10)).forEach((ligne, i) => {
        if (!/findFiles|createFileSystemWatcher/.test(ligne)) return;
        if (/libs\.versions\.toml/.test(ligne)) fautifs.push(rel + ':' + (i + 1));
      });
    }
    expect(fautifs, 'utiliser *.versions.toml, la racine vient du nom du fichier').toEqual([]);
  });
});
