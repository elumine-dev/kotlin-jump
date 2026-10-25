import { describe, it, expect, vi, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as vscodeMock from '../__mocks__/vscode';
import { simulerLePointFixe } from '../../../src/cleanup/simulation';

/**
 * Campagne de nettoyage, T2 : le point fixe simule en memoire.
 *
 * La commande applique une ronde, relit le disque, recommence. Le plan a
 * besoin du meme enchainement sans rien ecrire : chaque coupe recoit sa ronde,
 * et une coupe de ronde 2 est une coupe qui n existe qu une fois la ronde 1
 * appliquee. C est ce qui separe la vague 1 (zero reference aujourd hui) de la
 * vague 2 (morte une fois la premiere PR fusionnee).
 */

const SEGS = ['/src/test/'];
const f = (path: string, text: string) => ({ path, text });
const GRADLE = f('/w/app/build.gradle', "plugins { id 'com.android.application' }\n");
const MAIN = f('/w/app/src/main/java/com/example/kiosk/Main.kt', 'package com.example.kiosk\n\nfun main() {\n    println(1)\n}\n');
// Morte des aujourd hui : rien ne la nomme. Elle est la seule a lire la cle.
const DEAD = f('/w/app/src/main/java/com/example/kiosk/DeadScreen.kt', [
  'package com.example.kiosk', '',
  'class DeadScreen {', '    fun title(): Int = R.string.kiosk_title', '}', '',
].join('\n'));
// Vivante tant que DeadScreen la lit : morte a la ronde 2, et son fichier avec elle.
const STRINGS = f('/w/app/src/main/res/values/strings.xml',
  '<resources>\n    <string name="kiosk_title">Kiosk</string>\n</resources>\n');

const corpus = () => ({
  sources: [GRADLE, MAIN, DEAD, STRINGS],
  modulesWithCode: ['/w/app'],
  libraryModules: [] as string[],
  moduleDirs: ['/w/app'],
});

afterEach(() => vi.restoreAllMocks());

describe('T2b, les mentions au texte d origine', () => {
  it('indexe, pour chaque coupe, les fichiers qui la nomment en code et en commentaire, et ceux qui la declarent', async () => {
    const DOC = f('/w/app/src/main/java/com/example/kiosk/Doc.kt', 'package com.example.kiosk\n\n// Replaces DeadScreen, see kiosk_title\nfun main2() {\n    println(2)\n}\n');
    const sim = await simulerLePointFixe({ ...corpus(), sources: [GRADLE, MAIN, DEAD, STRINGS, DOC] }, SEGS, {});
    const m = sim.mentions!;
    expect([...m.brut.get('DeadScreen')!].sort()).toEqual([DEAD.path, DOC.path]);
    expect([...m.code.get('DeadScreen')!]).toEqual([DEAD.path]);
    expect([...m.declare.get('DeadScreen')!]).toEqual([DEAD.path]);
  });

  it('une cle de ressource s indexe qualifiee (R.string.x, @string/x), jamais par son mot nu, et ses declarations a part', async () => {
    // `suspend`, `delete`, `resume` sont des cles de la reference : le mot nu
    // les trouvait dans 600 fichiers. Le relecteur cherchera `R.string.delete`.
    // Le mot nu en commentaire : un `val kiosk_title` serait lui-meme une coupe nommee ainsi, et une chaine « kiosk_title » garderait la cle vivante.
    const DOC = f('/w/app/src/main/java/com/example/kiosk/Doc.kt', 'package com.example.kiosk\n\n// was R.string.kiosk_title\nfun main2() {\n    println(2) // kiosk_title\n}\n');
    const LAYOUT = f('/w/app/src/main/res/layout/card.xml', '<TextView android:text="@string/other" /><!-- @string/kiosk_title -->\n');
    const sim = await simulerLePointFixe({ ...corpus(), sources: [GRADLE, MAIN, DEAD, STRINGS, DOC, LAYOUT] }, SEGS, {});
    const m = sim.mentions!;
    expect(m.brut.has('kiosk_title')).toBe(false);
    expect([...m.brut.get('string/kiosk_title')!].sort()).toEqual([DEAD.path, DOC.path, LAYOUT.path].sort());
    expect([...m.code.get('string/kiosk_title')!]).toEqual([DEAD.path]);
    expect([...m.declare.get('string/kiosk_title')!]).toEqual([STRINGS.path]);
  });
});

describe('T2, ce que la simulation sait dire d un fichier et d un nom', () => {
  it('un fichier values deja vide est un fichier qui ne declare rien, pas une ressource que rien ne nomme', async () => {
    const VIDE = f('/w/app/src/main/res/values/empty.xml', '<resources>\n</resources>\n');
    const sim = await simulerLePointFixe({ ...corpus(), sources: [GRADLE, MAIN, VIDE] }, SEGS, {});
    const c = sim.coupes.find(x => x.path === VIDE.path)!;
    expect(c.famille).toBe('vides');
    expect(c.preuve?.verdict).toBe('emptied');
  });

  it('une declaration dont un homonyme vit ailleurs est marquee, pour que la fiche le dise', async () => {
    const MORT = f('/w/app/src/main/java/com/example/kiosk/old/Twin.kt', 'package com.example.kiosk.old\n\nclass Twin\n');
    const VIVANT = f('/w/app/src/main/java/com/example/portal/Twin.kt', 'package com.example.portal\n\nclass Twin {\n    fun go() = 1\n}\n');
    const USAGE = f('/w/app/src/main/java/com/example/portal/Use.kt', 'package com.example.portal\n\nfun main() {\n    println(Twin().go())\n}\n');
    const sim = await simulerLePointFixe({ ...corpus(), sources: [GRADLE, MORT, VIVANT, USAGE] }, SEGS, {});
    const c = sim.coupes.find(x => x.quoi === 'Twin')!;
    expect(c.path).toBe(MORT.path);
    expect(c.preuve?.homonyme).toBe(true);
    const seul = (await simulerLePointFixe(corpus(), SEGS, {})).coupes.find(x => x.quoi === 'DeadScreen')!;
    expect(seul.preuve?.homonyme).toBeUndefined();
  });

  it('un fichier ecarte parce que son document ouvert a change ne revient pas en ronde 2 comme un orphelin', async () => {
    vi.spyOn(vscodeMock.workspace, 'textDocuments', 'get').mockReturnValue(
      [{ uri: vscodeMock.Uri.file(DEAD.path), isDirty: true, getText: () => DEAD.text + '\n// edited\n' }] as any);
    // Une autre classe morte fait tourner une ronde 2, ou DeadScreen serait retrouvee si rien ne l excluait.
    const AUTRE = f('/w/app/src/main/java/com/example/kiosk/Other.kt', 'package com.example.kiosk\n\nclass Other\n');
    const sim = await simulerLePointFixe({ ...corpus(), sources: [GRADLE, MAIN, DEAD, STRINGS, AUTRE] }, SEGS, {});
    expect(sim.ecartes).toEqual([DEAD.path]);
    expect(sim.coupes.filter(c => c.path === DEAD.path)).toEqual([]);
    expect(sim.coupes.find(c => c.quoi === 'Other')?.round).toBe(1);
    // La cle que seule DeadScreen lisait reste vivante : DeadScreen n a pas ete retiree.
    expect(sim.coupes.find(c => c.quoi === 'string/kiosk_title')).toBeUndefined();
  });
});

describe('T2, la simulation donne sa ronde a chaque coupe', () => {
  it('une classe morte part en ronde 1, la cle qu elle seule lisait en ronde 2, et son fichier vide avec', async () => {
    const sim = await simulerLePointFixe(corpus(), SEGS, {});
    const parQuoi = new Map(sim.coupes.map(c => [`${c.famille}:${c.quoi || c.path}`, c]));
    expect(parQuoi.get('symboles:DeadScreen')?.round).toBe(1);
    // La classe etait seule dans son fichier : le fichier part avec elle, des
    // la ronde 1, et la coupe de la classe reste pour sa preuve.
    expect(parQuoi.get('symboles:DeadScreen')?.fichierSupprime).toBe(true);
    expect(parQuoi.get(`fichiers:${DEAD.path}`)?.round).toBe(1);
    expect(parQuoi.get(`fichiers:${DEAD.path}`)?.contenait).toEqual(['DeadScreen']);
    expect(parQuoi.get('cles:string/kiosk_title')?.round).toBe(2);
    expect(parQuoi.get(`fichiers:${STRINGS.path}`)?.round).toBe(2);
    expect(sim.complete).toBe(true);
    expect(sim.rondes).toBe(2);
  });

  it('les cles sont stables d une simulation a l autre et ne portent aucun offset', async () => {
    const a = await simulerLePointFixe(corpus(), SEGS, {});
    const b = await simulerLePointFixe(corpus(), SEGS, {});
    expect(a.coupes.map(c => c.cle)).toEqual(b.coupes.map(c => c.cle));
    for (const c of a.coupes) expect(c.cle).not.toMatch(/\t\d+$/);
    expect(a.coupes.find(c => c.quoi === 'DeadScreen')?.cle).toBe(`symboles\t${DEAD.path}\tDeadScreen`);
  });

  it('n ecrit rien : le module ne touche pas au disque et ne modifie pas le corpus recu', async () => {
    // Un espion sur `fs` n est pas posable sur un module ESM ; la garde est
    // statique, comme NoStaleTestCopies : la simulation n importe pas `fs`.
    const source = fs.readFileSync(new URL('../../../src/cleanup/simulation.ts', import.meta.url), 'utf8');
    expect(source).not.toMatch(/from '(node:)?fs/);
    expect(source).not.toMatch(/vscode\.workspace\.(fs|applyEdit)/);
    const c = corpus();
    const avant = JSON.stringify(c);
    await simulerLePointFixe(c, SEGS, {});
    expect(JSON.stringify(c)).toBe(avant);
  });

  it('une annulation rend un plan partiel, dit incomplet', async () => {
    const sim = await simulerLePointFixe(corpus(), SEGS, {}, { estAnnule: () => true });
    expect(sim.complete).toBe(false);
    expect(sim.rondes).toBe(0);
  });

  it('la coupe d un fichier supprime porte son texte entier comme extrait, pour retrouver ce qu elle declenchait', async () => {
    const sim = await simulerLePointFixe(corpus(), SEGS, {});
    const fichier = sim.coupes.find(c => c.famille === 'fichiers' && c.path === STRINGS.path)!;
    expect(fichier.extrait).toContain('kiosk_title');
    expect(fichier.preuve?.verdict).toBe('emptied');
  });
});
