import { describe, it, expect, vi, afterEach } from 'vitest';
import * as vscodeMock from '../__mocks__/vscode';
import { removeTestOnlyCodeCommand } from '../../../src/commands/RemoveTestOnlyCode';
import { makeSelfOnlyPrivateCommand } from '../../../src/commands/MakeSelfOnlyPrivate';

/**
 * La relecture du verdict se fait sous une barre.
 *
 * Les 1.42.298 et .299 ont appris a ces deux commandes a rejuger apres le clic
 * quand l espace de travail a bouge. Ce rejugement est la partie LONGUE, une
 * vingtaine de secondes sur six mille fichiers, et il a ete pose HORS de toute
 * barre de progression : la premiere en avait une, elle etait refermee depuis
 * la question. Entre le clic sur « Apply all » et l edition, l interface ne
 * montre donc plus rien.
 *
 * Ce depot connait le probleme : c est exactement ce que la 1.42.248 a corrige
 * pour la boucle du point fixe, « l interface ne montrait plus rien apres le
 * premier scan et la commande avait l air bloquee deux minutes et demie ».
 *
 * Et seulement quand il faut : un corpus inchange ne doit pas faire clignoter
 * une notification pour rien.
 */

const MAIN = '/w/app/src/main/java/p';
const GRADLE = { path: '/w/app/build.gradle', text: "plugins { id 'com.android.application' }\n" };

afterEach(() => vi.restoreAllMocks());

function poser(avant: { path: string; text: string }[], apres: { path: string; text: string }[]) {
  const w = vscodeMock.workspace as any;
  const win = vscodeMock.window as any;
  w.workspaceFolders = [{ uri: vscodeMock.Uri.file('/w'), path: '/w' }];
  vi.spyOn(w, 'getConfiguration').mockReturnValue({ get: (_k: string, d: any) => d } as any);
  vi.spyOn(vscodeMock.workspace, 'textDocuments', 'get').mockReturnValue([] as any);
  let repondu = false;
  const maintenant = () => (repondu ? apres : avant);
  w.fs = {
    readFile: async (uri: any) => Buffer.from(
      maintenant().find(s => s.path === (uri.fsPath ?? String(uri)))?.text ?? '', 'utf8'),
  };
  // Le vrai corpus rend l OBJET de son cache tel quel tant que rien ne l a
  // invalide, et c est cette identite que les commandes lisent pour savoir si
  // le verdict a vieilli. Un decor qui fabrique un objet neuf a chaque appel
  // ferait croire a un changement permanent, et le temoin « rien n a bouge »
  // ne temoignerait de rien.
  let listeServie: unknown;
  let objetServi: any;
  const corpus: any = {
    invalidate: () => {},
    get: async () => {
      const src = maintenant();
      if (listeServie !== src) {
        listeServie = src;
        objetServi = {
          sources: src, index: null, modulesWithCode: ['/w/app'], libraryModules: [],
          truncated: false, sourcesTruncated: false, moduleDirs: ['/w/app'],
        };
      }
      return objetServi;
    },
  };
  const barres: string[] = [];
  win.withProgress = (o: any, t: any) => { barres.push(String(o?.title ?? '')); return t({ report: () => {} }, { isCancellationRequested: false }); };
  win.showInformationMessage = async (_m: string, ...rest: any[]) => {
    if (rest.length > 0 && typeof rest[0] === 'object' && rest[0]?.modal) { repondu = true; return rest.slice(1)[0]; }
    return undefined;
  };
  win.showWarningMessage = async () => undefined;
  w.applyEdit = async () => true;
  return { corpus, barres };
}

const SUJET = { path: `${MAIN}/Sujet.kt`, text: 'package p\n\nclass Sujet {\n    fun utilise() = 1\n}\n\nclass Garde {\n    fun g() = 1\n}\n' };
const PRINCIPAL = { path: `${MAIN}/Main.kt`, text: 'package p\n\nfun main() {\n    println(Garde().g())\n}\n' };
const PRINCIPAL_UTILISE = { path: `${MAIN}/Main.kt`, text: 'package p\n\nfun main() {\n    println(Garde().g() + Sujet().utilise())\n}\n' };
const TEST = {
  path: '/w/app/src/test/java/p/SujetTest.kt',
  text: 'package p\n\nimport org.junit.Test\n\nclass SujetTest {\n    @Test\n    fun premier() {\n        Sujet().utilise()\n    }\n}\n',
};

const BOITE = { path: `${MAIN}/Boite.kt`, text: 'package p\n\nclass Boite {\n    fun aide() = 1\n\n    fun interne() = aide()\n}\n' };
const SANS = { path: `${MAIN}/Appel.kt`, text: 'package p\n\nfun main() {\n    println(Boite().interne())\n}\n' };
const AVEC = { path: `${MAIN}/Appel.kt`, text: 'package p\n\nfun main() {\n    println(Boite().interne() + Boite().aide())\n}\n' };

describe('la relecture du verdict se fait sous une barre', () => {
  it('co-suppression : corpus bouge, une seconde barre apparait', async () => {
    const d = poser([SUJET, PRINCIPAL, GRADLE, TEST], [SUJET, PRINCIPAL_UTILISE, GRADLE, TEST]);
    await removeTestOnlyCodeCommand(d.corpus);
    expect(d.barres.length).toBeGreaterThanOrEqual(2);
  });

  it('co-suppression : corpus inchange, une seule barre', async () => {
    const meme = [SUJET, PRINCIPAL, GRADLE, TEST];
    const d = poser(meme, meme);
    await removeTestOnlyCodeCommand(d.corpus);
    expect(d.barres.length).toBe(1);
  });

  it('rendre prive : corpus bouge, une seconde barre apparait', async () => {
    const d = poser([BOITE, SANS, GRADLE], [BOITE, AVEC, GRADLE]);
    await makeSelfOnlyPrivateCommand(d.corpus);
    expect(d.barres.length).toBeGreaterThanOrEqual(2);
  });

  it('rendre prive : corpus inchange, une seule barre', async () => {
    const meme = [BOITE, SANS, GRADLE];
    const d = poser(meme, meme);
    await makeSelfOnlyPrivateCommand(d.corpus);
    expect(d.barres.length).toBe(1);
  });
});
