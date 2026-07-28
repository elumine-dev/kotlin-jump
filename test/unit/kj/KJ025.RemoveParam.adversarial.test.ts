import { describe, it, expect } from 'vitest';
import {
  computeCallSiteEdits,
  findUnusedParameters,
  UnusedParameterCodeActionProvider,
} from '../../../src/providers/UnusedParameterProvider';
import { Range } from '../../unit/__mocks__/vscode';
import { makeDocument } from './harness';

/** KJ-025 — tentatives de casse du QUICK FIX de retrait. */

function applyEdits(text: string, edits: { start: number; end: number }[]): string {
  let out = text;
  for (const e of [...edits].sort((a, b) => b.start - a.start)) {
    out = out.slice(0, e.start) + out.slice(e.end);
  }
  return out;
}

const funParam = (name: string, paramIndex: number, ownerName = 'render') =>
  ({ name, paramIndex, ownerName, kind: 'funParam' as const });
const ctorParam = (name: string, paramIndex: number, ownerName: string) =>
  ({ name, paramIndex, ownerName, kind: 'ctorParam' as const });

describe('KJ-025 adversarial — retrait aux call sites', () => {
  it('retrait positionnel : premier, milieu, dernier, virgules propres', () => {
    const call = 'fun main() { render(1, 2, 3) }\n';
    expect(applyEdits(call, computeCallSiteEdits(call, funParam('a', 0)).edits)).toContain('render(2, 3)');
    expect(applyEdits(call, computeCallSiteEdits(call, funParam('b', 1)).edits)).toContain('render(1, 3)');
    expect(applyEdits(call, computeCallSiteEdits(call, funParam('c', 2)).edits)).toContain('render(1, 2)');
  });

  it('dernier argument restant → liste vide ()', () => {
    const call = 'fun main() { render(42) }\n';
    expect(applyEdits(call, computeCallSiteEdits(call, funParam('a', 0)).edits)).toContain('render()');
  });

  it('argument nommé retiré peu importe sa position', () => {
    const call = 'fun main() { render(b = 2, a = 1) }\n';
    const res = computeCallSiteEdits(call, funParam('b', 1));
    expect(applyEdits(call, res.edits)).toContain('render(a = 1)');
    expect(res.skipped).toBe(0);
  });

  it('trailing lambda hors parenthèses : indices stables', () => {
    const call = 'fun main() { render(1, 2) { done() } }\n';
    expect(applyEdits(call, computeCallSiteEdits(call, funParam('b', 1)).edits)).toContain('render(1) { done() }');
  });

  it('param à défaut non passé : aucun édit, aucun skip', () => {
    const call = 'fun main() { render(1) }\n';
    const res = computeCallSiteEdits(call, funParam('b', 1));
    expect(res.edits).toEqual([]);
    expect(res.skipped).toBe(0);
  });

  it('BUG-HUNT-H : appel entièrement nommé SANS notre param → rien à faire, pas un skip', () => {
    // patron réel vu sur une hiérarchie de modèles Android : super-call tout
    // nommé qui ne passe pas le param à défaut
    const call = 'class Sub(x: Int) : Owner(\n  first = x,\n  second = 2,\n)\n';
    const res = computeCallSiteEdits(call, ctorParam('dead', 5, 'Owner'));
    expect(res).toEqual({ edits: [], skipped: 0 });
  });

  it('BUG-HUNT-H : appel mixte positionnel/nommé avec moins d’args que l’index → rien, pas un skip', () => {
    // patron réel : super-call de pub avec 3 positionnels + 1 nommé, param d'index 5 absent
    const call = 'class Ad(x: Int) : Owner(x, 2, 3, tag = "ad")\n';
    const res = computeCallSiteEdits(call, ctorParam('dead', 5, 'Owner'));
    expect(res).toEqual({ edits: [], skipped: 0 });
  });

  it('argument nommé étranger avant l’index : site skippé, jamais édité', () => {
    const call = 'fun main() { render(first = 9, 2) }\n';
    const res = computeCallSiteEdits(call, funParam('b', 1));
    expect(res.edits).toEqual([]);
    expect(res.skipped).toBe(1);
  });

  it('la déclaration elle-même n’est jamais éditée comme un call site', () => {
    const text = 'private fun render(a: Int, b: Int) { }\nfun main() { render(1, 2) }\n';
    const res = computeCallSiteEdits(text, funParam('b', 1));
    expect(res.edits).toHaveLength(1);
    expect(applyEdits(text, res.edits)).toContain('private fun render(a: Int, b: Int)');
    expect(applyEdits(text, res.edits)).toContain('render(1)');
  });

  it('appel sur un autre receveur skippé, this. autorisé', () => {
    const other = 'fun main() { helper.render(1, 2) }\n';
    expect(computeCallSiteEdits(other, funParam('b', 1))).toEqual({ edits: [], skipped: 1 });
    const self = 'fun main() { this.render(1, 2) }\n';
    expect(computeCallSiteEdits(self, funParam('b', 1)).edits).toHaveLength(1);
  });

  it('référence ::render dans le fichier : tout est skippé (l’arité change)', () => {
    const text = 'fun main() { render(1, 2); items.map(::render) }\n';
    expect(computeCallSiteEdits(text, funParam('b', 1))).toEqual({ edits: [], skipped: 1 });
  });

  it('appel dans une string : ignoré', () => {
    const text = 'fun main() { val s = "render(1, 2)" }\n';
    expect(computeCallSiteEdits(text, funParam('b', 1))).toEqual({ edits: [], skipped: 0 });
  });

  it('argument multi-lignes : la ligne entière part', () => {
    const text = 'fun main() {\n  render(\n    first,\n    dead(x, y),\n    3,\n  )\n}\n';
    const out = applyEdits(text, computeCallSiteEdits(text, funParam('b', 1)).edits);
    expect(out).not.toContain('dead(x, y)');
    expect(out).toContain('first,');
    expect(out).toContain('3,');
    expect(out).not.toMatch(/\n\s*\n\s*3,/); // pas de ligne vide résiduelle
  });

  it('ctor : délégation : this(…) éditée, sous-classe sans appel direct skippée', () => {
    const delegation = 'class A(a: Int, b: Int) {\n  constructor(a: Int) : this(a, 0)\n}\n';
    const res = computeCallSiteEdits(delegation, ctorParam('b', 1, 'A'));
    expect(applyEdits(delegation, res.edits)).toContain(': this(a)');
    const sub = 'class Sub : Owner {\n  constructor(x: Int) : super(x, 2)\n}\n';
    expect(computeCallSiteEdits(sub, ctorParam('b', 1, 'Owner'))).toEqual({ edits: [], skipped: 1 });
  });

  it('appel qualifié com.pkg.ClassName(…) autorisé pour un ctor', () => {
    const text = 'fun main() { val s = com.pkg.Svc("a", 3) }\n';
    expect(computeCallSiteEdits(text, ctorParam('retry', 1, 'Svc')).edits).toHaveLength(1);
  });

  it('BUG-HUNT-B : call site générique Box<Int>(…) trouvé et édité', () => {
    const text = 'fun main() { val x = Box<Int>(1, 2) }\n';
    const res = computeCallSiteEdits(text, ctorParam('dead', 1, 'Box'));
    expect(applyEdits(text, res.edits)).toContain('Box<Int>(1)');
  });

  it('BUG-HUNT-B : supertype générique class Sub : Owner<Int>(x, 2) édité', () => {
    const text = 'class Sub(x: Int) : Owner<Int>(x, 2)\n';
    const res = computeCallSiteEdits(text, ctorParam('dead', 1, 'Owner'));
    expect(applyEdits(text, res.edits)).toContain(': Owner<Int>(x)');
  });

  it('BUG-HUNT-B : comparaison Owner < 3 jamais prise pour un appel générique', () => {
    const text = 'fun main() { if (Owner < 3) go(Owner, 2) }\n';
    expect(computeCallSiteEdits(text, ctorParam('dead', 1, 'Owner')).edits).toEqual([]);
  });

  it('BUG-HUNT-C : this( d’une AUTRE classe du même fichier jamais édité', () => {
    const text = [
      'class A(a: Int, dead: Int) { val v = a }',
      'class B(x: Int, y: Int) {',
      '  val s = x + y',
      '  constructor(x: Int) : this(x, 0)',
      '}',
      '',
    ].join('\n');
    const res = computeCallSiteEdits(text, ctorParam('dead', 1, 'A'));
    expect(res.edits).toEqual([]); // le this(x, 0) appartient à B, pas à A
  });

  it('BUG-HUNT-C : 2 constructeurs secondaires → délégation ambiguë, skippée', () => {
    const text = [
      'class A(a: Int, dead: Int) {',
      '  val v = a',
      '  constructor(a: Int) : this(a, 0)',
      '  constructor() : this(5, 1)',
      '}',
      '',
    ].join('\n');
    const res = computeCallSiteEdits(text, ctorParam('dead', 1, 'A'));
    expect(res.edits).toEqual([]);
    expect(res.skipped).toBe(2);
  });

  it('BUG-HUNT-D : une annotation de type val x: Svc ne bloque plus le retrait', () => {
    const text = 'fun make(): Svc {\n  val cached: Svc = Svc("a", 3)\n  return cached\n}\n';
    const res = computeCallSiteEdits(text, ctorParam('retry', 1, 'Svc'));
    expect(res.skipped).toBe(0);
    expect(applyEdits(text, res.edits)).toContain('Svc("a")');
  });
});

