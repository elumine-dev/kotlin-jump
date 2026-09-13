import { describe, it, expect } from 'vitest';
import * as vscodeMock from '../__mocks__/vscode';
import { addCascadePlan } from '../../../src/providers/applyCascade';

/**
 * Ce que la cascade RAPPORTE est ce qu elle a mis dans l edition.
 *
 * Deux commandes ajoutent ces deux nombres a leur compte rendu, `N orphaned
 * imports` et `M emptied files`, depuis la 1.42.293 qui a fait lire au rapport
 * ce qui part vraiment. C est donc la moitie PRODUITE d une paire dont la
 * moitie consommee est eprouvee, et aucun test n importait ce module : il n en
 * avait aucun.
 *
 * Le compte des imports se fait deja dans la boucle qui les emet, et saute
 * proprement un fichier dont le texte manque. Celui des fichiers se prenait sur
 * la TAILLE DU PLAN : d accord aujourd hui parce que rien n y est saute, faux
 * le jour ou un `continue` apparait. Il se prend maintenant dans la boucle.
 */

const uri = (p: string) => String(p);
const entrees = (e: any) => e.entries().map((x: any) => ({
  chemin: uri(x.uri?.fsPath ?? x.uri), confirm: x.metadata?.needsConfirmation }));
const suppressions = (e: any) => e._fileDeletes.map((d: any) => uri(d.uri?.fsPath ?? d.uri));

const plan = (deleteFiles: string[], imports: [string, { start: number; end: number }[]][]) => ({
  deleteFiles: new Set(deleteFiles),
  imports: new Map(imports),
});

const TEXTE = 'package p\n\nimport a.B\nimport c.D\n\nclass E\n';

describe('addCascadePlan rend ce qu il a ecrit', () => {
  it('les imports comptes sont les remplacements ajoutes', () => {
    const edit = new vscodeMock.WorkspaceEdit();
    const r = addCascadePlan(edit as any,
      plan([], [['/w/A.kt', [{ start: 11, end: 22 }, { start: 22, end: 33 }]]]) as any,
      new Map([['/w/A.kt', TEXTE]]));
    expect(r.imports).toBe(2);
    expect(entrees(edit).length).toBe(2);
  });

  it('un fichier sans texte mesure est saute, et pas compte', () => {
    const edit = new vscodeMock.WorkspaceEdit();
    const r = addCascadePlan(edit as any,
      plan([], [['/w/A.kt', [{ start: 11, end: 22 }]], ['/w/Absent.kt', [{ start: 0, end: 5 }]]]) as any,
      new Map([['/w/A.kt', TEXTE]]));
    expect(r.imports).toBe(1);
    expect(entrees(edit).length).toBe(1);
  });

  it('les fichiers comptes sont les suppressions ajoutees', () => {
    const edit = new vscodeMock.WorkspaceEdit();
    const r = addCascadePlan(edit as any, plan(['/w/X.kt', '/w/Y.kt'], []) as any, new Map());
    expect(r.files).toBe(2);
    expect(suppressions(edit).length).toBe(2);
  });

  it('les deux ensemble, et rien de plus', () => {
    const edit = new vscodeMock.WorkspaceEdit();
    const r = addCascadePlan(edit as any,
      plan(['/w/X.kt'], [['/w/A.kt', [{ start: 11, end: 22 }]]]) as any,
      new Map([['/w/A.kt', TEXTE]]));
    expect([r.imports, r.files]).toEqual([1, 1]);
    expect([entrees(edit).length, suppressions(edit).length]).toEqual([1, 1]);
  });

  it('le drapeau d apercu atteint chaque entree, remplacements et suppressions', () => {
    const edit = new vscodeMock.WorkspaceEdit();
    addCascadePlan(edit as any,
      plan(['/w/X.kt'], [['/w/A.kt', [{ start: 11, end: 22 }]]]) as any,
      new Map([['/w/A.kt', TEXTE]]), false);
    expect(entrees(edit).every(e => e.confirm === false)).toBe(true);
    expect(edit._fileDeletes.every((d: any) => d.metadata?.needsConfirmation === false)).toBe(true);
  });
});
