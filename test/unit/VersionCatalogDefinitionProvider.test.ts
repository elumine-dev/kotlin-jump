import { describe, it, expect } from 'vitest';
import { VersionCatalogIndex } from '../../src/indexer/VersionCatalogIndex';
import { VersionCatalogDefinitionProvider } from '../../src/providers/VersionCatalogDefinitionProvider';
import { Position } from './__mocks__/vscode';

// Le catalogue etait deja indexe pour le hover, mais le hover ne connait que
// `[libraries]`. Une ligne `alias(libs.plugins.android.library)` n'offrait donc
// rien du tout : ni survol, ni navigation.

const TOML = '/p/gradle/libs.versions.toml';
const CATALOGUE = [
  '[versions]',
  'kotlin = "2.0.21"',
  'agp = "8.5.2"',
  '',
  '[libraries]',
  'androidx-core = { module = "androidx.core:core-ktx", version.ref = "kotlin" }',
  'androidx = { module = "androidx.legacy:legacy", version.ref = "kotlin" }',
  'ksp-api = { module = "com.google.devtools.ksp:api", version.ref = "kotlin" }',
  '',
  '[plugins]',
  'android-library = { id = "com.android.library", version.ref = "agp" }',
  'kotlin-android = { id = "org.jetbrains.kotlin.android", version.ref = "kotlin" }',
  'ksp = { id = "com.google.devtools.ksp", version.ref = "kotlin" }',
  '',
  '[bundles]',
  'media = ["androidx-core"]',
].join('\n');

function docDe(nom: string, code: string) {
  const lignes = code.split('\n');
  return {
    fileName: nom,
    uri: { fsPath: nom, toString: () => 'file://' + nom },
    lineAt: (n: number) => ({ text: lignes[n] ?? '' }),
  } as any;
}

function provider() {
  const index = new VersionCatalogIndex();
  index.reindexFile(CATALOGUE, TOML);
  return new VersionCatalogDefinitionProvider(index);
}

/** Ligne du toml visee, ou undefined. */
function cible(code: string, ligne: number, colonne: number, nom = '/p/app/build.gradle.kts') {
  const loc: any = provider().provideDefinition(docDe(nom, code), new Position(ligne, colonne));
  if (!loc) return undefined;
  return { ligne: loc.range.start.line, texte: CATALOGUE.split('\n')[loc.range.start.line], fichier: loc.uri.fsPath };
}

