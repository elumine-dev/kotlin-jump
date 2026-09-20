import { describe, it, expect } from 'vitest';
import { importOrNull } from './harness';

/**
 * KJ-072 — l interface qu une classe implemente pour rien.
 *
 * Couper la derniere instruction d un ecouteur laisse l ecouteur. Sur le
 * projet de reference, la regle des evenements inaudibles a vide les deux
 * rappels de defilement d un fragment et s est arretee la : le compilateur est
 * content, l ecouteur est inscrit, et il ne fait rien. Un humain retire tout
 * l appareillage, les deux surcharges, la clause `implements`, l inscription
 * et l import qui suivait.
 *
 * Une surcharge ne peut pas partir seule, l interface l exige encore : l unite
 * est l implementation entiere. Et un ecouteur qui ne fait rien equivaut a pas
 * d ecouteur du tout, donc la coupe est neutre DES QUE plus rien ne peut voir
 * la classe comme un `I`. C est ce que les gardes etablissent.
 */

const mod: any = await importOrNull('src/providers/idleImplementations');

const MAIN = '/w/app/src/main/java/com/x';
const f = (path: string, text: string) => ({ path, text });

const scan = (...sources: { path: string; text: string }[]) =>
  mod.findIdleImplementations({ sources, testSourceSets: ['/src/test/'] }) as any[];

const applique = (source: { path: string; text: string }, trouve: any) => {
  let t = source.text;
  for (const c of [...trouve.cuts].sort((a: any, b: any) => b.start - a.start)) {
    t = t.slice(0, c.start) + c.replacement + t.slice(c.end);
  }
  return t;
};

const GRID = f(`${MAIN}/Grid.java`, [
  'package com.x;',
  '',
  'import android.widget.AbsListView;',
  '',
  'public class Grid extends Base implements AbsListView.OnScrollListener {',
  '',
  '\tprivate AbsListView gridView;',
  '',
  '\tvoid setUp() {',
  '\t\tgridView.setOnScrollListener(this);',
  '\t}',
  '',
  '\t@Override',
  '\tpublic void onScrollStateChanged(final AbsListView absListView, final int state) {',
  '\t}',
  '',
  '\t@Override',
  '\tpublic void onScroll(final AbsListView absListView, final int i, final int j, final int k) {',
  '\t}',
  '}',
  '',
].join('\n'));

