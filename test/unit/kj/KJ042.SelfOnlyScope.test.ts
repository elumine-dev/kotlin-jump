import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import * as path from 'node:path';
import { importOrNull, REPO_ROOT } from './harness';

/**
 * KJ-042 — deux defauts du verdict `selfOnly`, tous deux trouves en appliquant
 * la commande de masse sur /Users/kevin/Desktop/work/lapresse et en compilant.
 *
 * 1. LES OFFSETS. Les mentions sont cherchees dans un texte dont les lignes
 *    d'import ont ete VIDEES DE LEURS CARACTERES, puis comparees a des bornes
 *    mesurees sur le texte complet. Sur un fichier a 55 imports le decalage
 *    valait 2697 caracteres, assez pour faire tomber une mention d'une classe
 *    soeur dans le corps de la classe du dessus. Le membre revenait selfOnly,
 *    la commande le passait en prive, et le module cessait de compiler :
 *      Cannot access 'fun onItemRangeInserted(): Unit': it is private in ...
 *    Le decalage faussait dans les deux sens : 1 faux positif et 83 trouvailles
 *    manquees sur ce seul projet.
 *
 * 2. LES TESTS. `selfOnly` ne consultait pas les mentions de test. Un membre
 *    utilise dans sa classe ET depuis un test passait prive, et la compilation
 *    des tests tombait. 62 cas sur le meme projet, invisibles a un
 *    `assembleDebug` qui ne construit jamais les sources de test.
 */

const mod: any = await importOrNull('src/providers/unusedMembers');
const syms: any = await importOrNull('src/providers/unusedSymbols');

const MAIN = '/w/app/src/main/kotlin/com/x';
const SEGS = ['test/java', 'test/kotlin', 'androidTest'];

/** Deux classes de premier niveau : la seconde appelle un membre de la premiere. */
const CORPS = [
  'class A {',
  '    fun cible() {}',
  ...Array.from({ length: 60 }, (_, i) => `    fun garniture${i}() { cible() }`),
  '}',
  '',
  'class B(private val a: A) {',
  '    fun go() { a.cible() }',
  '}',
  '',
].join('\n');

const IMPORTS = Array.from({ length: 40 }, (_, i) =>
  `import com.quelquechose.de.raisonnablement.long.Paquet${i}`).join('\n');

const verdicts = (texte: string) => {
  const sources = [
    { path: `${MAIN}/A.kt`, text: texte },
    { path: `${MAIN}/Racine.kt`, text: 'package com.x\n\nfun racine(b: B) = b.go()\n' },
  ];
  return mod.findUnusedMembers({ sources, testSourceSets: SEGS, includeSelfOnly: true, deadDeclarations: [] })
    .map((m: any) => `${m.container}.${m.name}=${m.verdict}`).sort();
};

describe.skipIf(!mod)('selfOnly et la portee', () => {
  it('ajouter des imports ne change aucun verdict', () => {
    const sans = verdicts(`package com.x\n\n${CORPS}`);
    const avec = verdicts(`package com.x\n\n${IMPORTS}\n\n${CORPS}`);
    expect(avec, `sans: ${sans.join(', ')}`).toEqual(sans);
  });

  it('un membre appele par une classe SOEUR du meme fichier n est pas selfOnly', () => {
    // `private` veut dire « visible dans cette classe », jamais « dans ce
    // fichier ». Une classe soeur ne peut pas y acceder.
    for (const t of [`package com.x\n\n${CORPS}`, `package com.x\n\n${IMPORTS}\n\n${CORPS}`]) {
      expect(verdicts(t).filter((v: string) => v.startsWith('A.cible'))).toEqual([]);
    }
  });

  it('un membre utilise dans sa classe ET depuis un test n est pas selfOnly', () => {
    const sources = [
      { path: `${MAIN}/V.kt`, text: [
        'package com.x', '',
        'class V {', '    val SEUIL = 3', '    fun go() = SEUIL + 1', '}', ''].join('\n') },
      { path: `${MAIN}/Racine.kt`, text: 'package com.x\n\nfun racine(v: V) = v.go()\n' },
      { path: '/w/app/src/test/kotlin/com/x/VTest.kt', text: [
        'package com.x', '',
        'class VTest {', '    @Test', '    fun t() { assertEquals(3, V().SEUIL) }', '}', ''].join('\n') },
    ];
    const out = mod.findUnusedMembers({ sources, testSourceSets: SEGS, includeSelfOnly: true, deadDeclarations: [] });
    expect(out.filter((m: any) => m.name === 'SEUIL' && m.verdict === 'selfOnly')).toEqual([]);
  });

  it('temoin : un membre utilise seulement dans sa classe reste selfOnly', () => {
    const sources = [
      { path: `${MAIN}/W.kt`, text: [
        'package com.x', '',
        'class W {', '    fun aide() = 1', '    fun go() = aide() + aide()', '}', ''].join('\n') },
      { path: `${MAIN}/Racine.kt`, text: 'package com.x\n\nfun racine(w: W) = w.go()\n' },
    ];
    const out = mod.findUnusedMembers({ sources, testSourceSets: SEGS, includeSelfOnly: true, deadDeclarations: [] });
    expect(out.map((m: any) => `${m.name}=${m.verdict}`)).toContain('aide=selfOnly');
  });
});

