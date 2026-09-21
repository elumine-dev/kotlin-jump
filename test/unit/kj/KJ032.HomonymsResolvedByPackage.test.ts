import { describe, it, expect } from 'vitest';
import { findUnusedSymbols, explainSymbols } from '../../../src/providers/unusedSymbols';
import { collecterUnePasse } from '../../../src/commands/RemoveEverythingUnused';

/**
 * Des declarations de premier niveau homonymes, chacune dans son paquet.
 *
 * La regle F3 renoncait des qu un nom etait declare plusieurs fois : la recolte
 * des mentions compte par nom simple, sans savoir laquelle des declarations une
 * mention designe. Sur le projet de reference, treize ecrans declarent chacun
 * leur `internal data class Dimensions` et s en servent chez eux. Une fois les
 * usages d un ecran supprimes, sa `Dimensions` n etait plus utilisee par
 * personne et n etait jamais signalee, parce que les douze autres parlaient de
 * « Dimensions » ailleurs. 783 declarations etaient ecartees ainsi.
 *
 * Le compilateur, lui, sait : `Dimensions` ecrit dans un fichier ne designe la
 * classe du paquet P que depuis le paquet P, depuis un fichier qui importe
 * quelque chose de P, ou sous la forme qualifiee `P.Dimensions`. Tout ce qui
 * reste incertain compte comme un usage.
 */

const f = (path: string, text: string) => ({ path, text });
const GRADLE = f('/w/app/build.gradle', "plugins { id 'com.android.application' }\n");
const K = '/w/app/src/main/kotlin';

const base = () => [
  f(`${K}/com/a/ADims.kt`, 'package com.a\n\ninternal data class Dimensions(val x: Float)\n'),
  f(`${K}/com/b/BDims.kt`, 'package com.b\n\ninternal data class Dimensions(val x: Float)\n\nval bValue = Dimensions(1f)\n'),
  f(`${K}/com/c/CUse.kt`, 'package com.c\n\nimport com.b.Dimensions\n\nfun useB() = Dimensions(2f)\n'),
  f(`${K}/com/x/Main.kt`, 'package com.x\n\nimport com.b.bValue\nimport com.c.useB\n\nfun main() { println(bValue); println(useB()) }\n'),
  GRADLE,
];
const trouves = (sources: Array<{ path: string; text: string }>, nom: string) =>
  (findUnusedSymbols({ sources, testSourceSets: ['/src/test/'] } as any) as any[])
    .filter(s => s.name === nom).map(s => s.path.replace(`${K}/`, ''));

describe('un homonyme inutilise dans son paquet est signale', () => {
  it('le cas du projet de reference : seule la Dimensions de com.a sort', () => {
    expect(trouves(base(), 'Dimensions')).toEqual(['com/a/ADims.kt']);
  });

  it('utilisee depuis un autre fichier du MEME paquet : vivante', () => {
    expect(trouves([...base(), f(`${K}/com/a/AUse.kt`, 'package com.a\n\nfun useA() = Dimensions(3f)\n')], 'Dimensions')).toEqual([]);
  });

  it('importee par etoile : vivante', () => {
    expect(trouves([...base(), f(`${K}/com/z/Z.kt`, 'package com.z\n\nimport com.a.*\n\nfun z() = Dimensions(4f)\n')], 'Dimensions')).toEqual([]);
  });

  it('ecrite sous sa forme qualifiee : vivante', () => {
    expect(trouves([...base(), f(`${K}/com/z/Z.kt`, 'package com.z\n\nfun z() = com.a.Dimensions(5f)\n')], 'Dimensions')).toEqual([]);
  });

  it('nommee dans un XML : prudence, aucune n est resolue', () => {
    const xml = f('/w/app/src/main/res/layout/l.xml', '<layout><data><variable name="d" type="Dimensions"/></data></layout>\n');
    expect(trouves([...base(), xml], 'Dimensions')).toEqual([]);
  });

  it('nommee depuis un test du meme paquet : prudence', () => {
    const t = f('/w/app/src/test/kotlin/com/a/ATest.kt', 'package com.a\n\nfun t() = Dimensions(6f)\n');
    expect(trouves([...base(), t], 'Dimensions')).toEqual([]);
  });

  it('utilisee SEULEMENT dans son propre fichier : vivante, c est le motif du projet de reference', () => {
    // Chaque ecran declare sa `Dimensions` et s en sert juste a cote, dans
    // un `LocalDimensions` du meme fichier. Aucun autre fichier ne la voit.
    const sources = [
      f(`${K}/com/a/ADims.kt`, 'package com.a\n\ninternal data class Dimensions(val x: Float)\n'),
      f(`${K}/com/b/BDims.kt`, 'package com.b\n\ninternal data class Dimensions(val x: Float)\n\nval bValue = Dimensions(1f)\n'),
      f(`${K}/com/x/Main.kt`, 'package com.x\n\nimport com.b.bValue\n\nfun main() { println(bValue) }\n'),
      GRADLE,
    ];
    expect(trouves(sources, 'Dimensions')).toEqual(['com/a/ADims.kt']);
    // Et l explication, que lisent les ilots, dit la meme chose : le detecteur
    // double ce controle, l explication non.
    const verdicts = (explainSymbols({ sources, testSourceSets: ['/src/test/'] } as any) as any[])
      .filter(r => r.name === 'Dimensions').map(r => `${r.path.replace(`${K}/`, '')} ${r.outcome}`).sort();
    expect(verdicts[0]).toBe('com/a/ADims.kt unreferenced');
    expect(verdicts[1]).not.toMatch(/unreferenced|testOnly/);
  });

  it('deux homonymes dans le meme paquet : aucun n est resolu', () => {
    const jumeau = f('/w/lib/src/main/kotlin/com/a/ADims2.kt', 'package com.a\n\ninternal data class Dimensions(val y: Float)\n');
    expect(trouves([...base(), jumeau], 'Dimensions')).toEqual([]);
  });
});

