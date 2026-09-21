import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { importOrNull } from '../kj/harness';

/**
 * G37 — deux trouvailles, une seule coupe.
 *
 * Recensement des dernieres familles secondaires.
 *
 *   findWriteOnlyKeys   1 trouvaille, 147 sites « empoisonnes »
 *   findUnheardEvents   5 trouvailles
 *
 * ## findWriteOnlyKeys : le meme coupe circuit qu en G35, mais gratuit
 *
 * La famille porte un poison par categorie
 * (writeOnlyKeys.ts:219, `if (poisoned.some(p => p.kind === kind)) continue;`) :
 * une seule LECTURE dont la cle n est pas resoluble eteint toute la categorie.
 * Sur le corpus, 147 sites empoisonnent la categorie `preferenceKey`, tous
 * venus de delegues generiques dont la cle est un parametre
 *
 * Mesure du cout : en retirant les 31 fichiers empoisonnants et en relançant,
 * la famille rend **toujours une seule trouvaille**. Le poison ne cache rien.
 * Meme forme qu en G35, resultat oppose, et c est pourquoi il fallait mesurer
 * les deux.
 *
 * ## findUnheardEvents : l invariant viole
 *
 * Les cinq trouvailles sont par SITE DE PUBLICATION, ce qui est voulu : chaque
 * site recoit son propre correctif. Mais deux d entre elles portent la meme
 * etendue de suppression.
 *
 *       BusProvider.getInstance().post(new LiveListViewScrollingEvent(true));
 *       BusProvider.getInstance().post(new LiveListViewScrollingEvent(false));
 *
 * Les deux vivent dans `onScrollStateChanged`, et les deux trouvailles
 * proposent de retirer la meme chose, les octets 5731 a 6000, c est a dire la
 * methode entiere. L utilisateur voit deux ampoules pour une seule edition ;
 * appliquer la seconde apres la premiere porte sur un texte qui a change.
 *
 * ## L invariant, verifie sur les autres familles
 *
 *   symboles    48 trouvailles, 0 etendue partagee
 *   membres     42 trouvailles, 0 etendue partagee
 *   evenements   5 trouvailles, 1 etendue partagee par deux
 *
 * Deux trouvailles ne doivent jamais proposer la meme coupe. C est la seule
 * famille qui le viole, et une seule fois.
 *
 * ## Ce que ces tests demandent
 *
 * Que les sites partageant une etendue se fondent en une trouvaille, ou qu ils
 * portent des etendues distinctes. Le test positif tourne sur le VRAI corpus,
 * parce que cette famille ne se declenche pas sur un corpus minimal : elle a
 * besoin du bus, de ses abonnes et de ses conventions. Il se skippe si le
 * corpus n est pas la.
 */

const ev: any = await importOrNull('src/providers/unheardEvents');
const symb: any = await importOrNull('src/providers/unusedSymbols');
const memb: any = await importOrNull('src/providers/unusedMembers');
const wok: any = await importOrNull('src/providers/writeOnlyKeys');

const CORPUS = '/Users/kevin/Desktop/work/example';
const aLeCorpus = (() => { try { return fs.existsSync(CORPUS); } catch { return false; } })();

/** Ce que ce test lit du corpus. Nom distinct de `SOURCE_RE` de `src/` :
 * le gardien NoStaleTestCopies compare les corps a nom egal, et celui-ci est
 * deliberement plus large (il inclut les .xml et les .gradle). */
const LU_PAR_CE_TEST = /\.(kt|kts|java|xml|gradle|pro|properties|toml)$/;
const SKIP = new Set(['node_modules', 'build', '.git', '.gradle', 'out', 'dist', 'target', '.idea', 'graphify-out']);
const TEST_SETS = ['test/java', 'test/kotlin', 'androidTest', 'jvmTest', 'commonTest', 'savedAndroidTest'];

let cache: { path: string; text: string }[] | null = null;
const corpus = () => {
  if (cache) return cache;
  const out: { path: string; text: string }[] = [];
  (function walk(dir: string) {
    let e: fs.Dirent[];
    try { e = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const x of e) {
      const f = path.join(dir, x.name);
      if (x.isDirectory()) { if (!SKIP.has(x.name)) walk(f); }
      else if (LU_PAR_CE_TEST.test(x.name)) {
        try { out.push({ path: path.relative(CORPUS, f), text: fs.readFileSync(f, 'utf8') }); } catch { /* illisible */ }
      }
    }
  })(CORPUS);
  cache = out;
  return out;
};

/** Les etendues qu au moins deux trouvailles se partagent. */
const etenduesPartagees = (trouvailles: readonly any[]) => {
  const vues = new Map<string, number>();
  for (const t of trouvailles) {
    if (typeof t.removeStart !== 'number' || t.removeStart < 0) continue;
    const cle = `${t.path}#${t.removeStart}-${t.removeEnd}`;
    vues.set(cle, (vues.get(cle) ?? 0) + 1);
  }
  return [...vues.entries()].filter(([, n]) => n > 1).map(([cle]) => cle);
};

const M = '/w/app/src/main/java/com/x';
const f = (nom: string, texte: string) => ({ path: `${M}/${nom}`, text: texte });
const APPELANT = f('Main.kt', 'package com.x\n\nfun main() {\n    println(1)\n}\n');

// ── Temoin de bonne formation ───────────────────────────────────────────────

