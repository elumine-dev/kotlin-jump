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

  it('reglage rallume apres coup : la premiere ampoule paie le balayage a froid', async () => {
    // Sans prechauffage, le chemin froid doit quand meme rendre l action.
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
});