describe('un nom qui n apparait que dans un import de ce qu il contient', () => {
  // Trouve par verification manuelle sur le projet de reference :
  // `import ...legacy.AdCommand.DISPATCH_EVENT`, puis seulement
  // `DISPATCH_EVENT` dans le corps. Le fichier casse si l enum disparait.
  const sources = (importeur: string) => [
    f(`${K}/com/a/Cmd.kt`, 'package com.a\n\nenum class Cmd { DISPATCH, IGNORE }\n'),
    f(`${K}/com/b/Cmd.kt`, 'package com.b\n\nenum class Cmd { DISPATCH }\n\nval bCmd = Cmd.DISPATCH\n'),
    importeur === '' ? f(`${K}/com/x/Vide.kt`, 'package com.x\n') : f(`${K}/com/x/Use.kt`, importeur),
    f(`${K}/com/x/Main.kt`, 'package com.x\n\nimport com.b.bCmd\n\nfun main() { println(bCmd) }\n'),
    GRADLE,
  ];

  it('temoin : sans aucun usage, la Cmd de com.a sort', () => {
    expect(trouves(sources(''), 'Cmd')).toEqual(['com/a/Cmd.kt']);
  });

  it('import d une de ses entrees depuis un autre paquet : vivante', () => {
    expect(trouves(sources('package com.x\n\nimport com.a.Cmd.DISPATCH\n\nfun use() = DISPATCH\n'), 'Cmd')).toEqual([]);
  });

  it('import statique Java d un de ses membres : vivante', () => {
    const java = [...sources(''), f('/w/app/src/main/java/com/j/J.java', 'package com.j;\n\nimport static com.a.Cmd.DISPATCH;\n\nclass J { Object f() { return DISPATCH; } }\n')];
    expect(trouves(java, 'Cmd')).toEqual([]);
  });

  it('import de l entree de l HOMONYME : ne garde pas la Cmd de com.a', () => {
    expect(trouves(sources('package com.x\n\nimport com.b.Cmd.DISPATCH\n\nfun use() = DISPATCH\n'), 'Cmd')).toEqual(['com/a/Cmd.kt']);
  });
});

describe('une fonction de premier niveau appelee depuis Java par sa facade', () => {
  it('l import de la facade depuis Java garde la fonction de ce paquet, pas son homonyme', () => {
    const sources = [
      f(`${K}/com/a/Util.kt`, 'package com.a\n\nfun dpToPx(v: Int): Int = v * 2\n'),
      f(`${K}/com/b/Util.kt`, 'package com.b\n\nfun dpToPx(v: Int): Int = v * 3\n'),
      f('/w/app/src/main/java/com/j/J.java', 'package com.j;\n\nimport com.a.UtilKt;\n\nclass J { int f() { return UtilKt.dpToPx(1); } }\n'),
      GRADLE,
    ];
    expect(trouves(sources, 'dpToPx')).toEqual(['com/b/Util.kt']);
  });
});

