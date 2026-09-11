/**
 * KJ-014 — « 0 write » sur un etat ecrit dans quatre autres fichiers.
 *
 * Le compte d'ecritures ne regarde que le fichier courant. Pour un
 * `private val _x`, c'est toute la verite : rien d'autre ne peut l'ecrire. Pour
 * une propriete non privee, non : elle s'ecrit depuis n'importe ou.
 *
 * La lentille des lecteurs le dit deja, « N readers in this file », parce que
 * les collecteurs Compose vivent ailleurs. Celle des ecritures affichait
 * `✎ 0 writes` sans reserve.
 *
 * Mesure sur /Users/kevin/Desktop/work/lapresse, par le chemin de production :
 * 319 etats detectes, 269 prives, 21 non prives affiches a zero, et **3** de
 * ces 21 sont bel et bien ecrits ailleurs. `contentIsInflatedState`, declare
 * dans TemplateScreen.kt, est ecrit dans quatre autres fichiers et la lentille
 * annonçait « 0 writes ».
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import * as vscodeMock from './__mocks__/vscode';
import {
  analyzeStateProvenance,
  StateProvenanceProvider,
} from '../../src/providers/StateProvenanceProvider';

const NL = String.fromCharCode(10);
afterEach(() => vi.restoreAllMocks());

const fichier = (corps: string[]) => ['class Vm {', ...corps.map(l => '    ' + l), '}'].join(NL);

function titres(corps: string[]): string[] {
  vi.spyOn(vscodeMock.workspace, 'getConfiguration').mockReturnValue({
    get: (_c: string, def: any) => def,
  } as any);
  const texte = fichier(corps);
  const doc = {
    languageId: 'kotlin',
    version: 1,
    uri: { toString: () => 'file:///w/Vm.kt', fsPath: '/w/Vm.kt' },
    getText: () => texte,
  } as any;
  return new StateProvenanceProvider().provideCodeLenses(doc).map(l => l.command!.title);
}

/** Le seul segment qui parle des ecritures, isole du reste du titre. */
function segmentEcritures(corps: string[]): string {
  const SEP = String.fromCharCode(183);   // le point median qui joint deux lentilles
  for (const t of titres(corps)) {
    for (const part of t.split(SEP)) if (part.includes('write')) return part.trim();
  }
  return '';
}

describe('analyzeStateProvenance — la visibilite de la declaration', () => {
  it('private est reconnu', () => {
    const [s] = analyzeStateProvenance(fichier(['private val _x = MutableStateFlow(0)']));
    expect(s.isPrivate).toBe(true);
  });

  it('internal et override ne sont pas prives', () => {
    const etats = analyzeStateProvenance(fichier([
      'internal val a = MutableStateFlow(0)',
      'override val b = MutableStateFlow(0)',
      'val c = MutableStateFlow(0)',
    ]));
    expect(etats.map(s => s.isPrivate)).toEqual([false, false, false]);
  });
});

describe('StateProvenanceProvider — la portee du compte d ecritures', () => {
  it('etat non prive sans ecriture ici : le segment dit la portee', () => {
    expect(segmentEcritures(['val toolbarTitle = MutableStateFlow("")']))
      .toContain('0 writes in this file');
  });

  it('etat prive : pas de reserve, le fichier EST la portee', () => {
    const seg = segmentEcritures(['private val _x = MutableStateFlow(0)']);
    expect(seg).toContain('0 writes');
    expect(seg, 'rien a preciser quand rien d autre ne peut ecrire').not.toContain('in this file');
  });

  it('etat non prive avec des ecritures ici : la reserve tient toujours', () => {
    expect(segmentEcritures([
      'val etat = MutableStateFlow(0)',
      'fun majuscule() {',
      '    etat.value = 1',
      '}',
    ])).toContain('1 write in this file');
  });

  it('la mention indirecte reste lisible a cote de la portee', () => {
    const seg = segmentEcritures([
      'val etat = MutableStateFlow(0)',
      'fun ecrit() { etat.value = 1 }',
      'fun passe() { ecrit() }',
    ]);
    expect(seg).toContain('in this file');
    expect(seg).toContain('indirect');
  });

  it('temoin : la lentille des lecteurs garde sa propre mention', () => {
    const t = titres(['private val _x = MutableStateFlow(0)']);
    expect(t.some(x => x.includes('reader') && x.includes('in this file')), t.join(' | ')).toBe(true);
  });
});
