import { describe, it, expect, vi, afterEach } from 'vitest';
import * as vscodeMock from '../__mocks__/vscode';
import { estDansLEspaceDeTravail } from '../../../src/util/inWorkspace';

/**
 * Un source jar du cache Gradle n'est pas du code du projet.
 *
 * Il s'ouvre avec `languageId === 'java'`, donc un fournisseur qui ne filtre
 * que sur la langue l'analyse comme si l'utilisateur l'avait ecrit. Kotlin
 * Jump a pose une ERREUR sur l'un d'eux,
 *
 *   ~/.gradle/caches/.../databinding-runtime-9.3.1-sources.jar!androidx/databinding/ObservableField.java
 *   severity 8  Cannot resolve string resource 'name'
 *
 * dans un fichier que l'utilisateur ne peut ni ouvrir ni corriger. C'etait la
 * seule erreur de toute sa liste, et elle venait de nous.
 *
 * Les deux conditions sont necessaires. Le schema ecarte `jar:`, `git:`,
 * `untitled:` et tout document virtuel ; le dossier d'espace de travail ecarte
 * un vrai fichier sur disque qui ne fait simplement pas partie du projet, ce
 * qu'est le cache Gradle.
 */

const DANS = '/w/app/src/main/java/com/x/A.java';
const CACHE = '/Users/k/.gradle/caches/modules-2/files-2.1/androidx.databinding/databinding-runtime-9.3.1-sources.jar!androidx/databinding/ObservableField.java';

const doc = (uri: any) => ({ uri, languageId: 'java' }) as any;

const dansUnDossier = (chemins: string[]) =>
  vi.spyOn(vscodeMock.workspace, 'getWorkspaceFolder').mockImplementation(((u: any) =>
    chemins.some(c => String(u.path ?? u.fsPath).startsWith(c))
      ? { uri: vscodeMock.Uri.file(chemins[0]) }
      : undefined) as any);

afterEach(() => vi.restoreAllMocks());

describe('estDansLEspaceDeTravail', () => {
  it('temoin : un fichier du projet passe', () => {
    dansUnDossier(['/w']);
    expect(estDansLEspaceDeTravail(doc(vscodeMock.Uri.file(DANS)))).toBe(true);
  });

  it('un source jar du cache Gradle ne passe pas', () => {
    dansUnDossier(['/w']);
    expect(estDansLEspaceDeTravail(doc(vscodeMock.Uri.file(CACHE)))).toBe(false);
  });

  it('un vrai fichier hors de tout dossier du projet ne passe pas', () => {
    dansUnDossier(['/w']);
    expect(estDansLEspaceDeTravail(doc(vscodeMock.Uri.file('/ailleurs/B.java')))).toBe(false);
  });

  it('un document virtuel ne passe pas, meme dans le projet', () => {
    dansUnDossier(['/w']);
    for (const uri of ['git:' + DANS, 'untitled:Untitled-1', 'jar:' + DANS]) {
      expect(estDansLEspaceDeTravail(doc(vscodeMock.Uri.parse(uri))), uri).toBe(false);
    }
  });

  it('sans dossier ouvert, rien ne passe', () => {
    vi.spyOn(vscodeMock.workspace, 'getWorkspaceFolder').mockReturnValue(undefined as any);
    expect(estDansLEspaceDeTravail(doc(vscodeMock.Uri.file(DANS)))).toBe(false);
  });
});
