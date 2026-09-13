import { describe, it, expect, vi, afterEach } from 'vitest';
import * as vscodeMock from '../__mocks__/vscode';
import { UnheardEventProvider } from '../../../src/providers/UnheardEventProvider';

/**
 * Retirer le dernier `post` d un evenement, ou son dernier abonne, retire
 * aussi l import devenu inutile.
 *
 * Les deux correctifs de la famille supprimaient la seule instruction. Tous
 * les autres correctifs de suppression passent par la cascade d imports, pas
 * ceux la. L import restait, et un projet qui fait tourner detekt echoue sur
 * `NoUnusedImports` : c est la regle qui a fait tomber le build du projet de
 * reference apres une session de nettoyage.
 */

const CHEMIN = '/w/app/src/main/kotlin/com/x/F.kt';
const doc = (texte: string) => ({
  uri: vscodeMock.Uri.file(CHEMIN),
  getText: () => texte,
  lineAt: (l: number) => ({ text: texte.split('\n')[l] ?? '' }),
  positionAt: (o: number) => new vscodeMock.Position(0, o),
} as any);
const ligneDe = (t: string, motif: string) => t.split('\n').findIndex(l => l.includes(motif));
const plageDeLigne = (t: string, n: number) => {
  const debut = t.split('\n').slice(0, n).join('\n').length + (n > 0 ? 1 : 0);
  return { start: debut, end: debut + t.split('\n')[n].length + 1 };
};
/** Les lignes que l edition supprime ENTIERES : c est ainsi que la cascade retire un import. */
const importsRetires = (action: any, t: string): string[] =>
  action.edit._entries
    .filter((e: any) => e.newText === '' && e.range.start.character === 0 && e.range.end.character === 0)
    .map((e: any) => t.split('\n')[e.range.start.line].trim())
    .filter((l: string) => l.startsWith('import '));

/** L instruction elle meme, et pas seulement ses imports : le harnais place un offset en colonne. */
const supprime = (action: any, start: number, end: number): boolean =>
  action.edit._entries.some((e: any) => e.newText === '' && e.range.start.character === start && e.range.end.character === end);

afterEach(() => vi.restoreAllMocks());
const fournisseur = () => {
  vi.spyOn(vscodeMock.workspace, 'getConfiguration').mockReturnValue({ get: (_k: string, d: any) => d } as any);
  return new UnheardEventProvider();
};

describe('le correctif Remove post emporte l import devenu inutile', () => {
  const avec = (posts: string[]) => [
    'package com.x', '',
    'import a.b.event.ScrollEvent',
    'import a.b.common.BusProvider', '',
    'class F {',
    '    fun f() {',
    ...posts,
    '    }',
    '}', ''].join('\n');
  const retire = (t: string, motif: string) => {
    const p = fournisseur();
    const n = ligneDe(t, motif);
    const { start, end } = plageDeLigne(t, n);
    (p as any).byPath = new Map([[CHEMIN, [{
      name: 'ScrollEvent', fqn: 'a.b.event.ScrollEvent', verdict: 'unheard', path: CHEMIN,
      line: n, character: 8, removeStart: start, removeEnd: end,
    }]]]);
    const actions = p.provideCodeActions(doc(t), new vscodeMock.Range(n, 0, n, 1) as any, {} as any, {} as any) as any[];
    const action = actions.find(a => /post/i.test(a.title) && a.edit);
    expect(supprime(action, start, end), 'le post lui meme').toBe(true);
    return action;
  };

  it('dernier post du fichier : les deux imports qu il etait seul a utiliser partent', () => {
    const t = avec(['        BusProvider.getInstance().post(ScrollEvent(true))']);
    expect(importsRetires(retire(t, 'ScrollEvent(true)'), t).sort())
      .toEqual(['import a.b.common.BusProvider', 'import a.b.event.ScrollEvent']);
  });

  it('un autre post reste : aucun import ne part', () => {
    const t = avec([
      '        BusProvider.getInstance().post(ScrollEvent(true))',
      '        BusProvider.getInstance().post(ScrollEvent(false))',
    ]);
    expect(importsRetires(retire(t, 'ScrollEvent(true)'), t)).toEqual([]);
  });
});

describe('le correctif du handler affame emporte ses imports', () => {
  const avec = (handlers: string[]) => [
    'package com.x', '',
    'import com.squareup.otto.Subscribe',
    'import a.b.MortEvent', '',
    'class H {',
    ...handlers,
    '}', ''].join('\n');
  const HANDLER = ['    @Subscribe', '    fun onBusEvent(e: MortEvent) {', '        println(e)', '    }'];
  const retire = (t: string) => {
    const p = fournisseur();
    const ligneFun = ligneDe(t, 'fun onBusEvent');
    const debut = t.indexOf('    @Subscribe');
    const fin = t.indexOf('    }\n', debut) + 6;
    (p as any).deadByPath = new Map([[CHEMIN, [{ line: ligneFun, name: 'MortEvent', removeStart: debut, removeEnd: fin }]]]);
    const actions = p.provideCodeActions(doc(t), new vscodeMock.Range(ligneFun, 0, ligneFun, 1) as any, {} as any, {} as any) as any[];
    expect(supprime(actions[0], debut, fin), 'le handler lui meme').toBe(true);
    return actions[0];
  };

  it('dernier handler : l annotation et le type d evenement ne servent plus', () => {
    const t = avec(HANDLER);
    expect(importsRetires(retire(t), t).sort()).toEqual(['import a.b.MortEvent', 'import com.squareup.otto.Subscribe']);
  });

  it('un autre handler garde Subscribe', () => {
    const t = avec([...HANDLER, '', '    @Subscribe', '    fun autre(e: AutreEvent) {', '        println(e)', '    }']);
    expect(importsRetires(retire(t), t)).toEqual(['import a.b.MortEvent']);
  });
});