describe.skipIf(!syms)('blankImportLines', () => {
  it('garde la longueur, contrairement a stripImportLines', () => {
    const t = 'package a\nimport b.c.D\nclass E\n';
    expect(syms.blankImportLines(t).length).toBe(t.length);
    expect(syms.stripImportLines(t).length).toBeLessThan(t.length);
  });

  it('garde aussi le nombre de lignes, et efface bien le nom importe', () => {
    const t = 'package a\nimport b.c.Cible\nclass E\n';
    const b = syms.blankImportLines(t);
    expect(b.split('\n').length).toBe(t.split('\n').length);
    expect(b).not.toContain('Cible');
  });
});

describe('la boucle d offsets compare des bases identiques', () => {
  /**
   * Garde STRUCTURELLE, et je prefere le dire : je n'ai pas su construire de
   * cas synthetique qui echoue avant le correctif. La preuve est ailleurs, et
   * elle est plus forte qu'un test unitaire : sur
   * /Users/kevin/Desktop/work/lapresse le membre `onItemRangeInserted` revenait
   * selfOnly, la commande de masse l'a passe en prive, et `:rubicon:component-feed`
   * a cesse de compiler. Aligner les bases retire ce verdict et en change 84
   * en tout sur ce seul projet.
   *
   * La regle se lit dans le code : les index viennent de `cleanNoImports`, les
   * bornes de `clean`. Les deux textes doivent avoir la MEME longueur.
   */
  const source = readFileSync(path.join(REPO_ROOT, 'src/providers/unusedMembers.ts'), 'utf8');

  it('le texte des mentions est blanchi, pas raccourci', () => {
    expect(source).toContain('blankImportLines(clean)');
    expect(source).not.toContain('stripImportLines(clean)');
  });

  it('temoin : le comptage, lui, peut utiliser la version raccourcie', () => {
    // `keptText` ne sert qu a compter des occurrences, jamais a comparer un
    // index : la version raccourcie y est sans danger.
    expect(source).toContain('stripImportLines(stripKotlinComments(src.text))');
  });
});

describe.skipIf(!mod)('le decalage des imports, reproduit', () => {
  /**
   * Obtenu par REDUCTION sur le vrai fichier, pas en devinant. Quatre formes
   * inventees avaient echoue, y compris une transcription de la geometrie
   * exacte : je modelisais la fenetre de la classe, alors que le decalage
   * deplace aussi la borne du SPAN DU MEMBRE.
   *
   * Le mecanisme, une fois vu, est general : des qu'il y a un import, la
   * mention que le membre fait de lui meme dans sa propre declaration tombe
   * HORS de son span, et l'egalite qui decide selfOnly bascule. Cinq imports
   * et dix lignes de corps suffisent.
   */
  const A = [
    'package com.x', '',
    ...Array.from({ length: 5 }, (_, i) => `import com.paquet.Type${i}`), '',
    'class A {',
    ...Array.from({ length: 10 }, (_, i) => `    private val garniture${i} = ${i}`),
    '    fun cible() {',
    '        garniture0',
    '    }',
    '}', '',
    'class B(private val a: A) {',
    '    fun go() { a.cible() }',
    '}', '',
  ].join('\n');

  const sources = [
    { path: `${MAIN}/A.kt`, text: A },
    { path: `${MAIN}/Racine.kt`, text: 'package com.x\n\nfun racine(b: B) = b.go()\n' },
  ];

  it('un membre appele par la classe soeur n est pas selfOnly, imports ou pas', () => {
    const out = mod.findUnusedMembers({ sources, testSourceSets: SEGS, includeSelfOnly: true, deadDeclarations: [] });
    expect(out.filter((m: any) => m.name === 'cible')).toEqual([]);
  });

  it('temoin : sans les imports, le meme fichier donne le meme verdict', () => {
    const sansImports = sources.map(s => ({ ...s, text: s.text.split('\n').filter(l => !l.startsWith('import ')).join('\n') }));
    const out = mod.findUnusedMembers({ sources: sansImports, testSourceSets: SEGS, includeSelfOnly: true, deadDeclarations: [] });
    expect(out.filter((m: any) => m.name === 'cible')).toEqual([]);
  });
});
