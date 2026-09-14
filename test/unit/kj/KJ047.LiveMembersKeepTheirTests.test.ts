import { describe, it, expect, vi, afterEach } from 'vitest';
import * as vscodeMock from '../__mocks__/vscode';
import { scanTestOnly } from '../../../src/commands/RemoveTestOnlyCode';

/**
 * Un test qui exerce des membres VIVANTS n est pas supprime avec le membre
 * mort qu il verifie en passant.
 *
 * Vu sur le projet de reference : « Remove Test Only Code » proposait de
 * retirer sept tests de `EditionDatabaseHelperTest` avec
 * `EditionState.isDownloadingZip`, parce que chacun finit par
 * `assertFalse(state.isDownloadingZip())`. Ces tests persistent une edition
 * par `insertEdition`, la relisent par `getDownloadStatus` et verifient six
 * autres etats : du code vivant perdait sa couverture. La garde « le test
 * couvre autre chose » ne regardait que les noms de PREMIER NIVEAU du code
 * principal ; un appel de membre ne la declenchait jamais.
 */

const K = 'app/src/main/java/com/x';
const T = 'app/src/test/java/com/x';
const f = (path: string, text: string) => ({ path, text });
const corpus = (s: Array<{ path: string; text: string }>): any => ({
  get: async () => ({ sources: s, moduleDirs: [], modulesWithCode: [], libraryModules: [], truncated: false, sourcesTruncated: false }),
});
const etat = f(`${K}/Etat.kt`, 'package com.x\n\nclass Etat(val v: Int) {\n    fun estPret() = v == 1\n    fun estEnCours() = v == 2\n}\n');
const depot = f(`${K}/Depot.kt`, 'package com.x\n\nclass Depot {\n    private var e = Etat(0)\n    fun enregistre(v: Int) { e = Etat(v) }\n    fun lit(): Etat = e\n}\n');
const main = f(`${K}/Main.kt`, 'package com.x\n\nfun main() { val d = Depot(); d.enregistre(1); println(d.lit().estPret()) }\n');

