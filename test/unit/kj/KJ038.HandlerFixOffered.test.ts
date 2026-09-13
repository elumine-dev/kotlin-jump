import { describe, it, expect, vi, afterEach } from 'vitest';
import * as vscodeMock from '../__mocks__/vscode';
import { UnheardEventProvider } from '../../../src/providers/UnheardEventProvider';

/**
 * Le correctif « Remove this starved @Subscribe handler » n'etait jamais
 * offert dans la forme normale.
 *
 * La garde relisait `document.lineAt(deadHit.line)`, or cette ligne est celle
 * du `fun` / `public void` : dans la forme conventionnelle l'annotation est
 * AU DESSUS, donc la ligne ne contient pas « Subscribe » et la verification
 * echouait toujours. Le diagnostic « Nothing ever posts 'X' » s'affichait avec
 * une etendue de suppression parfaitement calculee, et l'ampoule ne proposait
 * rien. Neuf handlers dans ce cas sur un vrai projet.
 *
 * La bonne question porte sur l'ETENDUE : c'est elle que le correctif
 * supprime, et elle contient l'annotation comme le type de l'evenement.
 */

const CHEMIN = '/w/app/src/main/kotlin/com/x/H.kt';
const doc = (texte: string) => ({
  uri: vscodeMock.Uri.file(CHEMIN),
  getText: () => texte,
  lineAt: (l: number) => ({ text: texte.split('\n')[l] ?? '' }),
  positionAt: (o: number) => new vscodeMock.Position(0, o),
} as any);

const offre = (texte: string, ligneFun: number, nom = 'MortEvent') => {
  vi.spyOn(vscodeMock.workspace, 'getConfiguration').mockReturnValue({ get: (_k: string, d: any) => d } as any);
  const p = new UnheardEventProvider();
  const debut = texte.indexOf('    @Subscribe');
  const fin = texte.indexOf('    }\n}') + 6;
  (p as any).deadByPath = new Map([[CHEMIN, [{ line: ligneFun, name: nom, removeStart: debut, removeEnd: fin }]]]);
  return (p.provideCodeActions(doc(texte), new vscodeMock.Range(ligneFun, 0, ligneFun, 1) as any, {} as any, {} as any) ?? []) as any[];
};

afterEach(() => vi.restoreAllMocks());

describe('l ampoule du handler affame', () => {
  it('annotation sur sa propre ligne, la forme normale', () => {
    const t = ['package com.x', '', 'class H {', '    @Subscribe', '    fun onBusEvent(e: MortEvent) {', '        println(e)', '    }', '}', ''].join('\n');
    const a = offre(t, 4);
    expect(a.length).toBe(1);
    expect(a[0].title).toContain('MortEvent');
  });

  it('annotation en ligne, la forme qui marchait deja', () => {
    const t = ['package com.x', '', 'class H {', '    @Subscribe fun onBusEvent(e: MortEvent) {', '        println(e)', '    }', '}', ''].join('\n');
    expect(offre(t, 3).length).toBe(1);
  });

  it('Java, annotation sur sa propre ligne', () => {
    const t = ['package com.x;', '', 'class H {', '    @Subscribe', '    public void onBusEvent(MortEvent e) {', '        log(e);', '    }', '}', ''].join('\n');
    expect(offre(t, 4).length).toBe(1);
  });

  it('garde : une etendue qui ne couvre plus le handler n offre rien', () => {
    const t = ['package com.x', '', 'class H {', '    @Subscribe', '    fun onBusEvent(e: MortEvent) {', '        println(e)', '    }', '}', ''].join('\n');
    vi.spyOn(vscodeMock.workspace, 'getConfiguration').mockReturnValue({ get: (_k: string, d: any) => d } as any);
    const p = new UnheardEventProvider();
    // Bornes perimees : elles designent le `package`, pas le handler.
    (p as any).deadByPath = new Map([[CHEMIN, [{ line: 4, name: 'MortEvent', removeStart: 0, removeEnd: 14 }]]]);
    const a = p.provideCodeActions(doc(t), new vscodeMock.Range(4, 0, 4, 1) as any, {} as any, {} as any) ?? [];
    expect((a as any[]).length).toBe(0);
  });
});