describe('la suppression ne touche pas aux imports de l homonyme', () => {
  it('seul l import du paquet resolu part avec la trouvaille', () => {
    const sources = [...base(), f(`${K}/com/q/Q.kt`, 'package com.q\n\nimport com.a.Dimensions\n\nfun q() = 1\n')];
    const hit = (findUnusedSymbols({ sources, testSourceSets: ['/src/test/'] } as any) as any[])
      .find(s => s.name === 'Dimensions')!;
    expect(hit.path).toBe(`${K}/com/a/ADims.kt`);
    const lignes = hit.staleImports.map((s: any) =>
      sources.find(x => x.path === s.path)!.text.split('\n')[s.line].trim());
    expect(lignes).toEqual(['import com.a.Dimensions']);
  });

  it('un import suivi d un commentaire part aussi : sinon le fichier ne compile plus', () => {
    const sources = [...base(), f(`${K}/com/q/Q.kt`, 'package com.q\n\nimport com.a.Dimensions // plus utilise\nimport com.a.Dimensions/* x */;\n\nfun q() = 1\n')];
    const hit = (findUnusedSymbols({ sources, testSourceSets: ['/src/test/'] } as any) as any[])
      .find(s => s.name === 'Dimensions')!;
    expect(hit.path).toBe(`${K}/com/a/ADims.kt`);
    expect(hit.staleImports.map((s: any) => `${s.path.replace(`${K}/`, '')}:${s.line}`)).toEqual(['com/q/Q.kt:2', 'com/q/Q.kt:3']);
  });

  it('par la commande de masse : l import de com.b dans CUse.kt reste intact', () => {
    const sources = [...base(), f(`${K}/com/q/Q.kt`, 'package com.q\n\nimport com.a.Dimensions\n\nfun q() = 1\n')];
    const { parFichier } = collecterUnePasse(sources, ['/src/test/']);
    expect(parFichier.get(`${K}/com/c/CUse.kt`) ?? []).toEqual([]);
    expect(parFichier.has(`${K}/com/b/BDims.kt`)).toBe(false);
  });
});