describe('KJ-047 un test qui couvre des membres vivants reste', () => {
  afterEach(() => vi.restoreAllMocks());
  const config = () => vi.spyOn(vscodeMock.workspace, 'getConfiguration').mockReturnValue({ get: (_k: string, d: any) => d } as any);

  it('le cas du projet de reference : le test du depot n est pas propose avec estEnCours', async () => {
    config();
    // Le depot vient d un champ, comme `replicaDatabaseServiceImpl` injecte :
    // le corps du test ne nomme aucune declaration de premier niveau.
    const test = f(`${T}/DepotTest.kt`, 'package com.x\n\nclass DepotTest {\n    private val d = Depot()\n\n    @Test\n    fun persiste() {\n        d.enregistre(1)\n        check(d.lit().estPret())\n        check(!d.lit().estEnCours())\n    }\n}\n');
    const scan = await scanTestOnly(corpus([etat, depot, main, test]));
    expect(scan!.groups.map(g => g.group.label)).not.toContain('Etat.estEnCours');
  });

  it('temoin : un test qui ne nomme que le membre mort et son conteneur est propose', async () => {
    config();
    const test = f(`${T}/EtatTest.kt`, 'package com.x\n\nclass EtatTest {\n    @Test\n    fun enCours() { check(Etat(2).estEnCours()) }\n}\n');
    const scan = await scanTestOnly(corpus([etat, depot, main, test]));
    expect(scan!.groups.map(g => g.group.label)).toContain('Etat.estEnCours');
  });

  it('temoin : les membres de la classe retiree partent avec elle et ne retiennent rien', async () => {
    config();
    const horloge = f(`${K}/Horloge.kt`, 'package com.x\n\nclass Horloge {\n    fun maintenant() = 42\n}\n');
    const test = f(`${T}/HorlogeTest.kt`, 'package com.x\n\nclass HorlogeTest {\n    @Test\n    fun maintenant() { check(Horloge().maintenant() == 42) }\n}\n');
    const scan = await scanTestOnly(corpus([etat, depot, main, horloge, test]));
    expect(scan!.groups.map(g => g.group.label)).toContain('Horloge');
  });

  it('un membre vivant homonyme d un membre de la classe retiree retient le test', async () => {
    // `lit` existe aussi dans Depot, vivant : l appel peut le viser.
    config();
    const horloge = f(`${K}/Horloge.kt`, 'package com.x\n\nclass Horloge {\n    fun lit() = 42\n}\n');
    const test = f(`${T}/HorlogeTest.kt`, 'package com.x\n\nclass HorlogeTest {\n    @Test\n    fun lit() { check(Horloge().lit() == 42) }\n}\n');
    const scan = await scanTestOnly(corpus([etat, depot, main, horloge, test]));
    expect(scan!.groups.map(g => g.group.label)).not.toContain('Horloge');
  });

  it('une variable locale du code principal ne retient rien : seuls le premier niveau et les membres comptent', async () => {
    config();
    const horloge = f(`${K}/Horloge.kt`, 'package com.x\n\nclass Horloge {\n    fun maintenant() = 42\n}\n');
    const calcul = f(`${K}/Calcul.kt`, 'package com.x\n\nfun calcule(): Int {\n    val valeur = 3\n    return valeur\n}\n');
    const appel = f(`${K}/Main.kt`, 'package com.x\n\nfun main() { val d = Depot(); d.enregistre(1); println(d.lit().estPret()); println(calcule()) }\n');
    const test = f(`${T}/HorlogeTest.kt`, 'package com.x\n\nclass HorlogeTest {\n    @Test\n    fun maintenant() {\n        val valeur = Horloge().maintenant()\n        check(valeur == 42)\n    }\n}\n');
    const scan = await scanTestOnly(corpus([etat, depot, appel, horloge, calcul, test]));
    expect(scan!.groups.map(g => g.group.label)).toContain('Horloge');
  });

  it('un ilot : le membre declare dans UN AUTRE membre de l ilot ne retient pas son test', async () => {
    // L ilot pousse un groupe par membre et ne planifie qu une fois, sur le
    // premier. Toutes ses etendues comptent : `rebond` vit dans Pong, et le
    // premier membre trie ici est la fonction de A.kt.
    config();
    const a = f(`${K}/A.kt`, 'package com.x\n\nfun creePong() = Pong()\n');
    const b = f(`${K}/B.kt`, 'package com.x\n\nclass Pong {\n    val taille = 3\n    fun rebond() = creePong()\n}\n');
    // `taille` n est pas un nom de l ilot : le test la lit, rien d autre.
    const test = f(`${T}/PongTest.kt`, 'package com.x\n\nclass PongTest {\n    @Test\n    fun rebondit() { check(creePong().rebond().taille == 3) }\n}\n');
    const scan = await scanTestOnly(corpus([etat, depot, main, a, b, test]));
    const groupe = scan!.groups.find(g => g.group.label.includes('Pong'));
    expect(groupe, 'l ilot est propose').toBeDefined();
    expect(groupe!.group.path.endsWith('A.kt'), 'le premier membre est bien la fonction').toBe(true);
  });

  it('les mots du NOM d un test ne sont pas des appels', async () => {
    // `initial case - ...` : `initial` est aussi un membre vivant ailleurs.
    // Le nom decrit le test, il n exerce rien.
    config();
    const reglage = f(`${K}/Reglage.kt`, 'package com.x\n\nclass Reglage {\n    val initial = 0\n}\n');
    const appel = f(`${K}/Main.kt`, 'package com.x\n\nfun main() { val d = Depot(); d.enregistre(1); println(d.lit().estPret()); println(Reglage().initial) }\n');
    const test = f(`${T}/EtatTest.kt`, 'package com.x\n\nclass EtatTest {\n    @Test\n    fun `initial case - en cours`() { check(Etat(2).estEnCours()) }\n}\n');
    const scan = await scanTestOnly(corpus([etat, depot, appel, reglage, test]));
    expect(scan!.groups.map(g => g.group.label)).toContain('Etat.estEnCours');
  });
});
