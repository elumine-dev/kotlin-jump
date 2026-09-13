import { describe, it, expect, vi, afterEach } from 'vitest';
import * as vscodeMock from '../__mocks__/vscode';
import { estUnFichierReel } from '../../../src/util/inWorkspace';
import { HardcodedStringProvider } from '../../../src/providers/HardcodedStringProvider';

/**
 * A dependency's source tree is a real file on disk that the user still cannot
 * fix.
 *
 * The first guard ruled out archive entries by their `.jar!` segment, and the
 * workspace folder ruled out everything else that lives outside the project.
 * Splitting the guard in two so a lone file stays lintable dropped that second
 * half for the file local linters, and with it the only thing that kept the
 * Android SDK sources and the Gradle cache out.
 *
 * Measured, not imagined: 15138 java files under
 * `~/Library/Android/sdk/sources/android-35`, and Go to Definition on a
 * framework class opens one of them. `android/webkit/FindActionModeCallback.java`
 * comes back with one hardcoded string finding, a warning on Android's own
 * source, in a file no user can edit.
 *
 * The folder is the escape hatch rather than the rule: a file inside the
 * project is ours whatever its path looks like, and a file outside it is ours
 * only if it does not sit in a dependency root.
 */

const SDK = '/Users/k/Library/Android/sdk/sources/android-35/android/webkit/FindActionModeCallback.java';
const CACHE = '/Users/k/.gradle/caches/9.4.1/kotlin-dsl/accessors/abc/sources/org/gradle/Accessors.kt';
const MAVEN = '/Users/k/.m2/repository/com/x/lib/1.0/lib-sources/com/x/Lib.java';
const SEUL = '/ailleurs/brouillon/A.kt';

const doc = (chemin: string, texte = '') => ({
  uri: vscodeMock.Uri.file(chemin),
  languageId: chemin.endsWith('.kt') ? 'kotlin' : 'java',
  getText: () => texte,
  lineAt: (n: number) => ({ text: texte.split('\n')[n] ?? '' }),
}) as any;

const aucunDossier = () =>
  vi.spyOn(vscodeMock.workspace, 'getWorkspaceFolder').mockReturnValue(undefined as any);

const dossier = (racine: string) =>
  vi.spyOn(vscodeMock.workspace, 'getWorkspaceFolder').mockImplementation(((u: any) =>
    String(u.path ?? u.fsPath).startsWith(racine) ? { uri: vscodeMock.Uri.file(racine) } : undefined) as any);

afterEach(() => vi.restoreAllMocks());

describe('les sources de dependance ne sont pas les notres', () => {
  it('les sources du SDK Android ne passent pas', () => {
    aucunDossier();
    expect(estUnFichierReel(doc(SDK))).toBe(false);
  });

  it('le cache Gradle ne passe pas, meme en fichier reel hors archive', () => {
    aucunDossier();
    expect(estUnFichierReel(doc(CACHE))).toBe(false);
  });

  it('le depot Maven local ne passe pas', () => {
    aucunDossier();
    expect(estUnFichierReel(doc(MAVEN))).toBe(false);
  });

  it('un fichier ordinaire ouvert seul passe toujours', () => {
    aucunDossier();
    expect(estUnFichierReel(doc(SEUL))).toBe(true);
  });

  it('un fichier DU projet passe, quoi que son chemin ressemble', () => {
    // Quelqu un dont le projet vit sous un dossier nomme caches reste chez lui.
    const projet = '/w/vendor/.gradle/caches/mine/A.kt';
    dossier('/w');
    expect(estUnFichierReel(doc(projet))).toBe(true);
  });

  it('une entree de jar reste ecartee meme dans le projet', () => {
    dossier('/w');
    expect(estUnFichierReel(doc('/w/libs/x-sources.jar!com/x/A.java'))).toBe(false);
  });
});

describe('le linter ne diagnostique pas la source du SDK', () => {
  const allume = () =>
    vi.spyOn(vscodeMock.workspace, 'getConfiguration').mockReturnValue({
      get: (cle: string, defaut: any) => (cle === 'hardcodedStringLint' ? true : defaut),
    } as any);

  const diagnostics = (d: any): any[] => {
    const p = new HardcodedStringProvider();
    (p as any)._scan(d);
    return ((p as any)._diag._entries as Map<string, any[]>).get(d.uri.fsPath) ?? [];
  };

  const UI = `class A {\n    fun f() {\n        Text("Bonjour tout le monde")\n    }\n}\n`;

  it('temoin : le meme contenu ouvert seul est bien signale', () => {
    allume();
    aucunDossier();
    expect(diagnostics(doc(SEUL, UI)).length).toBeGreaterThan(0);
  });

  it('le meme contenu sous les sources du SDK ne l est pas', () => {
    allume();
    aucunDossier();
    expect(diagnostics(doc(SDK.replace(/\.java$/, '.kt'), UI))).toHaveLength(0);
  });
});

/**
 * Same trees, written the way other machines write them.
 *
 * The first version of this rule compared path segments literally. Two things
 * break that. The filesystem under it does not care about case: on this very
 * machine `~/Library/Android/SDK/...` and `~/Library/Android/sdk/...` are the
 * same inode, and Windows behaves the same way, so the case that reaches us is
 * whatever the user happened to type. And the SDK does not have to live where
 * the installer put it: `ANDROID_HOME` and `GRADLE_USER_HOME` move both trees
 * wherever their owner wants.
 *
 * What does not move is the layout inside them: an SDK keeps its platform
 * sources under `sources/android-<api level>`, and Gradle keeps its downloads
 * under `caches/modules-2`. Those are what the rule reads now.
 */
describe('les memes arbres, ecrits autrement', () => {
  const cas: [string, string][] = [
    ['la casse du SDK sur un disque insensible a la casse',
     '/Users/k/Library/Android/SDK/sources/android-35/android/webkit/A.java'],
    ['la casse par defaut de Windows et Linux',
     '/c:/Users/k/AppData/Local/Android/Sdk/sources/android-35/android/webkit/A.java'],
    ['un SDK deplace par ANDROID_HOME',
     '/opt/android-sdk/sources/android-35/android/webkit/A.java'],
    ['un cache Gradle deplace par GRADLE_USER_HOME',
     '/opt/gradle-home/caches/modules-2/files-2.1/com/x/lib/A.kt'],
    ['la casse du dossier Gradle',
     '/Users/k/.GRADLE/caches/9.4.1/kotlin-dsl/sources/org/gradle/A.kt'],
  ];

  for (const [nom, chemin] of cas) {
    it(nom, () => {
      aucunDossier();
      expect(estUnFichierReel(doc(chemin))).toBe(false);
    });
  }

  it('mais un dossier nomme sources reste au projet quand il ne porte pas de niveau d API', () => {
    aucunDossier();
    expect(estUnFichierReel(doc('/ailleurs/sources/android-utils/A.kt'))).toBe(true);
  });
});

