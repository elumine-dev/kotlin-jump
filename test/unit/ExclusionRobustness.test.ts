/**
 * Ce que `kotlinJump.excludePatterns` fait quand on le pousse un peu.
 *
 * Trois defauts, tous sur le meme reglage, tous verifies ici avant d'etre
 * corriges :
 *
 *  1. Le balayage de code mort passe `undefined` a `findFiles` et filtre
 *     APRES le plafond. Les sorties de build remplissent donc le quota, le
 *     balayage se declare tronque et conseille de lever une limite qui n'est
 *     pas la cause.
 *  2. `makeExclusionMatcher` teste le chemin ABSOLU en premier. Un projet
 *     range sous un dossier nomme `build` voit donc tous ses fichiers exclus,
 *     alors que le motif `**​/build/**` est relatif a la racine du workspace.
 *  3. Une entree vide dans le reglage fait lever picomatch, et cette levee se
 *     produit en plein `activate()`.
 */
import { describe, it, expect } from 'vitest';
import picomatch from 'picomatch';
import { Uri, workspace } from './__mocks__/vscode';
import { excludeGlob, makeExclusionMatcher } from '../../src/util/pathExclusion';

const NL = String.fromCharCode(10);

describe('makeExclusionMatcher — un motif est relatif a la racine du workspace', () => {
  it('un projet range sous un dossier nomme build n est pas exclu en entier', () => {
    // `**​/build/**` veut dire « un dossier build DANS le projet ». Le chemin
    // du projet lui meme ne devrait rien y changer.
    const racine = '/Users/q/build/monapp';
    const exclu = makeExclusionMatcher(['**/build/**', '**/.gradle/**'], [racine]);

    expect(exclu(racine + '/app/src/main/kotlin/Ecran.kt'), 'un source normal').toBe(false);
    expect(exclu(racine + '/app/build/generated/G.kt'), 'un vrai dossier de sortie').toBe(true);
  });

  it('meme chose pour un dossier parent nomme generated', () => {
    const racine = '/home/ci/generated/checkout';
    const exclu = makeExclusionMatcher(['**/generated/**'], [racine]);
    expect(exclu(racine + '/src/A.kt')).toBe(false);
    expect(exclu(racine + '/app/generated/B.kt')).toBe(true);
  });

  it('sans racine connue, le chemin absolu reste le seul recours', () => {
    const exclu = makeExclusionMatcher(['**/build/**']);
    expect(exclu('/ailleurs/app/build/G.kt')).toBe(true);
    expect(exclu('/ailleurs/app/src/A.kt')).toBe(false);
  });

  it('un motif relatif ecrit tel quel est reconnu', () => {
    const racine = '/w/projet';
    const exclu = makeExclusionMatcher(['app/build/**'], [racine]);
    expect(exclu(racine + '/app/build/G.kt')).toBe(true);
    expect(exclu(racine + '/lib/build/G.kt'), 'le motif ne vise que app').toBe(false);
  });
});

describe('une entree vide dans le reglage ne doit rien casser', () => {
  // picomatch leve `Expected pattern to be a non-empty string`, et la
  // construction du matcheur se fait en plein activate() : toute l extension
  // meurt, pas seulement l exclusion.
  it('makeExclusionMatcher ne leve pas', () => {
    expect(() => makeExclusionMatcher([''])).not.toThrow();
    expect(() => makeExclusionMatcher(['**/build/**', ''])).not.toThrow();
    expect(() => makeExclusionMatcher([null as any, undefined as any, 42 as any])).not.toThrow();
  });

  it('et les motifs valides du meme reglage continuent d exclure', () => {
    const exclu = makeExclusionMatcher(['', '**/build/**']);
    expect(exclu('app/build/G.kt')).toBe(true);
    expect(exclu('app/src/A.kt')).toBe(false);
  });

  it('excludeGlob ignore les entrees vides au lieu de les mettre dans le groupe', () => {
    // `{**​/build/**,build/**,}` a une branche vide, que les moteurs de glob
    // n'ont aucune raison de bien traiter.
    const motif = excludeGlob(['**/build/**', '']);
    expect(motif).not.toMatch(/,\s*[,}]/);
    expect(motif).not.toMatch(/\{\s*,/);
    expect(picomatch(motif!, { dot: true })('app/build/G.kt')).toBe(true);
    expect(excludeGlob(['', '   ']), 'rien que du vide, donc rien a exclure').toBeUndefined();
  });
});

