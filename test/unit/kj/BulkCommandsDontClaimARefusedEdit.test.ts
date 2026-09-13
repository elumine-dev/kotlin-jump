import { describe, it, expect, vi, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as vscodeMock from '../__mocks__/vscode';
import { aplatirSource, ligneDe } from './harness';
import { removeAllUnusedResourceKeysCommand } from '../../../src/commands/FindUnusedResourceKeys';
import { UnusedResourceKeyProvider } from '../../../src/providers/UnusedResourceKeyProvider';
import { removeAllUnusedSymbolsCommand } from '../../../src/commands/FindUnusedSymbols';
import { UnusedSymbolProvider } from '../../../src/providers/UnusedSymbolProvider';

/**
 * Une edition refusee ne s annonce pas comme faite.
 *
 * Les v1.42.277 et .278 ont donne la parole a quatre commandes qui
 * appliquaient sans un mot. Elles la prennent trop vite : le resultat de
 * `applyEdit` n est pas lu, et l editeur refuse une edition entiere sans un
 * bruit, notamment quand deux plages se chevauchent. Le message annoncait donc
 * « Removed 320 unreferenced declarations in 74 files. » sur un fichier
 * intact.
 *
 * Un silence etait un defaut ; une fausse nouvelle est pire, parce que le
 * lecteur cesse de chercher. Deux commandes de la famille lisaient deja le
 * resultat et disent « Nothing was applied. » : c est le mot de la maison.
 */

afterEach(() => vi.restoreAllMocks());

const RES = '/w/app/src/main/res/values/strings.xml';
const SOURCES_RES = [
  { path: RES, text: '<resources>\n    <string name="morte_a">A</string>\n</resources>\n' },
  { path: '/w/app/src/main/java/p/Main.kt', text: 'package p\n\nfun main() {\n    println(1)\n}\n' },
  { path: '/w/app/build.gradle', text: "plugins { id 'com.android.application' }\n" },
];
const SOURCES_SYM = [
  { path: '/w/app/src/main/java/p/A.kt', text: 'package p\n\nclass Morte {\n    fun f() = 1\n}\n' },
  { path: '/w/app/src/main/java/p/Main.kt', text: 'package p\n\nfun main() {\n    println(1)\n}\n' },
  { path: '/w/app/build.gradle', text: "plugins { id 'com.android.application' }\n" },
];

async function lance(sources: typeof SOURCES_RES, accepte: boolean, quoi: 'res' | 'sym') {
  (vscodeMock.workspace as any).workspaceFolders = [{ uri: vscodeMock.Uri.file('/w'), path: '/w' }];
  vi.spyOn(vscodeMock.workspace, 'getConfiguration').mockReturnValue({ get: (_k: string, d: any) => d } as any);
  vi.spyOn(vscodeMock.workspace, 'textDocuments', 'get').mockReturnValue([] as any);
  (vscodeMock.workspace as any).fs = {
    readFile: async (uri: any) => Buffer.from(
      sources.find(s => s.path === (uri.fsPath ?? String(uri)))?.text ?? '', 'utf8'),
  };
  let editions = 0;
  (vscodeMock.workspace as any).applyEdit = async () => { editions++; return accepte; };
  const infos: string[] = [];
  const alertes: string[] = [];
  vi.spyOn(vscodeMock.window, 'showInformationMessage').mockImplementation((async (m: string, o?: any, ...items: string[]) => {
    if (o?.modal) return items[0];
    infos.push(m);
    return undefined;
  }) as any);
  vi.spyOn(vscodeMock.window, 'showWarningMessage').mockImplementation((async (m: string) => { alertes.push(m); return undefined; }) as any);
  const corpus: any = {
    get: async () => ({
      sources, index: null, modulesWithCode: ['/w/app'], libraryModules: [],
      truncated: false, sourcesTruncated: false, moduleDirs: ['/w/app'],
    }),
    invalidate: () => {},
  };
  if (quoi === 'res') await removeAllUnusedResourceKeysCommand(corpus, new UnusedResourceKeyProvider());
  else await removeAllUnusedSymbolsCommand(corpus, new UnusedSymbolProvider());
  return { editions, infos: infos.join(' | '), alertes: alertes.join(' | ') };
}

describe('une edition refusee ne s annonce pas comme faite', () => {
  it('temoin : acceptee, les cles de ressources sont annoncees', async () => {
    const r = await lance(SOURCES_RES, true, 'res');
    expect(r.editions).toBe(1);
    expect(r.infos).toContain('1 unused resource key');
  });

  it('refusee, la commande des cles de ressources ne dit pas Removed', async () => {
    const r = await lance(SOURCES_RES, false, 'res');
    expect(r.editions).toBe(1);
    expect(r.infos).not.toContain('Removed');
    expect(`${r.infos} ${r.alertes}`).toContain('Nothing was applied.');
  });

  it('temoin : acceptee, les declarations sont annoncees', async () => {
    const r = await lance(SOURCES_SYM, true, 'sym');
    expect(r.editions).toBe(1);
    expect(r.infos).toContain('unreferenced declaration');
  });

  it('refusee, la commande des declarations ne dit pas Removed', async () => {
    const r = await lance(SOURCES_SYM, false, 'sym');
    expect(r.editions).toBe(1);
    expect(r.infos).not.toContain('Removed');
    expect(`${r.infos} ${r.alertes}`).toContain('Nothing was applied.');
  });
});

/**
 * Et la regle, pour toute la famille : le resultat de `applyEdit` se lit.
 *
 * Le gardien voisin verifie qu un message SUIT l edition. Il ne dit rien de ce
 * que ce message raconte, et c est par la que les quatre commandes sont
 * passees. Celui-ci demande que le retour soit nomme, et que ce nom serve.
 */
describe('la famille lit le resultat de son edition', () => {
  const EXEMPTES = new Map<string, string>([
    ['src/commands/DeadCodeSweep.ts:243', 'le balayage par fichier passe toujours par l apercu et n annonce rien'],
  ]);

  it('chaque applyEdit de la famille nomme son resultat et le relit', () => {
    const depot = path.resolve(__dirname, '..', '..', '..');
    const dir = path.join(depot, 'src', 'commands');
    const aveugles: string[] = [];
    const servies = new Set<string>();
    for (const nom of fs.readdirSync(dir).filter(n => n.endsWith('.ts'))) {
      const texte = fs.readFileSync(path.join(dir, nom), 'utf8');
      if (!texte.includes('askHowToApply')) continue;
      const rel = `src/commands/${nom}`;
      const lignes = texte.split('\n');
      // La liaison se lit sur l EXPRESSION. Ecrite
      //     const applique = await vscode.workspace
      //       .applyEdit(choisi.edit);
      // elle est parfaitement correcte, et la version ligne a ligne de ce
      // gardien la denoncait comme un resultat jete : un faux positif qui
      // apprend au lecteur suivant que la regle serait de tenir sur une ligne.
      const { plat, ou } = aplatirSource(texte);
      for (const m of plat.matchAll(/\bapplyEdit\s*\(/g)) {
        const i = m.index!;
        const ligne = ligneDe(texte, ou, i);
        const cle = `${rel}:${ligne}`;
        if (EXEMPTES.has(cle)) { servies.add(cle); continue; }
        const avant = plat.slice(Math.max(0, i - 120), i);
        const nomme = /\b(?:const|let)\s+([A-Za-z_$][\w$]*)\s*=\s*await\s+[\w.\s]*$/.exec(avant);
        if (!nomme) { aveugles.push(`${cle} (resultat jete)`); continue; }
        let fin = ligne;
        while (fin < lignes.length && !/^(?:export )?(?:async )?function /.test(lignes[fin])) fin++;
        const portee = lignes.slice(ligne, fin).join('\n');
        // Mentionner le nom ne suffit pas : `void applique;` le mentionne. Il
        // faut qu il COMMANDE quelque chose, les deux tournures de la maison
        // etant `if (!ok)` et `ok ? … : …`.
        const garde = new RegExp(`if\\s*\\(\\s*!?\\s*${nomme[1]}\\b|\\b${nomme[1]}\\s*\\?`);
        if (!garde.test(portee)) aveugles.push(`${cle} (resultat nomme puis ignore)`);
      }
    }
    expect(aveugles, 'une edition dont le refus passerait inapercu').toEqual([]);
    const perimees = [...EXEMPTES.keys()].filter(k => !servies.has(k));
    expect(perimees, 'exemption qui ne correspond plus a rien').toEqual([]);
  });
});