describe.skipIf(!mod)('un ecouteur de la plateforme vide de son contenu', () => {
  it('la clause, les deux surcharges et l inscription partent ensemble', () => {
    const trouves = scan(GRID);
    expect(trouves).toHaveLength(1);
    expect(trouves[0].className).toBe('Grid');
    expect(trouves[0].interfaceName).toBe('AbsListView.OnScrollListener');
    expect(trouves[0].cuts.map((c: any) => c.what).sort()).toEqual([
      'implements AbsListView.OnScrollListener',
      'override onScroll',
      'override onScrollStateChanged',
      'registration setOnScrollListener',
    ]);

    const apres = applique(GRID, trouves[0]);
    // Le nom qualifie part en entier : le lire comme son seul qualifieur
    // rendait `extends Base.OnScrollListener`.
    expect(apres).toContain('public class Grid extends Base {');
    expect(apres).not.toContain('Base.OnScrollListener');
    expect(apres).not.toContain('onScroll');
    expect(apres).not.toContain('setOnScrollListener');
    // Le champ reste : c est le sujet de la classe, pas de l interface. L import
    // devenu inutile est la trouvaille du balayage, pas de cette regle.
    expect(apres).toContain('private AbsListView gridView;');
  });

  it('une surcharge qui fait encore quelque chose retient tout', () => {
    const source = f(`${MAIN}/Grid.java`, GRID.text.replace(
      '\tpublic void onScroll(final AbsListView absListView, final int i, final int j, final int k) {\n\t}',
      '\tpublic void onScroll(final AbsListView absListView, final int i, final int j, final int k) {\n\t\tlog(i);\n\t}'));
    expect(scan(source)).toEqual([]);
  });

  it('un commentaire dans le corps est du contenu', () => {
    const source = f(`${MAIN}/Grid.java`, GRID.text.replace(
      '\tpublic void onScroll(final AbsListView absListView, final int i, final int j, final int k) {\n\t}',
      '\tpublic void onScroll(final AbsListView absListView, final int i, final int j, final int k) {\n\t\t// rien a faire ici\n\t}'));
    expect(scan(source)).toEqual([]);
  });

  it('un autre fichier qui nomme la classe ET l interface retient tout', () => {
    // C est ainsi qu un `(OnScrollListener) grid` ailleurs se voit, sans
    // resoudre le moindre type.
    const ailleurs = f(`${MAIN}/Autre.java`,
      'package com.x;\n\nimport android.widget.AbsListView;\n\nclass Autre {\n'
      + '\tvoid go(Grid grid) { register((AbsListView.OnScrollListener) grid); }\n}\n');
    expect(scan(GRID, ailleurs)).toEqual([]);
  });

  it('une classe imbriquee dont le fichier meme se sert comme un I retient tout', () => {
    // `EmptyShellUiComponent` vit dans le fichier qui le rend comme un
    // `ShellUiComponent`. Une garde qui s arretait au corps de la classe
    // laissait partir la clause, et javac repondait `incompatible types`.
    const graphe = f(`${MAIN}/GraphShell.java`, [
      'package com.x;',
      '',
      'public final class GraphShell {',
      '',
      '\tpublic static ShellUiComponent ui(Context context) {',
      '\t\treturn new EmptyShellUiComponent();',
      '\t}',
      '',
      '\tprivate static class EmptyShellUiComponent implements ShellUiComponent {',
      '',
      '\t\t@Override',
      '\t\tpublic void inject(Target target) {',
      '\t\t}',
      '\t}',
      '}',
      '',
    ].join('\n'));
    const iface = f(`${MAIN}/ShellUiComponent.java`,
      'package com.x;\n\npublic interface ShellUiComponent {\n\tvoid inject(Target target);\n}\n');
    expect(scan(graphe, iface)).toEqual([]);
  });

  it('temoin : un autre fichier qui nomme la classe seule ne retient rien', () => {
    const ailleurs = f(`${MAIN}/Autre.java`, 'package com.x;\n\nclass Autre {\n\tGrid grid;\n}\n');
    expect(scan(GRID, ailleurs)).toHaveLength(1);
  });

  it('un this passe a autre chose que l inscription retient tout', () => {
    const source = f(`${MAIN}/Grid.java`, GRID.text.replace(
      '\t\tgridView.setOnScrollListener(this);',
      '\t\tgridView.setOnScrollListener(this);\n\t\tsection.initialize(this);'));
    // `initialize` ne finit pas par le nom de l interface : ce n est pas une
    // inscription, et la classe se donne donc a quelque chose d illisible.
    expect(scan(source)).toHaveLength(1);
    const trouve = scan(source)[0];
    expect(trouve.cuts.some((c: any) => c.what.includes('initialize'))).toBe(false);
  });

  it('une inscription qui partage sa ligne retient tout', () => {
    const source = f(`${MAIN}/Grid.java`, GRID.text.replace(
      '\t\tgridView.setOnScrollListener(this);',
      '\t\tif (ok) gridView.setOnScrollListener(this);'));
    expect(scan(source)).toEqual([]);
  });
});

describe.skipIf(!mod)('une interface que le depot declare', () => {
  const ECOUTEUR = f(`${MAIN}/Listener.java`, [
    'package com.x;',
    '',
    'public interface Listener {',
    '\tvoid onA();',
    '',
    '\tvoid onB();',
    '}',
    '',
  ].join('\n'));

  const porteur = (corpsB: string) => f(`${MAIN}/Holder.kt`, [
    'package com.x',
    '',
    'class Holder : Base(), Listener {',
    '',
    '    fun setUp() {',
    '        bus.setListener(this)',
    '    }',
    '',
    '    override fun onA() {',
    '    }',
    '',
    `    override fun onB() {${corpsB}`,
    '    }',
    '}',
    '',
  ].join('\n'));

  it('toutes ses methodes surchargees a vide : l implementation part', () => {
    const trouves = scan(porteur(''), ECOUTEUR);
    expect(trouves).toHaveLength(1);
    const apres = applique(porteur(''), trouves[0]);
    expect(apres).toContain('class Holder : Base() {');
    expect(apres).not.toContain('override fun onA');
    expect(apres).not.toContain('setListener');
  });

  it('une seule de ses methodes fait encore quelque chose : rien ne part', () => {
    expect(scan(porteur('\n        log()'), ECOUTEUR)).toEqual([]);
  });

  it('une methode de l interface que la classe ne surcharge pas : rien ne part', () => {
    // Un defaut hors du depot, ou une surcharge ailleurs dans la hierarchie :
    // la classe ne couvre pas ce que l interface demande, on ne touche a rien.
    const partiel = f(`${MAIN}/Holder.kt`, [
      'package com.x',
      '',
      'class Holder : Base(), Listener {',
      '',
      '    override fun onA() {',
      '    }',
      '}',
      '',
    ].join('\n'));
    expect(scan(partiel, ECOUTEUR)).toEqual([]);
  });
});
