import { describe, it, expect } from 'vitest';
import { importOrNull } from './harness';
import { coupeDeBrancheFinale, couvreDesLignesEntieres } from '../../../scripts/invariants';

/**
 * Un post seul dans sa branche emporte PLUS que lui, pour ne rien laisser vide.
 *
 * Le refus d'un post seul dans une branche est juste : retirer le seul post
 * laisse `} else if (cond) {\n}`, qui compile et que rien ne rattrape. Mais
 * sur le projet de reference, deux sites reels ont ete gardes par ce refus
 * pendant qu'un humain les retirait, en emportant ce qu'il fallait :
 *
 *   1. la chaine entiere, quand CHAQUE branche n'est qu'un post d'un
 *      evenement de ce scan et que chaque condition est pure ; l'humain a
 *      laisse `onScrollStateChanged(...) { }` vide ;
 *   2. la branche FINALE seule, quand une branche d'avant fait autre chose ;
 *      l'humain a retire `} else if (c) { post }` moins l'accolade du `if`.
 *
 * Une branche du MILIEU ne part jamais : la retirer change quelle branche
 * suivante attrape ses cas. La branche finale ne part pas non plus quand un
 * `else` suit la chaine : il appartient a un `if` du dessus dont la chaine
 * est le corps sans accolades, et il se rattacherait au `if` interieur. Et
 * un refus qui reste dit pourquoi, pour qu'une revue puisse l'offrir a un
 * humain avec la raison sur l'etiquette.
 */

const mod: any = await importOrNull('src/providers/unheardEvents');
const kotlinScan: any = await importOrNull('src/util/kotlinScan');
const MAIN = '/w/app/src/main/kotlin/com/x';
const JAVA = '/w/app/src/main/java/com/x';

const BUS = {
  path: `${MAIN}/Bus.kt`,
  text: 'package com.x\n\nobject BusProvider {\n    fun getInstance(): Bus = Bus\n}\n\nobject Bus {\n    fun post(e: Any) {}\n    fun register(o: Any) {}\n    fun unregister(o: Any) {}\n}\n',
};
const EVENTS = {
  path: `${MAIN}/Events.kt`,
  text: 'package com.x\n\nclass LuEvent\nclass ScrollingEvent(val scrolling: Boolean)\n'
    + 'class OpenedEvent(val url: String, val source: String?)\nclass NewsletterEvent(val url: String)\n'
    + 'class OrphanEvent(val v: Int)\n',
};
// Sans un `register`, le detecteur n'apprend pas le bus et ne signale RIEN.
const LU = {
  path: `${MAIN}/Listener.kt`,
  text: 'package com.x\n\nclass Listener {\n    fun start() { BusProvider.getInstance().register(this) }\n\n    @Subscribe\n    fun onBusEvent(e: LuEvent) {}\n}\n',
};

const scanne = (appelant: { path: string; text: string }) =>
  mod.findUnheardEvents({ sources: [BUS, EVENTS, LU, appelant], testSourceSets: [], truncated: false });

/** Les sites d'un evenement dans le fichier appelant, dans l'ordre du texte. */
const sites = (appelant: { path: string; text: string }, nom: string): any[] => {
  const trouves = (scanne(appelant).events as any[]).filter((e) => e.name === nom && e.path === appelant.path);
  expect(trouves.length, 'le temoin doit produire une trouvaille, sinon il ne prouve rien').toBeGreaterThan(0);
  return trouves;
};

const kt = (corps: string) => ({ path: `${MAIN}/Caller.kt`, text: `package com.x\n\nclass Caller {\n${corps}}\n` });
const sansLaCoupe = (texte: string, e: any) => texte.slice(0, e.removeStart) + texte.slice(e.removeEnd);