describe('KJ-025 adversarial — CodeActionProvider', () => {
  const demoText = [
    'class Svc(name: String, dead: Int) {',
    '  val label = "svc $name"',
    '}',
    'fun main() { val s = Svc("a", 3) }',
    '',
  ].join('\n');

  it('propose Remove (isPreferred) + Suppress sur la ligne du diagnostic', async () => {
    const target = findUnusedParameters(demoText).find(u => u.name === 'dead')!;
    const provider = new UnusedParameterCodeActionProvider();
    const actions = await provider.provideCodeActions(makeDocument(demoText), new Range(target.line, 0, target.line, 0) as any);
    const remove = actions.find(a => a.title.startsWith('Remove'));
    const suppress = actions.find(a => a.title.startsWith('Suppress'));
    expect(remove?.title).toBe("Remove unused parameter 'dead' and 1 argument");
    expect(remove?.isPreferred).toBe(true);
    expect(suppress?.title).toBe('Suppress with @Suppress("UNUSED_PARAMETER")');
  });

  it('l’édit couvre la déclaration ET le call site', async () => {
    const target = findUnusedParameters(demoText).find(u => u.name === 'dead')!;
    const provider = new UnusedParameterCodeActionProvider();
    const actions = await provider.provideCodeActions(makeDocument(demoText), new Range(target.line, 0, target.line, 0) as any);
    const remove = actions.find(a => a.title.startsWith('Remove'))!;
    const lines = (remove.edit as any).entries().map((e: any) => e.range.start.line).sort();
    expect(lines).toEqual([0, 3]); // ligne de la déclaration + ligne de l'appel
  });

  it('overload homonyme dans le fichier : call sites laissés intacts et signalés', async () => {
    const text = [
      'private fun render(a: Int, dead: Int) { }',
      'private fun render(a: Int) { }',
      'fun main() { render(1, 2) }',
      '',
    ].join('\n');
    const target = findUnusedParameters(text).find(u => u.name === 'dead')!;
    const provider = new UnusedParameterCodeActionProvider();
    const actions = await provider.provideCodeActions(makeDocument(text), new Range(target.line, 0, target.line, 0) as any);
    const remove = actions.find(a => a.title.startsWith('Remove'))!;
    expect(remove.title).toContain('ambiguous site');
    expect((remove.edit as any).entries()).toHaveLength(1); // la déclaration seule
  });

  it('aucune action ailleurs que sur la ligne d’un mort', async () => {
    const provider = new UnusedParameterCodeActionProvider();
    const actions = await provider.provideCodeActions(makeDocument(demoText), new Range(1, 0, 1, 0) as any);
    expect(actions).toEqual([]);
  });

  it('suppress s’insère AVANT les modificateurs d’une prop privée', async () => {
    const text = 'class A(private val dead: Int) { val x = 1 }\n';
    const target = findUnusedParameters(text).find(u => u.name === 'dead')!;
    const provider = new UnusedParameterCodeActionProvider();
    const actions = await provider.provideCodeActions(makeDocument(text), new Range(target.line, 0, target.line, 0) as any);
    const suppress = actions.find(a => a.title.startsWith('Suppress'))!;
    const entry = (suppress.edit as any).entries()[0];
    expect(entry.newText).toBe('@Suppress("unused") ');
    expect(entry.range.start.character).toBe(8); // devant « private », pas devant « dead »
  });
});