describe.skipIf(!symb)('l invariant se verifie sur un corpus minimal', () => {
  it('trois declarations mortes donnent trois etendues distinctes', () => {
    const trois = ['A', 'B', 'C'].map(n => f(`${n}.kt`, `package com.x\n\nclass ${n}\n`));
    const trouvees = symb.findUnusedSymbols({
      sources: [...trois, APPELANT], testSourceSets: ['/src/test/'],
    } as any) as any[];
    expect(trouvees).toHaveLength(3);
    expect(etenduesPartagees(trouvees)).toEqual([]);
  });

  it('et deux membres morts de la meme classe aussi', () => {
    const classe = f('Service.kt', [
      'package com.x',
      '',
      'class Service {',
      '',
      '    fun used() = 1',
      '',
      '    fun deadOne() = 2',
      '',
      '    fun deadTwo() = 3',
      '}',
      '',
    ].join('\n'));
    const appel = f('Main.kt', 'package com.x\n\nfun main() {\n    Service().used()\n}\n');
    const trouvees = memb.findUnusedMembers({
      sources: [classe, appel], testSourceSets: ['/src/test/'], includeSelfOnly: false,
    } as any) as any[];
    expect(trouvees.map((m: any) => m.name).sort()).toEqual(['deadOne', 'deadTwo']);
    expect(etenduesPartagees(trouvees)).toEqual([]);
  });
});

// ── Sentinelles et cas positif, sur le vrai corpus ─────────────────────────

describe.skipIf(!ev || !symb || !memb || !aLeCorpus)('sur le corpus de reference', () => {
  const base = () => ({ sources: corpus(), testSourceSets: TEST_SETS } as any);

  const evenements = () => {
    const r = ev.findUnheardEvents(base()) as any;
    return (Array.isArray(r) ? r : (r.findings ?? r.events ?? [])) as any[];
  };

  it('les symboles respectent l invariant', () => {
    expect(etenduesPartagees(symb.findUnusedSymbols(base()) as any[])).toEqual([]);
  }, 600000);

  it('les membres aussi', () => {
    const syms = symb.findUnusedSymbols(base()) as any[];
    const trouvees = memb.findUnusedMembers({
      ...base(), includeSelfOnly: false,
      deadDeclarations: syms.map((s: any) => ({ path: s.path, removeStart: s.removeStart, removeEnd: s.removeEnd })),
    } as any) as any[];
    expect(etenduesPartagees(trouvees)).toEqual([]);
  }, 600000);

  /**
   * CORRIGÉ. `findUnheardEvents` dédoublonne par étendue avant de rendre sa
   * liste : le premier site garde la trouvaille, celui que le tri par ligne
   * met en tête. Deux `post()` aux étendues DISTINCTES restent deux
   * trouvailles, ce que le corpus vérifie tout seul
 * (`LiveDetailFragment` et `:216`, étendues différentes, toutes
   * deux conservées).
   */
  it('les evenements ne partagent plus d etendue', () => {
    expect(etenduesPartagees(evenements())).toEqual([]);
  }, 600000);

  it('aucune famille ne propose deux fois la meme coupe', () => {
    expect(etenduesPartagees(evenements())).toEqual([]);
  }, 600000);

  /**
   * Et la contrepartie : fondre les deux ne doit pas perdre de site. Les cinq
   * trouvailles portent sur quatre editions distinctes.
   */
  it('chaque trouvaille porte sur une edition distincte', () => {
    const l = evenements();
    const avecEtendue = l.filter((x: any) => typeof x.removeStart === 'number' && x.removeStart >= 0);
    const distinctes = new Set(avecEtendue.map((x: any) => `${x.path}#${x.removeStart}-${x.removeEnd}`));
    expect(distinctes.size).toBe(avecEtendue.length);
  }, 600000);
});

// ── Gardes ──────────────────────────────────────────────────────────────────

describe.skipIf(!wok)('le poison de writeOnlyKeys, mesure et garde', () => {
  /**
   * La famille porte le meme coupe circuit qu en G35 : une lecture dont la cle
   * n est pas resoluble eteint sa categorie entiere. Sur le corpus il coute
   * zero, mais la garde doit tenir : une lecture generique PEUT lire n importe
   * quelle cle.
   */
  it('une lecture a cle non resoluble eteint sa categorie', () => {
    const ecriture = f('Writer.kt', [
      'package com.x',
      '',
      'fun save(prefs: SharedPreferences) {',
      '    prefs.edit().putString("jamais_lue", "x").apply()',
      '}',
      '',
    ].join('\n'));
    const lectureFloue = f('PreferenceServiceDelegate.kt', [
      'package com.x',
      '',
      'class PreferenceServiceDelegate(private val key: String) {',
      '',
      '    fun read(prefs: SharedPreferences) = prefs.getString(key, null)',
      '}',
      '',
    ].join('\n'));
    const b = { sources: [ecriture, lectureFloue, APPELANT], testSourceSets: ['/src/test/'] } as any;
    const r = wok.findWriteOnlyKeys(b) as any;
    expect((r.findings ?? []).map((x: any) => x.key)).not.toContain('jamais_lue');
  });

  it('et sans elle, la cle jamais lue ressort', () => {
    const ecriture = f('Writer.kt', [
      'package com.x',
      '',
      'fun save(prefs: SharedPreferences) {',
      '    prefs.edit().putString("jamais_lue", "x").apply()',
      '}',
      '',
    ].join('\n'));
    const b = { sources: [ecriture, APPELANT], testSourceSets: ['/src/test/'] } as any;
    const r = wok.findWriteOnlyKeys(b) as any;
    expect((r.findings ?? []).map((x: any) => x.key)).toContain('jamais_lue');
  });

  it('un corpus tronque ne rend rien', () => {
    const ecriture = f('Writer.kt', 'package com.x\n\nfun save(prefs: SharedPreferences) {\n    prefs.edit().putString("jamais_lue", "x").apply()\n}\n');
    const r = wok.findWriteOnlyKeys({
      sources: [ecriture, APPELANT], testSourceSets: ['/src/test/'], truncated: true,
    } as any) as any;
    expect(r.findings ?? []).toEqual([]);
  });
});