describe.skipIf(!mod)('regle 1 : la chaine entiere', () => {
  // La forme reelle, en Java : un rappel de defilement qui poste `true` dans
  // une branche et `false` dans l'autre, et rien d'autre.
  const ENTETE = 'package com.x;\n\npublic class LiveGridFragment {\n\t@Override\n'
    + '\tpublic void onScrollStateChanged(final AbsListView absListView, final int state) {\n';
  const CHAINE = '\t\tif (state == TOUCH || state == FLING) {\n'
    + '\t\t\tBusProvider.getInstance().post(new ScrollingEvent(true));\n'
    + '\t\t} else if (state == IDLE) {\n'
    + '\t\t\tBusProvider.getInstance().post(new ScrollingEvent(false));\n'
    + '\t\t}\n';
  const PIED = '\t}\n}\n';
  const java = { path: `${JAVA}/LiveGridFragment.java`, text: ENTETE + CHAINE + PIED };

  it('chaque branche n est qu un post : l etendue couvre toute la chaine', () => {
    const [premier] = sites(java, 'ScrollingEvent');
    expect(java.text.slice(premier.removeStart, premier.removeEnd)).toBe(CHAINE);
    expect(sansLaCoupe(java.text, premier)).toBe(ENTETE + PIED);
    expect(premier.withheld).toBeUndefined();
  });

  it('les deux sites rendent la MEME etendue, pour que le dedoublonnage les fonde', () => {
    const [premier, second] = sites(java, 'ScrollingEvent');
    expect(second.line).not.toBe(premier.line);
    expect([second.removeStart, second.removeEnd]).toEqual([premier.removeStart, premier.removeEnd]);
  });

  it('une branche qui fait autre chose : refus, avec la raison', () => {
    const appelant = kt('    fun f(state: Int) {\n'
      + '        if (state == TOUCH) {\n            BusProvider.getInstance().post(ScrollingEvent(true))\n'
      + '        } else if (state == IDLE) {\n            scrolling = false\n        }\n    }\n');
    const [e] = sites(appelant, 'ScrollingEvent');
    expect(e.removeStart).toBe(-1);
    expect(e.withheld).toBe('sole content of a branch whose chain does other things');
  });

  it('une condition qui appelle quelque chose : pas de chaine entiere', () => {
    // `isBusy()` a peut-etre un effet de bord : l'evaluer est la seule chose
    // que la chaine faisait encore. Le `else` final, lui, n'a pas de
    // condition : la regle 2 l'emporte seul, et le `if` reste.
    const appelant = kt('    fun f() {\n'
      + '        if (isBusy()) {\n            BusProvider.getInstance().post(ScrollingEvent(true))\n'
      + '        } else {\n            BusProvider.getInstance().post(ScrollingEvent(false))\n        }\n    }\n');
    const [premier, dernier] = sites(appelant, 'ScrollingEvent');
    expect(premier.removeStart).toBe(-1);
    expect(premier.withheld).toBe('sole content of a branch whose chain has a condition that calls isBusy()');
    expect(appelant.text.slice(dernier.removeStart, dernier.removeEnd))
      .toBe(' else {\n            BusProvider.getInstance().post(ScrollingEvent(false))\n        }');
    expect(sansLaCoupe(appelant.text, dernier)).toContain('        if (isBusy()) {\n            BusProvider.getInstance().post(ScrollingEvent(true))\n        }\n    }\n');
  });

  it('une chaine elle-meme seule dans une branche : refus', () => {
    // L'emporter viderait la branche du dessus, exactement ce qu'on evite.
    const appelant = kt('    fun f(outer: Boolean, a: Boolean) {\n        if (outer) {\n'
      + '            if (a) {\n                BusProvider.getInstance().post(ScrollingEvent(true))\n'
      + '            } else {\n                BusProvider.getInstance().post(ScrollingEvent(false))\n            }\n'
      + '        }\n    }\n');
    for (const e of sites(appelant, 'ScrollingEvent')) {
      expect(e.removeStart).toBe(-1);
      expect(e.withheld).toBe('sole content of a branch whose chain is itself alone in a branch');
    }
  });
});

