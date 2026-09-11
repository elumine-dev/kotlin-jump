/**
 * `settings.gradle.kts` peut renommer la racine d'un catalogue :
 *
 *   versionCatalogs {
 *     create("deps") { from(files("gradle/libs.versions.toml")) }
 *   }
 *
 * Gradle expose alors `deps.retrofit`, pas `libs.retrofit`, meme si le
 * fichier s'appelle `libs.versions.toml`.
 *
 * v1.42.127 a branche la racine sur le NOM du fichier, en appelant
 * `catalogRootOf(chemin, [])`, donc sans jamais lire les settings. Or la
 * navigation DANS le toml, elle, les lit depuis toujours. Les deux moitiés
 * repartaient donc en desaccord sur un projet renomme par les settings :
 * Find Usages depuis le toml trouve bien les `deps.x` ecrits dans les build
 * files, mais survoler ces memes `deps.x` ne rend rien.
 */
import { describe, it, expect } from 'vitest';
import { VersionCatalogIndex } from '../../src/indexer/VersionCatalogIndex';
import { VersionCatalogHoverProvider } from '../../src/providers/VersionCatalogHoverProvider';
import { VersionCatalogDefinitionProvider } from '../../src/providers/VersionCatalogDefinitionProvider';
import { Position } from './__mocks__/vscode';

const NL = String.fromCharCode(10);
const TOML = ['[versions]', 'kotlin = "2.0.21"', '', '[libraries]',
  'retrofit = { module = "com.squareup.retrofit2:retrofit", version.ref = "kotlin" }'].join(NL);
const CHEMIN = '/p/gradle/libs.versions.toml';
const BUILD = '/p/app/build.gradle.kts';

const SETTINGS_RENOMME = ['dependencyResolutionManagement {', '  versionCatalogs {',
  '    create("deps") { from(files("gradle/libs.versions.toml")) }', '  }', '}'].join(NL);
const SETTINGS_ORDINAIRE = ['rootProject.name = "p"', 'include(":app")'].join(NL);

function docDe(nom: string, code: string) {
  const lignes = code.split(NL);
  return {
    fileName: nom,
    uri: { fsPath: nom, toString: () => 'file://' + nom },
    lineAt: (n: number) => ({ text: lignes[n] ?? '' }),
  } as any;
}

/** Le survol et le Ctrl+clic sur `<racine>.retrofit`, sur la meme position. */
function lesDeuxVues(index: VersionCatalogIndex, racine: string) {
  const ligne = '    implementation(' + racine + '.retrofit)';
  const doc = docDe(BUILD, 'dependencies {' + NL + ligne + NL + '}');
  const col = ligne.indexOf(racine) + 2;
  return {
    survol: new VersionCatalogHoverProvider(index).provideHover(doc, new Position(1, col) as any),
    clic: new VersionCatalogDefinitionProvider(index).provideDefinition(doc, new Position(1, col) as any),
  };
}

describe('un catalogue renomme par settings.gradle.kts', () => {
  it('la racine suit les settings, pas le nom du fichier', () => {
    const index = new VersionCatalogIndex();
    index.setSettings([SETTINGS_RENOMME]);
    index.reindexFile(TOML, CHEMIN);
    expect(index.rootFor(BUILD)).toBe('deps');
  });

  it('le survol et le Ctrl+clic repondent sur deps.retrofit', () => {
    const index = new VersionCatalogIndex();
    index.setSettings([SETTINGS_RENOMME]);
    index.reindexFile(TOML, CHEMIN);
    const { survol, clic } = lesDeuxVues(index, 'deps');
    expect(survol, 'survol de deps.retrofit').toBeDefined();
    expect(clic, 'Ctrl+clic sur deps.retrofit').toBeDefined();
  });

  it('et plus rien sur libs.retrofit, que Gradle n expose plus', () => {
    const index = new VersionCatalogIndex();
    index.setSettings([SETTINGS_RENOMME]);
    index.reindexFile(TOML, CHEMIN);
    const { survol, clic } = lesDeuxVues(index, 'libs');
    expect(survol, 'libs n est plus une racine valide').toBeUndefined();
    expect(clic).toBeUndefined();
  });

  it('des settings arrivant APRES le catalogue comptent quand meme', () => {
    // Le balayage est asynchrone : rien ne garantit que les settings soient
    // lus avant les toml.
    const index = new VersionCatalogIndex();
    index.reindexFile(TOML, CHEMIN);
    expect(index.rootFor(BUILD), 'avant les settings').toBe('libs');
    index.setSettings([SETTINGS_RENOMME]);
    expect(index.rootFor(BUILD), 'apres les settings').toBe('deps');
    expect(lesDeuxVues(index, 'deps').clic).toBeDefined();
  });

  it('des settings qui repassent a l ordinaire rendent la racine du fichier', () => {
    const index = new VersionCatalogIndex();
    index.setSettings([SETTINGS_RENOMME]);
    index.reindexFile(TOML, CHEMIN);
    index.setSettings([SETTINGS_ORDINAIRE]);
    expect(index.rootFor(BUILD)).toBe('libs');
    expect(lesDeuxVues(index, 'libs').clic, 'libs redevient joignable').toBeDefined();
  });

  it('sans settings, rien ne change pour un projet ordinaire', () => {
    const index = new VersionCatalogIndex();
    index.reindexFile(TOML, CHEMIN);
    expect(index.rootFor(BUILD)).toBe('libs');
    expect(lesDeuxVues(index, 'libs').survol).toBeDefined();
  });

  it('un settings sans bloc versionCatalogs ne change rien non plus', () => {
    const index = new VersionCatalogIndex();
    index.setSettings([SETTINGS_ORDINAIRE]);
    index.reindexFile(TOML, CHEMIN);
    expect(index.rootFor(BUILD)).toBe('libs');
  });
});