describe('DeadCodeSweep — l exclusion doit passer AVANT le plafond', () => {
  // Racine choisie exprès sous un dossier nomme `build` : la ceinture qui
  // suit `findFiles` teste des chemins absolus, donc sans connaitre la racine
  // elle rejetterait le projet ENTIER.
  const RACINE = '/w/build/projet';
  // Ordre reel d'un parcours de systeme de fichiers : dans un module,
  // `build/` vient avant `src/`.
  const SORTIES = Array.from({ length: 60 }, (_, i) => 'app/build/generated/G' + i + '.kt');
  const SOURCES = Array.from({ length: 50 }, (_, i) => 'app/src/main/kotlin/S' + i + '.kt');
  const CORPUS = [...SORTIES, ...SOURCES];
  const PLAFOND = 100; // 110 fichiers pour 100 places : le plafond mord

  async function balayer(): Promise<{ lus: string[]; tronque: boolean }> {
    const origCfg = workspace.getConfiguration;
    const origFind = (workspace as any).findFiles;
    const origLire = (workspace.fs as any).readFile;
    const origDossiers = (workspace as any).workspaceFolders;

    (workspace as any).workspaceFolders = [{ uri: Uri.file(RACINE) }];
    workspace.getConfiguration = () => ({
      get: (cle: string, defaut: any) => {
        if (cle === 'maxIndexedFiles') return PLAFOND;
        if (cle === 'excludePatterns') return ['**/build/**', '**/.gradle/**', '**/generated/**'];
        return defaut;
      },
      update: async () => {},
    }) as any;

    // Emulation fidele de findFiles : filtrer par le motif, puis par
    // l'exclusion, puis SEULEMENT ensuite couper au plafond.
    (workspace as any).findFiles = async (glob: string, exclure: string | undefined, max: number) => {
      const inclus = picomatch(glob, { dot: true });
      const rejete = exclure ? picomatch(exclure, { dot: true }) : () => false;
      return CORPUS.filter(c => inclus(c) && !rejete(c)).slice(0, max).map(c => Uri.file(RACINE + '/' + c));
    };

    const lus: string[] = [];
    (workspace.fs as any).readFile = async (uri: any) => {
      lus.push(String(uri.fsPath).slice(RACINE.length + 1));
      return new TextEncoder().encode('package p' + NL + 'class C' + NL);
    };

    try {
      const { scanWorkspace } = await import('../../src/commands/DeadCodeSweep');
      const scan = await scanWorkspace();
      return { lus, tronque: scan.truncated };
    } finally {
      workspace.getConfiguration = origCfg;
      (workspace as any).findFiles = origFind;
      (workspace.fs as any).readFile = origLire;
      (workspace as any).workspaceFolders = origDossiers;
    }
  }

  it('balaie TOUS les sources, et ne se declare pas tronque', async () => {
    const { lus, tronque } = await balayer();
    // Sans exclusion cote findFiles, les 60 sorties mangent 60 des 100
    // places, il ne reste que 40 sources sur 50, et le balayage annonce
    // « des fichiers ont ete sautes, levez kotlinJump.maxIndexedFiles »
    // alors que le plafond n'a jamais ete le probleme.
    expect(lus.filter(f => f.includes('/build/')), 'aucune sortie de build lue').toEqual([]);
    expect(lus.sort()).toEqual([...SOURCES].sort());
    expect(tronque, 'le plafond n est pas atteint une fois l exclusion appliquee').toBe(false);
  });
});