describe.skipIf(!mod)('regle 2 : la branche finale', () => {
  // La forme reelle, en Kotlin : la premiere branche poste deux evenements
  // dont l'argument appelle `decode()`, la derniere n'est qu'un post.
  const ENTETE = 'package com.x\n\nclass DeepLinkRouter {\n'
    + '    fun route(newsletterSourceUrl: String, deepLinkUrl: String, info: LaunchInfo?) {\n'
    + '        if (newsletterSourceUrl.isNotEmpty()) {\n'
    + '            BusProvider.getInstance().post(OpenedEvent(newsletterSourceUrl.decode(), SOURCE_NEWSLETTER))\n'
    + '            BusProvider.getInstance().post(NewsletterEvent(uri.resolved().decode()))\n'
    + '        }';
  const BRANCHE = ' else if (Medium.NOTIFICATION != info?.medium) {\n'
    + '            BusProvider.getInstance().post(OpenedEvent(deepLinkUrl, null))\n'
    + '        }';
  const PIED = '\n        openEdition(edition)\n    }\n}\n';
  const kotlin = { path: `${MAIN}/DeepLinkRouter.kt`, text: ENTETE + BRANCHE + PIED };

  it('else if final, condition pure : l etendue est la branche, l accolade d avant reste', () => {
    const [, dernier] = sites(kotlin, 'OpenedEvent');
    expect(kotlin.text.slice(dernier.removeStart, dernier.removeEnd)).toBe(BRANCHE);
    expect(sansLaCoupe(kotlin.text, dernier)).toBe(ENTETE + PIED);
    expect(dernier.withheld).toBeUndefined();
  });

  it('le post de la premiere branche reste refuse : son argument appelle decode()', () => {
    const [premier] = sites(kotlin, 'OpenedEvent');
    expect(premier.removeStart).toBe(-1);
    expect(premier.withheld).toBe('argument calls decode(), which may have a side effect');
  });

  it('une branche du milieu ne part pas', () => {
    const appelant = kt('    fun f(a: Boolean, b: Boolean) {\n'
      + '        if (a) {\n            BusProvider.getInstance().post(ScrollingEvent(true))\n'
      + '        } else if (b) {\n            BusProvider.getInstance().post(ScrollingEvent(false))\n'
      + '        } else {\n            scrolling = false\n        }\n    }\n');
    const [, milieu] = sites(appelant, 'ScrollingEvent');
    expect(milieu.removeStart).toBe(-1);
    expect(milieu.withheld).toBe('sole content of a branch whose chain does other things');
  });

  it('une branche finale dont la condition appelle : refus, avec la raison', () => {
    const appelant = kt('    fun f(a: Boolean) {\n'
      + '        if (a) {\n            scrolling = true\n'
      + '        } else if (isBusy()) {\n            BusProvider.getInstance().post(ScrollingEvent(false))\n        }\n    }\n');
    const [e] = sites(appelant, 'ScrollingEvent');
    expect(e.removeStart).toBe(-1);
    expect(e.withheld).toBe('sole content of a trailing branch whose condition calls isBusy()');
  });
});

describe.skipIf(!mod || !kotlinScan)('regle 3 : un refus dit pourquoi', () => {
  const appelant = kt('    fun f() {\n        println("avant")\n'
    + '        BusProvider.getInstance().post(OrphanEvent(compute()))\n        println("apres")\n    }\n');

  it('un argument qui appelle : la raison nomme l appel', () => {
    const [e] = sites(appelant, 'OrphanEvent');
    expect(e.removeStart).toBe(-1);
    expect(e.withheld).toBe('argument calls compute(), which may have a side effect');
  });

  it('temoin : un post accepte ne porte aucune raison', () => {
    const ok = kt('    fun f() {\n        println("avant")\n'
      + '        BusProvider.getInstance().post(OrphanEvent(1))\n        println("apres")\n    }\n');
    const [e] = sites(ok, 'OrphanEvent');
    expect(e.removeStart).toBeGreaterThanOrEqual(0);
    expect('withheld' in e).toBe(false);
  });

  it('unprovenPostExtent rend la ligne entiere du post, sans les gardes', () => {
    // Ce qu'une revue offrira a l'humain, la raison sur l'etiquette.
    const raw = appelant.text;
    const clean = kotlinScan.sanitizeForUsageScan(raw);
    const lineStarts = kotlinScan.buildLineStarts(clean);
    const postIdx = clean.indexOf('.post(');
    const openIdx = clean.indexOf('(', postIdx);
    const closeIdx = kotlinScan.findMatchingParen(clean, openIdx);
    const { start, end } = mod.unprovenPostExtent(raw, clean, lineStarts, postIdx, openIdx, closeIdx);
    expect(raw.slice(start, end)).toBe('        BusProvider.getInstance().post(OrphanEvent(compute()))\n');
  });
});