describe('Ctrl+clic sur un accesseur de catalogue de versions', () => {
  it('alias(libs.plugins.android.library) mene a la section [plugins]', () => {
    const c = cible('plugins {\n    alias(libs.plugins.android.library)\n}', 1, 20);
    expect(c?.texte).toBe('android-library = { id = "com.android.library", version.ref = "agp" }');
    expect(c?.fichier).toBe(TOML);
  });

  it('un plugin et une bibliotheque de meme nom ne se confondent pas', () => {
    // `ksp` existe dans [plugins], `ksp-api` dans [libraries].
    expect(cible('    alias(libs.plugins.ksp)', 0, 22)?.texte)
      .toBe('ksp = { id = "com.google.devtools.ksp", version.ref = "kotlin" }');
    expect(cible('    implementation(libs.ksp.api)', 0, 25)?.texte)
      .toBe('ksp-api = { module = "com.google.devtools.ksp:api", version.ref = "kotlin" }');
  });

  it('l\'alias le plus long gagne, pas le prefixe', () => {
    // `androidx` et `androidx-core` existent tous les deux.
    expect(cible('    implementation(libs.androidx.core)', 0, 30)?.texte)
      .toBe('androidx-core = { module = "androidx.core:core-ktx", version.ref = "kotlin" }');
    expect(cible('    implementation(libs.androidx)', 0, 26)?.texte)
      .toBe('androidx = { module = "androidx.legacy:legacy", version.ref = "kotlin" }');
  });

  it('libs.versions.kotlin mene a la section [versions]', () => {
    expect(cible('    val v = libs.versions.kotlin.get()', 0, 25)?.texte).toBe('kotlin = "2.0.21"');
  });

  it('libs.bundles.media mene a la section [bundles]', () => {
    expect(cible('    implementation(libs.bundles.media)', 0, 32)?.texte).toBe('media = ["androidx-core"]');
  });

  it('la plage renvoyee couvre le nom de l\'alias, pas la ligne entiere', () => {
    const loc: any = provider().provideDefinition(
      docDe('/p/app/build.gradle.kts', '    alias(libs.plugins.kotlin.android)'), new Position(0, 20));
    expect(loc.range.start.character).toBe(0);
    expect(loc.range.end.character).toBe('kotlin-android'.length);
  });

  it('curseur hors de l\'accesseur : aucune navigation', () => {
    expect(cible('    alias(libs.plugins.ksp)   // commentaire', 0, 34)).toBeUndefined();
  });

  it('un accesseur inconnu ne renvoie rien plutot qu\'une cible approchante', () => {
    expect(cible('    alias(libs.plugins.inexistant)', 0, 24)).toBeUndefined();
  });

  it('un fichier qui n\'est pas un script Gradle est ignore', () => {
    expect(cible('val x = libs.androidx.core', 0, 18, '/p/app/src/main/kotlin/A.kt')).toBeUndefined();
  });

  it('un build.gradle Groovy fonctionne aussi', () => {
    expect(cible("    implementation libs.androidx.core", 0, 27, '/p/app/build.gradle')?.texte)
      .toBe('androidx-core = { module = "androidx.core:core-ktx", version.ref = "kotlin" }');
  });
});

describe('Le survol lit les quatre sections, pas seulement [libraries]', () => {
  function survol(accesseur: string) {
    const index = new VersionCatalogIndex();
    index.reindexFile(CATALOGUE, TOML);
    return index.describeAccessor(accesseur, '/p/app/build.gradle.kts');
  }

  it('un plugin donne son id et sa version resolue', () => {
    expect(survol('plugins.android.library')).toBe('com.android.library:8.5.2');
  });

  it('une version donne sa valeur litterale', () => {
    expect(survol('versions.kotlin')).toBe('2.0.21');
  });

  it('un bundle donne ses membres', () => {
    expect(survol('bundles.media')).toBe('androidx-core');
  });

  it('une bibliotheque garde exactement ce qu\'elle affichait', () => {
    expect(survol('androidx.core')).toBe('androidx.core:core-ktx:2.0.21');
  });

  it('un accesseur inconnu ne decrit rien', () => {
    expect(survol('plugins.inexistant')).toBeUndefined();
  });
});

describe('Le fichier vise garde le schema de son URI', () => {
  // Sur vscode.dev le document a le schema `vscode-vfs`, et `uri.fsPath` en
  // rend seulement le chemin. Reconstruire un `file://` a partir de la menait
  // vers un fichier qui n'existe pas dans l'hote web.
  const VFS = 'vscode-vfs://github/nuglif/lapresse/gradle/libs.versions.toml';

  it('un catalogue indexe depuis un systeme de fichiers virtuel reste atteignable', () => {
    const index = new VersionCatalogIndex();
    index.reindexFile(CATALOGUE, '/nuglif/lapresse/gradle/libs.versions.toml', VFS);
    const p = new VersionCatalogDefinitionProvider(index);
    const loc: any = p.provideDefinition(
      docDe('/nuglif/lapresse/app/build.gradle.kts', '    alias(libs.plugins.ksp)'),
      new Position(0, 22));
    expect(loc).toBeDefined();
    expect(loc.uri.toString()).toBe(VFS);
  });

  it('un chemin nu reste traite comme un fichier local', () => {
    const loc: any = provider().provideDefinition(
      docDe('/p/app/build.gradle.kts', '    alias(libs.plugins.ksp)'), new Position(0, 22));
    expect(loc.uri.scheme).toBe('file');
    expect(loc.uri.path).toBe(TOML);
  });
});
