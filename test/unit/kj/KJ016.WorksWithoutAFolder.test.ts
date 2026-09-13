import { describe, it, expect, vi, afterEach } from 'vitest';
import * as vscodeMock from '../__mocks__/vscode';
import { LifecyclePairingProvider } from '../../../src/providers/LifecyclePairingProvider';
import { HardcodedStringProvider } from '../../../src/providers/HardcodedStringProvider';

/**
 * KJ-016 reads nothing but the document in front of it, so it must not need a
 * workspace folder to say anything.
 *
 * v1.42.246 gated it on the folder to keep a Gradle source jar out of the
 * Problems panel. v1.42.247 split that guard in two precisely so a file local
 * linter would stop depending on the folder, and it added the loose check to
 * this provider without removing the strict one. The strict check subsumes
 * the loose one, so it still won every time and the linter stayed silent on a
 * file opened on its own.
 *
 * KJ051.OnlyWorkspaceFiles covers the two helpers in isolation and says in its
 * own comment that this provider needs only the file. It never checked which
 * of the two the provider calls, so it stayed green throughout.
 */

const AVEC_ORPHELIN = `class A : Activity() {
    override fun onStart() {
        super.onStart()
        locationManager.requestLocationUpdates(provider, 0L, 0f, gpsListener)
    }

    override fun onStop() {
        super.onStop()
    }
}
`;

const doc = (chemin: string, texte: string) => {
  const lignes = texte.split('\n');
  return {
    uri: vscodeMock.Uri.file(chemin),
    languageId: 'kotlin',
    getText: () => texte,
    lineAt: (n: number) => ({ text: lignes[n] ?? '' }),
  } as any;
};

const diagnosticsDe = (d: any): any[] => {
  const p = new LifecyclePairingProvider();
  (p as any)._scan(d);
  const entries: Map<string, any[]> = (p as any)._diag._entries;
  return entries.get(d.uri.fsPath) ?? [];
};

afterEach(() => vi.restoreAllMocks());

describe('KJ-016 without a workspace folder', () => {
  it('temoin : le fichier porte bien un orphelin quand un dossier est ouvert', () => {
    vi.spyOn(vscodeMock.workspace, 'getWorkspaceFolder').mockReturnValue({
      uri: vscodeMock.Uri.file('/w'),
    } as any);
    expect(diagnosticsDe(doc('/w/A.kt', AVEC_ORPHELIN)).length).toBeGreaterThan(0);
  });

  it('un fichier ouvert seul, sans dossier, reste analyse', () => {
    vi.spyOn(vscodeMock.workspace, 'getWorkspaceFolder').mockReturnValue(undefined as any);
    expect(diagnosticsDe(doc('/ailleurs/A.kt', AVEC_ORPHELIN)).length).toBeGreaterThan(0);
  });

  it('le source jar du cache Gradle reste ecarte, dossier ou pas', () => {
    const jar = '/Users/k/.gradle/caches/databinding-runtime-9.3.1-sources.jar!androidx/A.kt';
    for (const dossier of [{ uri: vscodeMock.Uri.file('/w') } as any, undefined]) {
      vi.spyOn(vscodeMock.workspace, 'getWorkspaceFolder').mockReturnValue(dossier);
      expect(diagnosticsDe(doc(jar, AVEC_ORPHELIN))).toHaveLength(0);
      vi.restoreAllMocks();
    }
  });

  it('une vue git: du meme fichier reste ecartee', () => {
    vi.spyOn(vscodeMock.workspace, 'getWorkspaceFolder').mockReturnValue(undefined as any);
    const vue = doc('/w/A.kt', AVEC_ORPHELIN);
    vue.uri = vscodeMock.Uri.parse('git:/w/A.kt');
    expect(diagnosticsDe(vue)).toHaveLength(0);
  });
});

/**
 * The other file local linter the same split was written for. It reads its own
 * document too, and it already asks only for the loose check. Kept here so the
 * pair is locked together: the two of them went wrong at the same time and
 * only one of them was put right.
 */
describe('KJ-004 without a workspace folder', () => {
  const allume = () =>
    vi.spyOn(vscodeMock.workspace, 'getConfiguration').mockReturnValue({
      get: (cle: string, defaut: any) => (cle === 'hardcodedStringLint' ? true : defaut),
    } as any);

  const diagnostics = (d: any): any[] => {
    const p = new HardcodedStringProvider();
    (p as any)._scan(d);
    return ((p as any)._diag._entries as Map<string, any[]>).get(d.uri.fsPath) ?? [];
  };

  const AVEC_LITTERAL = `class A {
    fun f() {
        Text("Bonjour tout le monde")
    }
}
`;

  it('temoin : le littéral est signalé quand un dossier est ouvert', () => {
    allume();
    vi.spyOn(vscodeMock.workspace, 'getWorkspaceFolder').mockReturnValue({
      uri: vscodeMock.Uri.file('/w'),
    } as any);
    expect(diagnostics(doc('/w/A.kt', AVEC_LITTERAL)).length).toBeGreaterThan(0);
  });

  it('un fichier ouvert seul, sans dossier, reste analyse', () => {
    allume();
    vi.spyOn(vscodeMock.workspace, 'getWorkspaceFolder').mockReturnValue(undefined as any);
    expect(diagnostics(doc('/ailleurs/A.kt', AVEC_LITTERAL)).length).toBeGreaterThan(0);
  });

  it('le source jar du cache Gradle reste ecarte', () => {
    allume();
    const jar = '/Users/k/.gradle/caches/databinding-runtime-9.3.1-sources.jar!androidx/A.kt';
    expect(diagnostics(doc(jar, AVEC_LITTERAL))).toHaveLength(0);
  });
});