describe.skipIf(!mod)('regle 2 : un else qui suit la chaine la retient', () => {
  // La chaine est le corps SANS accolades d un `if (outer)` qui a son propre
  // `else`. Retirer le `else { post }` interieur compile, et kotlinc comme
  // javac rattachent alors le `else` exterieur au `if (a)` : `bar()` tournait
  // quand `!outer`, il tournerait quand `outer && !a`, et plus rien quand
  // `!outer`. Un changement silencieux, la seule chose interdite ici.
  const REBIND = 'sole content of a trailing branch whose chain is the braceless body of an outer branch';
  const ELSE = ' else {\n                BusProvider.getInstance().post(ScrollingEvent(false))\n            }';
  const CHAINE = '        if (outer)\n            if (a) {\n                foo()\n            }' + ELSE + '\n';

  it('D1, Kotlin : refus, avec la raison', () => {
    const appelant = kt('    fun route(outer: Boolean, a: Boolean) {\n' + CHAINE
      + '        else\n            bar()\n    }\n');
    const [e] = sites(appelant, 'ScrollingEvent');
    expect(e.removeStart).toBe(-1);
    expect(e.withheld).toBe(REBIND);
  });

  it('D2, Java : le meme refus', () => {
    const java = {
      path: `${JAVA}/Router.java`,
      text: 'package com.x;\n\npublic class Router {\n\tvoid route(boolean outer, boolean a) {\n'
        + '\t\tif (outer)\n\t\t\tif (a) {\n\t\t\t\tfoo();\n\t\t\t} else {\n'
        + '\t\t\t\tBusProvider.getInstance().post(new ScrollingEvent(false));\n\t\t\t}\n'
        + '\t\telse\n\t\t\tbar();\n\t}\n}\n',
    };
    const [e] = sites(java, 'ScrollingEvent');
    expect(e.removeStart).toBe(-1);
    expect(e.withheld).toBe(REBIND);
  });

  it('D5 : un `else if (c)` exterieur retient autant qu un `else`', () => {
    const appelant = kt('    fun route(outer: Boolean, a: Boolean, c: Boolean) {\n' + CHAINE
      + '        else if (c)\n            bar()\n    }\n');
    const [e] = sites(appelant, 'ScrollingEvent');
    expect(e.removeStart).toBe(-1);
    expect(e.withheld).toBe(REBIND);
  });

  it('le `else ->` d un when apres une chaine en corps de branche : refus aussi', () => {
    // Le corps sans accolades d une branche `->`, suivi du `else` du when :
    // le meme mot, le meme rattachement.
    const appelant = kt('    fun route(x: Int, a: Boolean) {\n        when (x) {\n'
      + '            1 -> if (a) {\n                foo()\n            } else {\n'
      + '                BusProvider.getInstance().post(ScrollingEvent(false))\n            }\n'
      + '            else -> bar()\n        }\n    }\n');
    const [e] = sites(appelant, 'ScrollingEvent');
    expect(e.removeStart).toBe(-1);
    expect(e.withheld).toBe(REBIND);
  });

  it('H1 : un `;` entre l accolade de la chaine et le `else` exterieur ne cache rien', () => {
    // Kotlin admet `if (a) b; else c` : le `;` est un separateur legal avant
    // `else`. Il faisait passer le `else` pour absent, la branche partait, et
    // le rattachement de D1 se produisait par une porte derobee.
    const appelant = kt('    fun route(outer: Boolean, a: Boolean) {\n' + CHAINE.replace(/\n$/, ';\n')
      + '        else\n            bar()\n    }\n');
    const [e] = sites(appelant, 'ScrollingEvent');
    expect(e.removeStart).toBe(-1);
    expect(e.withheld).toBe(REBIND);
  });

  it('H1b : le meme `;` seul sur sa ligne', () => {
    const appelant = kt('    fun route(outer: Boolean, a: Boolean) {\n' + CHAINE
      + '            ;\n        else\n            bar()\n    }\n');
    const [e] = sites(appelant, 'ScrollingEvent');
    expect(e.removeStart).toBe(-1);
    expect(e.withheld).toBe(REBIND);
  });

  it('temoin : `};` puis une instruction, sans `else` : la branche finale part', () => {
    const appelant = kt('    fun route(outer: Boolean, a: Boolean) {\n' + CHAINE.replace(/\n$/, ';\n')
      + '        bar()\n    }\n');
    const [e] = sites(appelant, 'ScrollingEvent');
    expect(appelant.text.slice(e.removeStart, e.removeEnd)).toBe(ELSE);
    expect(e.withheld).toBeUndefined();
  });

  it('D3, temoin : sans `else` exterieur, la branche finale part encore', () => {
    // La chaine videe de son `else` reste tout le corps du `if (outer)`, et
    // `bar()` tourne dans les memes cas qu avant.
    const appelant = kt('    fun route(outer: Boolean, a: Boolean) {\n' + CHAINE + '        bar()\n    }\n');
    const [e] = sites(appelant, 'ScrollingEvent');
    expect(appelant.text.slice(e.removeStart, e.removeEnd)).toBe(ELSE);
    expect(sansLaCoupe(appelant.text, e)).toContain(
      '        if (outer)\n            if (a) {\n                foo()\n            }\n        bar()\n');
    expect(e.withheld).toBeUndefined();
  });
});

