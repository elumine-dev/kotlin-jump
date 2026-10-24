import { describe, it, expect } from 'vitest';
import { findUnusedSymbols } from '../../../src/providers/unusedSymbols';
import { findDeadIslands } from '../../../src/providers/deadIslands';

/**
 * G68 — une classe chargee par un nom construit.
 *
 * Vu par la refutation de G13, preexistant sur main :
 *
 *   Class.forName("com.x.plugins.Plugin" + n)
 *
 * Aucune classe `Plugin0`, `Plugin1`... n est nommee entiere, donc la recolte
 * des litteraux ne les voit pas, et KJ les coupait alors qu elles sont
 * chargees a l execution. Meme motif que G54 pour `getIdentifier` : le debut
 * litteral du nom dit ce qui peut etre atteint, et seulement cela.
 *
 * Le projet de reference n a aucun `forName` construit : la porte restera a
 * zero ecart. Limite assumee : un nom ENTIEREMENT calcule
 * (`Class.forName(className)`) reste indetectable, comme le dit deadIslands.
 */

const SEGS = ['/src/test/'];
const P = '/w/app/src/main/java/com/x/plugins';
const plugin = (n: number) => ({ path: `${P}/Plugin${n}.kt`, text: `package com.x.plugins\n\nclass Plugin${n} {\n    fun run() = ${n}\n}\n` });
const autre = { path: '/w/app/src/main/java/com/x/other/Morte.kt', text: 'package com.x.other\n\nclass Morte\n' };
const chargeur = (appel: string) => ({ path: '/w/app/src/main/java/com/x/Main.kt', text: `package com.x\n\nfun main() {\n    for (n in 0..2) println(${appel})\n}\n` });
const morts = (...sources: { path: string; text: string }[]) =>
  findUnusedSymbols({ sources: [...sources], testSourceSets: SEGS } as any).map((f: any) => f.name).sort();

describe('G68, temoin : sans chargeur, les plugins sont morts', () => {
  it('trois plugins que rien ne nomme', () => {
    expect(morts(plugin(0), plugin(1), autre, chargeur('n'))).toEqual(['Morte', 'Plugin0', 'Plugin1']);
  });
});

describe('G68, un prefixe litteral garde ce qu il peut charger', () => {
  it.each([
    ['concatenation Kotlin', 'Class.forName("com.x.plugins.Plugin" + n)'],
    ['gabarit Kotlin', 'Class.forName("com.x.plugins.Plugin$n")'],
    ['gabarit avec accolades', 'Class.forName("com.x.plugins.Plugin${n}")'],
    ['String.format', 'Class.forName(String.format("com.x.plugins.Plugin%d", n))'],
    ['loadClass', 'javaClass.classLoader.loadClass("com.x.plugins.Plugin" + n)'],
    ['paquet seul', 'Class.forName("com.x.plugins." + n)'],
  ])('%s', (_quoi, appel) => {
    expect(morts(plugin(0), plugin(1), autre, chargeur(appel))).toEqual(['Morte']);
  });

  it('Java, concatenation', () => {
    const java = { path: '/w/app/src/main/java/com/x/Loader.java', text: 'package com.x;\n\npublic class Loader {\n    public static void main(String[] a) throws Exception {\n        for (int n = 0; n < 2; n++) Class.forName("com.x.plugins.Plugin" + n);\n    }\n}\n' };
    expect(morts(plugin(0), plugin(1), autre, java)).toEqual(['Morte']);
  });

  it('les ilots respectent la meme garde', () => {
    const ping = { path: `${P}/PluginPing.kt`, text: 'package com.x.plugins\n\nclass PluginPing {\n    fun go() = PluginPong().go()\n}\n' };
    const pong = { path: `${P}/PluginPong.kt`, text: 'package com.x.plugins\n\nclass PluginPong {\n    fun go(): Int = PluginPing().hashCode()\n}\n' };
    const iles = findDeadIslands({ sources: [ping, pong, chargeur('Class.forName("com.x.plugins.Plugin" + n)')], testSourceSets: SEGS } as any);
    expect(iles.flatMap(i => i.names)).not.toContain('PluginPing');
  });
});

describe('G68, gardes', () => {
  it('un prefixe d un autre paquet ne protege rien ici', () => {
    expect(morts(plugin(0), autre, chargeur('Class.forName("com.y.plugins.Plugin" + n)'))).toEqual(['Morte', 'Plugin0']);
  });

  it('un prefixe sans paquet ne protege rien', () => {
    expect(morts(plugin(0), autre, chargeur('Class.forName("Plugin" + n)'))).toEqual(['Morte', 'Plugin0']);
  });

  it('un prefixe dans un commentaire ne compte pas', () => {
    const commente = { path: '/w/app/src/main/java/com/x/Main.kt', text: 'package com.x\n\nfun main() {\n    // Class.forName("com.x.plugins.Plugin" + n)\n    println(1)\n}\n' };
    expect(morts(plugin(0), autre, commente)).toEqual(['Morte', 'Plugin0']);
  });

  it('un nom entierement calcule reste hors de portee (limite assumee)', () => {
    expect(morts(plugin(0), autre, chargeur('Class.forName(nom(n))'))).toEqual(['Morte', 'Plugin0']);
  });
});