/**
 * Deux relectures de settings qui se chevauchent.
 *
 * Le cablage de v1.42.130 est `void relireSettings()` sur trois evenements de
 * veilleur, et un enregistrement de fichier en emet souvent plusieurs. Deux
 * appels partent donc en meme temps, chacun lit le disque a son rythme, et
 * c'est celui qui FINIT en dernier qui ecrit dans l'index, pas celui qui a
 * DEMARRE en dernier. Le plus ancien peut donc ecraser le plus recent, et
 * l'index reste perime jusqu'au prochain evenement, qui peut ne jamais venir.
 */
describe('relectures de settings qui se chevauchent', () => {
  /** Transcription du cablage de production, sans garde. */
  function relireSansGarde(index: VersionCatalogIndex, lire: () => Promise<string[]>) {
    return (async () => { index.setSettings(await lire()); })();
  }

  it('sans garde, la lecture la plus ANCIENNE ecrase la plus recente', async () => {
    const index = new VersionCatalogIndex();
    index.reindexFile(TOML, CHEMIN);
    let liberer!: () => void;
    const lente = new Promise<void>(r => { liberer = r; });

    const ancienne = relireSansGarde(index, async () => { await lente; return [SETTINGS_ORDINAIRE]; });
    const recente  = relireSansGarde(index, async () => [SETTINGS_RENOMME]);
    await recente;
    expect(index.rootFor(BUILD), 'la recente a bien pris').toBe('deps');
    liberer();
    await ancienne;
    // C'est le defaut : le contenu perime a gagne.
    expect(index.rootFor(BUILD)).toBe('libs');
  });

  it('avec chargerSettings, la lecture demarree en dernier gagne', async () => {
    const index = new VersionCatalogIndex();
    index.reindexFile(TOML, CHEMIN);
    let liberer!: () => void;
    const lente = new Promise<void>(r => { liberer = r; });

    const ancienne = index.chargerSettings(async () => { await lente; return [SETTINGS_ORDINAIRE]; });
    const recente  = index.chargerSettings(async () => [SETTINGS_RENOMME]);
    await recente;
    liberer();
    await ancienne;
    expect(index.rootFor(BUILD), 'la lecture perimee doit etre ignoree').toBe('deps');
  });

  it('une lecture qui echoue ne vide pas les settings deja connus', async () => {
    const index = new VersionCatalogIndex();
    index.reindexFile(TOML, CHEMIN);
    await index.chargerSettings(async () => [SETTINGS_RENOMME]);
    await index.chargerSettings(async () => { throw new Error('EACCES'); });
    expect(index.rootFor(BUILD)).toBe('deps');
  });

  it('une lecture normale prend bien effet', async () => {
    const index = new VersionCatalogIndex();
    index.reindexFile(TOML, CHEMIN);
    await index.chargerSettings(async () => [SETTINGS_RENOMME]);
    expect(index.rootFor(BUILD)).toBe('deps');
  });
});

describe('les settings doivent vraiment etre lus en production', () => {
  it('les deux extensions balaient settings.gradle et alimentent l index', () => {
    // Sans ce cablage, `setSettings` reste une API morte : tous les tests
    // ci dessus passeraient sur un index que personne ne renseigne jamais.
    const fs = require('node:fs') as typeof import('node:fs');
    const path = require('node:path') as typeof import('node:path');
    for (const rel of ['src/extension.ts', 'src/extension.browser.ts']) {
      const texte = fs.readFileSync(path.resolve(__dirname, '..', '..', rel), 'utf8');
      expect(texte, rel + ' doit balayer les settings').toContain("'**/settings.gradle{,.kts}'");
      expect(texte, rel + ' doit alimenter l index par la voie gardee')
        .toContain('vcIndex.chargerSettings(');
      expect(texte, rel + ' ne doit pas court circuiter la garde')
        .not.toContain('vcIndex.setSettings(');
      expect(texte, rel + ' doit surveiller les settings')
        .toContain('createFileSystemWatcher(SETTINGS_GLOB)');
    }
  });
});