describe.skipIf(!mod)('regle 1 : une chaine d une seule branche', () => {
  // La forme la plus courante de toutes : `if (flag) { post }` entre deux
  // instructions. Elle passait de refusee a retiree en entier sans temoin.
  const CHAINE = '        if (flag) {\n            BusProvider.getInstance().post(ScrollingEvent(true))\n        }\n';

  it('condition pure, entre deux instructions : tout le if part', () => {
    const appelant = kt('    fun f(flag: Boolean) {\n        before()\n' + CHAINE + '        after()\n    }\n');
    const [e] = sites(appelant, 'ScrollingEvent');
    expect(appelant.text.slice(e.removeStart, e.removeEnd)).toBe(CHAINE);
    expect(sansLaCoupe(appelant.text, e)).toBe(
      'package com.x\n\nclass Caller {\n    fun f(flag: Boolean) {\n        before()\n        after()\n    }\n}\n');
    expect(e.withheld).toBeUndefined();
  });

  it('en Java, apres un point-virgule : pareil', () => {
    const IF = '\t\tif (flag) {\n\t\t\tBusProvider.getInstance().post(new ScrollingEvent(true));\n\t\t}\n';
    const java = {
      path: `${JAVA}/Once.java`,
      text: 'package com.x;\n\npublic class Once {\n\tvoid f(boolean flag) {\n\t\tbefore();\n' + IF + '\t\tafter();\n\t}\n}\n',
    };
    const [e] = sites(java, 'ScrollingEvent');
    expect(java.text.slice(e.removeStart, e.removeEnd)).toBe(IF);
    expect(e.withheld).toBeUndefined();
  });

  it('condition qui appelle, seule dans le corps : refus, avec la raison', () => {
    const appelant = kt('    fun f() {\n        if (isBusy()) {\n'
      + '            BusProvider.getInstance().post(ScrollingEvent(true))\n        }\n    }\n');
    const [e] = sites(appelant, 'ScrollingEvent');
    expect(e.removeStart).toBe(-1);
    expect(e.withheld).toBe('sole content of a branch whose chain has a condition that calls isBusy()');
  });
});

