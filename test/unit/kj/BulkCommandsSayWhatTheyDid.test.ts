import { describe, it, expect, vi, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as vscodeMock from '../__mocks__/vscode';
import { removeAllUnusedSymbolsCommand } from '../../../src/commands/FindUnusedSymbols';
import { UnusedSymbolProvider } from '../../../src/providers/UnusedSymbolProvider';

/**
 * Une commande de masse qui applique dit ce qu elle a fait, et previent quand
 * elle efface un fichier.
 *
 * « Apply all » saute l apercu par construction, donc rien ne montre ce qui
 * s est passe. Trois commandes de la famille appliquaient sans un mot, la
 * quatrieme ayant ete corrigee la veille. Le balayage par fichier fait
 * exception a bon droit : il passe toujours par l apercu, et l apercu EST la
 * reponse.
 *
 * L autre moitie est plus grave. Deux declarations mortes dans un meme fichier
 * le vident, donc l edition est une SUPPRESSION DE FICHIER, et le dialogue
 * l annoncait comme « 1 change in 1 file » sans jamais dire qu un fichier
 * partait. Les autres commandes de la famille le disent.
 */

const SOURCES = [
  { path: '/w/app/src/main/java/p/A.kt', text: 'package p\n\nclass Morte {\n    fun f() = 1\n}\n\nclass Aussi {\n    fun h() = 2\n}\n' },
  { path: '/w/app/src/main/java/p/Main.kt', text: 'package p\n\nclass Vivante {\n    fun g() = 3\n}\n\nfun main() {\n    println(Vivante().g())\n}\n' },
  { path: '/w/app/build.gradle', text: "plugins { id 'com.android.application' }\n" },
];

afterEach(() => vi.restoreAllMocks());

async function lance(reponse: 'apply' | 'cancel') {
  (vscodeMock.workspace as any).workspaceFolders = [{ uri: vscodeMock.Uri.file('/w'), path: '/w' }];
  vi.spyOn(vscodeMock.workspace, 'getConfiguration').mockReturnValue({ get: (_k: string, d: any) => d } as any);
  vi.spyOn(vscodeMock.workspace, 'textDocuments', 'get').mockReturnValue([] as any);
  (vscodeMock.workspace as any).fs = {
    readFile: async (uri: any) => Buffer.from(
      SOURCES.find(s => s.path === (uri.fsPath ?? String(uri)))?.text ?? '', 'utf8'),
  };
  const editions: any[] = [];
  (vscodeMock.workspace as any).applyEdit = async (e: any) => { editions.push(e); return true; };
  let detail = '';
  const messages: string[] = [];
  vi.spyOn(vscodeMock.window, 'showInformationMessage').mockImplementation((async (m: string, o?: any, ...items: string[]) => {
    if (o?.modal) { detail = o.detail ?? ''; return reponse === 'cancel' ? undefined : items[0]; }
    messages.push(m);
    return undefined;
  }) as any);
  const corpus: any = {
    get: async () => ({
      sources: SOURCES, index: null, modulesWithCode: ['/w/app'], libraryModules: [],
      truncated: false, sourcesTruncated: false, moduleDirs: ['/w/app'],
    }),
    invalidate: () => {},
  };
  await removeAllUnusedSymbolsCommand(corpus, new UnusedSymbolProvider());
  const e = editions[0];
  return {
    detail, messages, editions: editions.length,
    suppressions: e ? e._fileDeletes.length : 0,
  };
}

describe('les commandes de masse disent ce qu elles ont fait', () => {
  it('temoin : le decor vide un fichier, donc l edition le supprime', async () => {
    expect((await lance('apply')).suppressions).toBe(1);
  });

  it('le dialogue previent qu un fichier part en entier', async () => {
    expect((await lance('apply')).detail).toContain('1 file deleted outright.');
  });

  it('apres Apply all, la commande annonce ce qui est parti', async () => {
    const r = await lance('apply');
    expect(r.messages.join(' | ')).toContain('2 unreferenced declarations');
  });

  it('annuler n applique rien et ne raconte rien', async () => {
    const r = await lance('cancel');
    expect(r.editions).toBe(0);
    expect(r.messages).toEqual([]);
  });
});

/**
 * Et la regle, pour toute la famille : appliquer sans rien dire n arrive plus.
 *
 * Ecrite en dur plutot que devinee : le balayage par fichier est la seule
 * exception, et sa raison est nommee. Une exception qui ne correspond plus a
 * rien fait echouer ce test au lieu de dormir.
 */
describe('aucune commande n applique en silence', () => {
  const EXEMPTES = new Map<string, string>([
    ['src/commands/DeadCodeSweep.ts:243', 'le balayage par fichier passe toujours par l apercu, qui EST la reponse'],
  ]);

  it('chaque applyEdit de la famille est suivi d un message', async () => {
    const depot = path.resolve(__dirname, '..', '..', '..');
    const dir = path.join(depot, 'src', 'commands');
    const muets: string[] = [];
    const servies = new Set<string>();
    for (const nom of fs.readdirSync(dir)) {
      if (!nom.endsWith('.ts')) continue;
      const texte = fs.readFileSync(path.join(dir, nom), 'utf8');
      // La famille est celle qui SAUTE l apercu, c est a dire celle qui pose
      // la question en amont. Ailleurs le silence est juste : l apercu montre
      // ce qui va se passer, et un correctif ponctuel se voit a l ecran.
      if (!texte.includes('askHowToApply')) continue;
      const rel = `src/commands/${nom}`;
      const lignes = texte.split('\n');
      lignes.forEach((l, i) => {
        if (!/\bapplyEdit\s*\(/.test(l)) return;
        const cle = `${rel}:${i + 1}`;
        if (EXEMPTES.has(cle)) { servies.add(cle); return; }
        // Jusqu a la fin de la fonction englobante, pas une fenetre arbitraire :
        // une boucle applique puis rend compte bien plus bas, et c est correct.
        let fin = i + 1;
        while (fin < lignes.length && !/^(?:export )?(?:async )?function /.test(lignes[fin])) fin++;
        const portee = lignes.slice(i, fin).join('\n');
        if (/showInformationMessage|compteRendu/.test(portee)) return;
        muets.push(cle);
      });
    }
    expect(muets, 'une edition appliquee sans un mot').toEqual([]);
    const perimees = [...EXEMPTES.keys()].filter(k => !servies.has(k));
    expect(perimees, 'exemption qui ne correspond plus a rien').toEqual([]);
  });
});