describe('ce que voit vraiment un fichier Kotlin ou Java', () => {
  // Trouve sur le projet de reference : `core.utils.showKeyboard` restait
  // vivante parce que le fichier de son HOMONYME importe `core.utils.toIntent`.
  // Importer un autre nom du paquet P ne rend pas visible le nom de P.

  it('Kotlin : importer UN AUTRE nom de com.a ne voit pas la Dimensions de com.a', () => {
    const z = f(`${K}/com/z/Z.kt`, 'package com.z\n\nimport com.a.Other\nimport com.b.Dimensions\n\nfun z() = Dimensions(Other.x)\n');
    const autre = f(`${K}/com/a/Other.kt`, 'package com.a\n\nobject Other { const val x = 1f }\n');
    expect(trouves([...base(), z, autre], 'Dimensions')).toEqual(['com/a/ADims.kt']);
  });

  it('Java : une classe exige son import exact, l etoile, ou le meme paquet', () => {
    const j = f('/w/app/src/main/java/com/j/J.java', 'package com.j;\n\nimport com.a.Other;\nimport com.b.Dimensions;\n\nclass J { Object f() { return new Dimensions(Other.x); } }\n');
    const autre = f(`${K}/com/a/Other.kt`, 'package com.a\n\nobject Other { const val x = 1f }\n');
    expect(trouves([...base(), j, autre], 'Dimensions')).toEqual(['com/a/ADims.kt']);
    const etoile = f('/w/app/src/main/java/com/j/J.java', 'package com.j;\n\nimport com.a.*;\n\nclass J { Object f() { return new Dimensions(1f); } }\n');
    expect(trouves([...base(), etoile], 'Dimensions')).toEqual([]);
  });

  it('le fichier de l homonyme importe tout com.a : son propre nom designe SA classe', () => {
    const sources = base().map(s => s.path.endsWith('com/b/BDims.kt')
      ? f(s.path, 'package com.b\n\nimport com.a.*\n\ninternal data class Dimensions(val x: Float)\n\nval bValue = Dimensions(1f)\n')
      : s);
    expect(trouves(sources, 'Dimensions')).toEqual(['com/a/ADims.kt']);
  });

  it('fonction : dans le fichier de l homonyme, un appel peut viser l autre surcharge, prudence', () => {
    const sources = [
      f(`${K}/com/a/Ext.kt`, 'package com.a\n\nfun Int.show(): Int = this\n'),
      f(`${K}/com/b/Ext.kt`, 'package com.b\n\nimport com.a.*\n\nfun String.show(): String = this\n\nval bUse = 1.show()\n'),
      f(`${K}/com/x/Main.kt`, 'package com.x\n\nimport com.b.bUse\n\nfun main() { println(bUse) }\n'),
      GRADLE,
    ];
    expect(trouves(sources, 'show')).not.toContain('com/a/Ext.kt');
  });

  it('fonction de P, homonyme CLASSE : le constructeur inapplicable laisse l appel viser la fonction', () => {
    const sources = [
      f(`${K}/com/a/Show.kt`, 'package com.a\n\nfun Show(x: Int): Int = x\n'),
      f(`${K}/com/b/Show.kt`, 'package com.b\n\nimport com.a.*\n\nclass Show(val s: String)\n\nval bUse = Show(1)\n'),
      f(`${K}/com/x/Main.kt`, 'package com.x\n\nimport com.b.bUse\n\nfun main() { println(bUse) }\n'),
      GRADLE,
    ];
    expect(trouves(sources, 'Show')).not.toContain('com/a/Show.kt');
  });

  it('fonction : le fichier de l homonyme ne contient que sa declaration, l etoile ne voit rien', () => {
    const sources = [
      f(`${K}/com/a/Ext.kt`, 'package com.a\n\nfun Int.show(): Int = this\n'),
      f(`${K}/com/b/Ext.kt`, 'package com.b\n\nimport com.a.*\n\nfun String.show(): String = this\n'),
      f(`${K}/com/c/Use.kt`, 'package com.c\n\nimport com.b.show\n\nfun use() = "x".show()\n'),
      f(`${K}/com/x/Main.kt`, 'package com.x\n\nimport com.c.use\n\nfun main() { println(use()) }\n'),
      GRADLE,
    ];
    expect(trouves(sources, 'show')).toEqual(['com/a/Ext.kt']);
  });

  it('nommee dans une chaine d un autre fichier : la reflexion peut la viser, prudence', () => {
    const z = f(`${K}/com/z/Z.kt`, 'package com.z\n\nval route = "Dimensions"\n');
    expect(trouves([...base(), z], 'Dimensions')).toEqual([]);
    const echappee = f(`${K}/com/z/Z.kt`, 'package com.z\n\nval route = "a \\" Dimensions"\n');
    expect(trouves([...base(), echappee], 'Dimensions')).toEqual([]);
  });

  it('apres la fermeture d une chaine sur la meme ligne : du code ordinaire', () => {
    const z = f(`${K}/com/z/Z.kt`, 'package com.z\n\nimport com.b.Dimensions\n\nval pair = "x" to Dimensions(1f)\n');
    expect(trouves([...base(), z], 'Dimensions')).toEqual(['com/a/ADims.kt']);
  });

  it('paquet racine : visible sans import, aucune resolution', () => {
    const sources = [
      f(`${K}/Dims.kt`, 'internal data class Dimensions(val x: Float)\n'),
      ...base().slice(1),
    ];
    expect(trouves(sources, 'Dimensions')).toEqual([]);
  });

  it('alias d import : le nom n est jamais ecrit a l appel, prudence', () => {
    const z = f(`${K}/com/z/Z.kt`, 'package com.z\n\nimport com.a.Dimensions as ADims\n\nfun z() = ADims(1f)\n');
    expect(trouves([...base(), z], 'Dimensions')).toEqual([]);
    const verdicts = (explainSymbols({ sources: [...base(), z], testSourceSets: ['/src/test/'] } as any) as any[])
      .filter(r => r.name === 'Dimensions').map(r => r.outcome);
    expect(verdicts).not.toContain('unreferenced');
  });
});
