import { describe, it, expect, vi, afterEach } from 'vitest';
import * as vscodeMock from '../__mocks__/vscode';
import { estUnFichierReel } from '../../../src/util/inWorkspace';

/**
 * Sur vscode.dev, le fichier que l utilisateur edite n est pas un `file:`.
 *
 * Avant la 1.42.246 ces deux linters ne filtraient que sur `languageId` et
 * tournaient donc sur l hote navigateur. Le correctif qui a sorti les source
 * jars du panneau Problemes a pose une liste blanche `file`/`untitled`, et
 * `vscode-vfs://github/owner/repo/...` est tombe avec les jars : KJ-004 et
 * KJ-016 sont muets sur vscode.dev depuis, sans que rien le dise.
 *
 * La bonne question n est pas le schema, c est « l utilisateur peut-il
 * corriger ce que je signale ». VS Code y repond lui meme avec
 * `workspace.fs.isWritableFileSystem(schema)`, qui rend `false` sur un systeme
 * de fichiers en lecture seule et `undefined` quand aucun fournisseur n est
 * enregistre.
 */

const doc = (uri: any) => ({ uri, languageId: 'kotlin' }) as any;
const dansUnDossier = (racine: string | undefined) =>
  vi.spyOn(vscodeMock.workspace, 'getWorkspaceFolder').mockImplementation(((u: any) =>
    racine !== undefined && String(u.path ?? u.fsPath).startsWith(racine)
      ? { uri: vscodeMock.Uri.file(racine) } : undefined) as any);

afterEach(() => vi.restoreAllMocks());

describe('KJ-051 l hote navigateur est un vrai hote', () => {
  it('un fichier de vscode.dev est analysable', () => {
    dansUnDossier(undefined);
    expect(estUnFichierReel(doc(vscodeMock.Uri.parse('vscode-vfs://github/o/r/A.kt')))).toBe(true);
  });

  it('temoin : la vue git: reste ecartee', () => {
    dansUnDossier(undefined);
    expect(estUnFichierReel(doc(vscodeMock.Uri.parse('git:/w/A.kt')))).toBe(false);
  });

  it('temoin : file: et untitled: passent toujours', () => {
    dansUnDossier(undefined);
    expect(estUnFichierReel(doc(vscodeMock.Uri.file('/w/A.kt')))).toBe(true);
    expect(estUnFichierReel(doc(vscodeMock.Uri.parse('untitled:Untitled-1')))).toBe(true);
  });

  it('un systeme de fichiers declare en lecture seule est ecarte', () => {
    dansUnDossier(undefined);
    vi.spyOn(vscodeMock.workspace.fs, 'isWritableFileSystem').mockImplementation(
      ((s: string) => (s === 'lecture-seule' ? false : undefined)) as any);
    expect(estUnFichierReel(doc(vscodeMock.Uri.parse('lecture-seule:/w/A.kt')))).toBe(false);
    expect(estUnFichierReel(doc(vscodeMock.Uri.parse('autre:/w/A.kt')))).toBe(true);
  });

  it('temoin : une entree de jar reste ecartee, quel que soit le schema', () => {
    dansUnDossier(undefined);
    for (const u of ['vscode-vfs://github/o/r/x-sources.jar!com/x/A.kt', 'file:///w/x.jar!com/x/A.kt']) {
      expect(estUnFichierReel(doc(vscodeMock.Uri.parse(u))), u).toBe(false);
    }
  });

  it('temoin : les racines de dependance restent ecartees sur le web aussi', () => {
    dansUnDossier(undefined);
    const u = 'vscode-vfs://github/o/r/sources/android-35/android/webkit/A.java';
    expect(estUnFichierReel(doc(vscodeMock.Uri.parse(u)))).toBe(false);
  });
});