describe.skipIf(!mod)('une chaine qui est une valeur ne part pas', () => {
  // La ligne du `if` est propre, mais ce qui la precede attend une valeur :
  // retirer la chaine laisserait `fun f() =` ou `log(` en l air. Une erreur
  // de compilation, pas un changement silencieux, mais autant l epargner.
  const DEUX = '            if (a) {\n                BusProvider.getInstance().post(ScrollingEvent(true))\n'
    + '            } else {\n                BusProvider.getInstance().post(ScrollingEvent(false))\n            }\n';
  const VALEUR = 'sole content of a branch whose chain is not a statement of its own';

  it('corps d expression `fun f() =`', () => {
    const appelant = kt('    fun f(a: Boolean) =\n' + DEUX);
    for (const e of sites(appelant, 'ScrollingEvent')) {
      expect(e.removeStart).toBe(-1);
      expect(e.withheld).toBe(VALEUR);
    }
  });

  it('initialiseur `val y =`', () => {
    const appelant = kt('    fun f(a: Boolean) {\n        val y =\n' + DEUX + '        use(y)\n    }\n');
    for (const e of sites(appelant, 'ScrollingEvent')) {
      expect(e.removeStart).toBe(-1);
      expect(e.withheld).toBe(VALEUR);
    }
  });

  it('argument `log(`', () => {
    const appelant = kt('    fun f(a: Boolean) {\n        log(\n' + DEUX + '        )\n    }\n');
    for (const e of sites(appelant, 'ScrollingEvent')) {
      expect(e.removeStart).toBe(-1);
      expect(e.withheld).toBe(VALEUR);
    }
  });

  it('regle 2 aussi : la branche finale d une chaine valeur reste', () => {
    // `fun f() = if (a) { foo() } else { post }` sans son else : un if
    // expression sans else, que le compilateur refuse.
    const appelant = kt('    fun f(a: Boolean) =\n        if (a) {\n            foo()\n        } else {\n'
      + '            BusProvider.getInstance().post(ScrollingEvent(false))\n        }\n');
    const [e] = sites(appelant, 'ScrollingEvent');
    expect(e.removeStart).toBe(-1);
    expect(e.withheld).toBe('sole content of a trailing branch whose chain is not a statement of its own');
  });

  it('temoin : Kotlin finit une instruction par un retour a la ligne, un `)` avant le if n est pas une valeur', () => {
    // Le site reel de la regle 2 suit `val url = uri.getNewsletterSourceUrl()`.
    const appelant = kt('    fun f(a: Boolean) {\n        val url = uri.source()\n        if (a) {\n            foo()\n'
      + '        } else {\n            BusProvider.getInstance().post(ScrollingEvent(false))\n        }\n    }\n');
    const [e] = sites(appelant, 'ScrollingEvent');
    expect(e.removeStart).toBeGreaterThanOrEqual(0);
    expect(e.withheld).toBeUndefined();
  });
});

describe.skipIf(!mod)('le temoin Gradle accepte la coupe de branche finale', () => {
  // scripts/verify-event-gradle-removals.ts tient chaque coupe aux lignes
  // entieres, ce qu une branche finale n est pas : elle part de l accolade
  // fermante d avant, en milieu de ligne. L invariant qui la reconnait doit
  // encore voir un decalage d un caractere, sinon il ne temoigne de rien.
  const ENTETE = 'package com.x\n\nclass Router {\n    fun route(a: Boolean) {\n'
    + '        if (a) {\n            foo()\n        }';
  const BRANCHE = ' else {\n            BusProvider.getInstance().post(ScrollingEvent(false))\n        }';
  const kotlin = { path: `${MAIN}/Router.kt`, text: ENTETE + BRANCHE + '\n    }\n}\n' };

  it('la coupe reelle n est pas des lignes entieres, et l invariant la reconnait', () => {
    const [e] = sites(kotlin, 'ScrollingEvent');
    expect(kotlin.text.slice(e.removeStart, e.removeEnd)).toBe(BRANCHE);
    expect(couvreDesLignesEntieres(kotlin.text, e.removeStart, e.removeEnd)).toBe(false);
    expect(coupeDeBrancheFinale(kotlin.text, e.removeStart, e.removeEnd)).toBe(true);
  });

  it('la meme coupe decalee d un caractere, dans un sens ou l autre, est vue', () => {
    const [e] = sites(kotlin, 'ScrollingEvent');
    expect(coupeDeBrancheFinale(kotlin.text, e.removeStart + 1, e.removeEnd + 1)).toBe(false);
    expect(coupeDeBrancheFinale(kotlin.text, e.removeStart - 1, e.removeEnd - 1)).toBe(false);
  });

  it('temoin : une coupe de chaine entiere reste des lignes entieres, sans passer par la', () => {
    const appelant = kt('    fun f(flag: Boolean) {\n        before()\n        if (flag) {\n'
      + '            BusProvider.getInstance().post(ScrollingEvent(true))\n        }\n        after()\n    }\n');
    const [e] = sites(appelant, 'ScrollingEvent');
    expect(couvreDesLignesEntieres(appelant.text, e.removeStart, e.removeEnd)).toBe(true);
    expect(coupeDeBrancheFinale(appelant.text, e.removeStart, e.removeEnd)).toBe(false);
  });
});
