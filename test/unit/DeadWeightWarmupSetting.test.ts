/**
 * Le prechauffage de DeadWeightActionProvider ne regarde plus que le reglage.
 *
 * Le constructeur lance un balayage complet du projet des l'activation, pour
 * que la premiere ampoule ne fasse pas attendre VS Code. Il le faisait sans
 * consulter `kotlinJump.deadWeightQuickFixes`, donc quelqu'un qui a coupe ces
 * correctifs payait quand meme le balayage.
 *
 * Mesure A/B entrelacee sur /Users/kevin/Desktop/work/lapresse, lecture seule
 * des memes fichiers, cinq passes alternees :
 *   plafond 4000  : mediane 60 ms, 26,5 Mo retenus
 *   listing 6278  : mediane 92 ms, 40,8 Mo retenus
 * La v1.42.178 a fait passer ce balayage de 4000 a 6278 fichiers, soit
 * +14,3 Mo gardes en memoire pour la duree de la session, et +31 ms pendant
 * l'activation. Pour un reglage a false, c'est entierement perdu.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as vscodeMock from './__mocks__/vscode';
import { DeadWeightActionProvider } from '../../src/providers/DeadWeightActionProvider';
import { Range, Position } from './__mocks__/vscode';

const NL = String.fromCharCode(10);
const encode = (s: string) => new TextEncoder().encode(s);
const attendre = async () => { for (let i = 0; i < 8; i++) await new Promise<void>(r => setTimeout(r, 0)); };

afterEach(() => vi.restoreAllMocks());

const GRADLE = [
  'dependencies {',
  '    implementation("com.squareup.retrofit2:retrofit:2.9.0")',
  '}',
].join(NL);

function harnais(actif: boolean) {
  const findFiles = vi.spyOn(vscodeMock.workspace, 'findFiles').mockImplementation((async () => (
    Array.from({ length: 5 }, (_, i) => ({
      toString: () => `file:///w/src/F${i}.kt`,
      fsPath: `/w/src/F${i}.kt`,
    }))
  )) as any);
  vi.spyOn(vscodeMock.workspace.fs as any, 'readFile').mockImplementation(
    (async () => encode('import kotlin.math.max' + NL + 'class A')) as any,
  );
  vi.spyOn(vscodeMock.workspace, 'getConfiguration').mockReturnValue({
    get: (cle: string, def: any) => (cle === 'deadWeightQuickFixes' ? actif : def),
  } as any);
  return findFiles;
}

const documentGradle = () => {
  const lignes = GRADLE.split(NL);
  return {
    uri: { fsPath: '/w/app/build.gradle.kts', toString: () => 'file:///w/app/build.gradle.kts' },
    lineCount: lignes.length,
    lineAt: (i: number) => ({ text: lignes[i] }),
    getText: () => GRADLE,
  } as any;
};

describe('DeadWeightActionProvider — prechauffage', () => {
  it('reglage coupe : aucun balayage a la construction', async () => {
    const findFiles = harnais(false);
    const p = new DeadWeightActionProvider();
    await attendre();
    expect(findFiles, 'rien ne doit partir en lecture').not.toHaveBeenCalled();
    expect(p, 'le fournisseur existe quand meme').toBeTruthy();
  });

  it('reglage actif : le balayage part bien', async () => {
    const findFiles = harnais(true);
    new DeadWeightActionProvider();
    await attendre();
    expect(findFiles).toHaveBeenCalled();
  });

  it('reglage coupe : aucune action proposee non plus', async () => {
    harnais(false);
    const p = new DeadWeightActionProvider();
    await attendre();
    const actions = await p.provideCodeActions(
      documentGradle(),
      new Range(new Position(1, 4), new Position(1, 4)) as any,
    );
    expect(actions).toEqual([]);
  });

  it('reglage actif : l action arrive, prechauffage compris', async () => {
    harnais(true);
    const p = new DeadWeightActionProvider();
    await attendre();
    const actions = await p.provideCodeActions(
      documentGradle(),
      new Range(new Position(1, 4), new Position(1, 4)) as any,
    );
    expect(actions.map(a => a.title))
      .toEqual(['Remove unused dependency com.squareup.retrofit2:retrofit']);
  });

  it('rallume sans evenement vu : le chemin froid rend quand meme l action', async () => {
    // Filet de securite : si l evenement de configuration n arrive pas, la
    // premiere ampoule paie le balayage elle meme plutot que de rendre [].
    let actif = false;
    vi.spyOn(vscodeMock.workspace, 'findFiles').mockImplementation((async () => (
      Array.from({ length: 5 }, (_, i) => ({
        toString: () => `file:///w/src/F${i}.kt`,
        fsPath: `/w/src/F${i}.kt`,
      }))
    )) as any);
    vi.spyOn(vscodeMock.workspace.fs as any, 'readFile').mockImplementation(
      (async () => encode('import kotlin.math.max' + NL + 'class A')) as any,
    );
    vi.spyOn(vscodeMock.workspace, 'getConfiguration').mockReturnValue({
      get: (cle: string, def: any) => (cle === 'deadWeightQuickFixes' ? actif : def),
    } as any);

    const p = new DeadWeightActionProvider();
    await attendre();
    actif = true;
    const actions = await p.provideCodeActions(
      documentGradle(),
      new Range(new Position(1, 4), new Position(1, 4)) as any,
    );
    expect(actions.map(a => a.title))
      .toEqual(['Remove unused dependency com.squareup.retrofit2:retrofit']);
  });

  it('rallume par l evenement de configuration : le prechauffage repart seul', async () => {
    let actif = false;
    let ecouteur: ((e: any) => void) | undefined;
    vi.spyOn(vscodeMock.workspace, 'onDidChangeConfiguration')
      .mockImplementation(((cb: any) => { ecouteur = cb; return { dispose: () => {} }; }) as any);
    const findFiles = harnais(false);
    vi.spyOn(vscodeMock.workspace, 'getConfiguration').mockReturnValue({
      get: (cle: string, def: any) => (cle === 'deadWeightQuickFixes' ? actif : def),
    } as any);

    const p = new DeadWeightActionProvider();
    await attendre();
    expect(findFiles, 'coupe au demarrage, rien ne part').not.toHaveBeenCalled();

    actif = true;
    ecouteur?.({ affectsConfiguration: (cle: string) => cle === 'kotlinJump.deadWeightQuickFixes' });
    await attendre();
    expect(findFiles, 'le prechauffage part sans attendre une ampoule').toHaveBeenCalled();
    p.dispose();
  });

  it('coupe apres coup : les caches sont relaches', async () => {
    let actif = true;
    let ecouteur: ((e: any) => void) | undefined;
    vi.spyOn(vscodeMock.workspace, 'onDidChangeConfiguration')
      .mockImplementation(((cb: any) => { ecouteur = cb; return { dispose: () => {} }; }) as any);
    harnais(true);
    vi.spyOn(vscodeMock.workspace, 'getConfiguration').mockReturnValue({
      get: (cle: string, def: any) => (cle === 'deadWeightQuickFixes' ? actif : def),
    } as any);

    const p = new DeadWeightActionProvider();
    await attendre();
    expect((p as any)._sources, 'le balayage a bien rempli le cache').toBeTruthy();

    actif = false;
    ecouteur?.({ affectsConfiguration: (cle: string) => cle === 'kotlinJump.deadWeightQuickFixes' });
    await attendre();
    // 40,8 Mo de texte sur le vrai projet : les garder pour une fonctionnalite
    // coupee est exactement ce que ce correctif evite.
    expect((p as any)._sources, 'le cache est rendu').toBeUndefined();
    expect((p as any)._imports).toBeUndefined();
    p.dispose();
  });

  it('dispose libere l ecoute et les caches', async () => {
    let libere = false;
    vi.spyOn(vscodeMock.workspace, 'onDidChangeConfiguration')
      .mockImplementation((() => ({ dispose: () => { libere = true; } })) as any);
    harnais(true);
    const p = new DeadWeightActionProvider();
    await attendre();
    p.dispose();
    expect(libere, 'l ecoute de configuration doit etre liberee').toBe(true);
    expect((p as any)._sources).toBeUndefined();
  });

  it('les deux points d entree liberent le fournisseur', () => {
    // Construit en ligne dans registerCodeActionsProvider, il ecoutait la
    // configuration sans que personne ne puisse le liberer.
    for (const f of ['extension.ts', 'extension.browser.ts']) {
      const src = fs.readFileSync(path.resolve(__dirname, '..', '..', 'src', f), 'utf8');
      expect(src, `${f} : pas de construction en ligne`)
        .not.toMatch(/new DeadWeightActionProvider\(\)\s*,/);
      expect(src, `${f} : la variable figure dans les subscriptions`)
        .toMatch(/\n\s*deadWeight,/);
    }
  });

  it('coupe PENDANT le balayage : le scan en vol ne remet pas les caches', async () => {
    // Course : le balayage du demarrage tourne encore (sur le vrai projet il
    // dure plusieurs secondes, 6278 allers-retours). Si l utilisateur coupe le
    // reglage entre temps, _warmUp vide des caches encore vides, puis le scan
    // se termine et REPOSE ses 40,8 Mo. Le reglage est coupe, la memoire reste.
    let actif = true;
    let ecouteur: ((e: any) => void) | undefined;
    let relacher!: () => void;
    const barriere = new Promise<void>(r => { relacher = r; });

    vi.spyOn(vscodeMock.workspace, 'onDidChangeConfiguration')
      .mockImplementation(((cb: any) => { ecouteur = cb; return { dispose: () => {} }; }) as any);
    vi.spyOn(vscodeMock.workspace, 'findFiles').mockImplementation((async () => (
      Array.from({ length: 5 }, (_, i) => ({
        toString: () => `file:///w/src/F${i}.kt`,
        fsPath: `/w/src/F${i}.kt`,
      }))
    )) as any);
    vi.spyOn(vscodeMock.workspace.fs as any, 'readFile').mockImplementation((async () => {
      await barriere;
      return encode('import kotlin.math.max' + NL + 'class A');
    }) as any);
    vi.spyOn(vscodeMock.workspace, 'getConfiguration').mockReturnValue({
      get: (cle: string, def: any) => (cle === 'deadWeightQuickFixes' ? actif : def),
    } as any);

    const p = new DeadWeightActionProvider();
    await attendre();
    expect((p as any)._sources, 'le balayage est encore en vol').toBeUndefined();

    actif = false;
    ecouteur?.({ affectsConfiguration: (cle: string) => cle === 'kotlinJump.deadWeightQuickFixes' });
    relacher();
    await attendre();

    expect((p as any)._sources, 'un scan en vol ne doit pas repeupler un cache coupe').toBeUndefined();
    expect((p as any)._imports, 'ni la liste des imports').toBeUndefined();
    p.dispose();
  });

  it('coupe PENDANT une ampoule : aucune action rendue sur un listing sans garant', async () => {
    // Fenetre etroite mais reelle : l ampoule calcule, l utilisateur coupe le
    // reglage, le scan se termine sans rien mettre en cache. Sans garant, la
    // suite du calcul proposerait quand meme une SUPPRESSION.
    let actif = true;
    let relacher!: () => void;
    const barriere = new Promise<void>(r => { relacher = r; });
    vi.spyOn(vscodeMock.workspace, 'onDidChangeConfiguration')
      .mockImplementation((() => ({ dispose: () => {} })) as any);
    vi.spyOn(vscodeMock.workspace, 'findFiles').mockImplementation((async () => (
      Array.from({ length: 5 }, (_, i) => ({
        toString: () => `file:///w/src/F${i}.kt`,
        fsPath: `/w/src/F${i}.kt`,
      }))
    )) as any);
    vi.spyOn(vscodeMock.workspace.fs as any, 'readFile').mockImplementation((async () => {
      await barriere;
      return encode('import kotlin.math.max' + NL + 'class A');
    }) as any);
    vi.spyOn(vscodeMock.workspace, 'getConfiguration').mockReturnValue({
      get: (cle: string, def: any) => (cle === 'deadWeightQuickFixes' ? actif : def),
    } as any);

    const p = new DeadWeightActionProvider();
    const promesse = p.provideCodeActions(
      documentGradle(),
      new Range(new Position(1, 4), new Position(1, 4)) as any,
    );
    await attendre();
    actif = false;          // coupe pendant l attente
    relacher();
    expect(await promesse, 'rien ne doit etre propose').toEqual([]);
    p.dispose();
  });
});
