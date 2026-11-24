import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { findUnusedSymbols, explainSymbols } from '../../../src/providers/unusedSymbols';
import { simulerLePointFixe } from '../../../src/cleanup/simulation';
import { androidApi } from '../../../src/util/androidApi';

/**
 * G71, une vue que seuls une declaration d injection et une phrase de log nomment.
 *
 * Vu sur le projet de reference : une vue que plus rien ne construit, nommee
 * par deux declarations `inject(target: X)`, par son layout, et par une phrase
 * de log ecrite dans une autre classe (« X page requested %s but only %s
 * exist »). Les mots des chaines comptent comme des mentions, parce qu une
 * chaine peut nommer une classe pour de vrai : reflexion, regle keep, requete.
 * La regle d injection (KJ-067) exige donc que les mentions soient exactement
 * les declarations d injection, et une phrase suffisait a tout retenir.
 *
 * Une phrase ne tient aucune instance. Dans cette regle seulement, un nom
 * ecrit comme un mot d une phrase ne compte plus : dans une chaine, entre deux
 * espaces, a cote d un mot en minuscules. Toute autre forme continue de tenir,
 * et chacune a son jumeau ici, qui ne differe que par la chaine.
 */

const api = androidApi(JSON.parse(fs.readFileSync(path.join(__dirname, '../../../bundled/android-api-36.json'), 'utf8')));

type Source = { path: string; text: string };
const f = (p: string, text: string): Source => ({ path: p, text });
const SEGS = ['/src/test/'];
const APP = '/w/app';
const MAIN = `${APP}/src/main/java/com/x`;
const VIEW_PATH = `${MAIN}/Carousel.java`;
const LAYOUT_PATH = `${APP}/src/main/res/layout/carousel.xml`;
const COMPONENT_PATH = `${MAIN}/di/AppComponent.kt`;
const PAGER_PATH = `${MAIN}/Pager.java`;

const SENTENCE = 'Log.w("Pager", "Carousel page requested %s but only %s exist");';

const view = (o: { contract?: boolean; body?: string[] } = {}) => f(VIEW_PATH, [
  'package com.x;', '',
  'import android.content.Context;',
  'import android.widget.FrameLayout;',
  'import android.widget.TextView;', '',
  `public class Carousel extends FrameLayout${o.contract ? ' implements CarouselContract.View' : ''} {`, '',
  '\tpublic Carousel(Context context) {', '\t\tsuper(context);',
  ...(o.body ?? ['\t\tinflate(context, R.layout.carousel, this);']),
  '\t}', '}', '',
].join('\n'));

const layout = (root: 'merge' | 'com.x.Carousel') => f(LAYOUT_PATH, [
  '<?xml version="1.0" encoding="utf-8"?>',
  `<${root} xmlns:android="http://schemas.android.com/apk/res/android">`,
  '    <TextView android:id="@+id/carousel_title" />',
  `</${root}>`, '',
].join('\n'));

const component = (injects = true) => f(COMPONENT_PATH, [
  'package com.x.di', '',
  ...(injects ? ['import com.x.Carousel'] : []),
  'import com.x.Home', 'import dagger.Component', '',
  '@Component', 'interface AppComponent {',
  ...(injects ? ['    fun inject(target: Carousel)'] : []),
  '    fun inject(target: Home)', '}', '',
].join('\n'));

/** A live class: `Home` calls it. Its body is where the string under test sits. */
const pager = (lines: string[], supertype = '') => f(PAGER_PATH, [
  'package com.x;', '',
  'import android.util.Log;', '',
  `public class Pager${supertype} {`, '',
  '\tpublic void show(int page, int count) {',
  ...lines.map(l => `\t\t${l}`),
  '\t}', '}', '',
].join('\n'));

const home = (...body: string[]) => f(`${MAIN}/Home.kt`, [
  'package com.x', '', 'import android.app.Activity', '',
  'class Home : Activity() {', '    override fun onResume() {', '        super.onResume()',
  '        Pager().show(1, 2)', ...body.map(l => `        ${l}`), '    }', '}', '',
].join('\n'));

const CONTRACT = f(`${MAIN}/CarouselContract.java`, [
  'package com.x;', '',
  'public interface CarouselContract {', '',
  '\tinterface View {', '\t}', '',
  '\tinterface Presenter {', '\t}', '}', '',
].join('\n'));

const ENTRIES = [{ kind: 'layout' as const, name: 'carousel', variants: [{ path: LAYOUT_PATH, qualifier: 'layout', moduleDir: APP }] }];

const rapportee = (...sources: Source[]) =>
  findUnusedSymbols({ sources, testSourceSets: SEGS, androidApi: api }).find(s => s.name === 'Carousel');
const expliquee = (...sources: Source[]) =>
  explainSymbols({ sources, testSourceSets: SEGS, androidApi: api }).find(s => s.name === 'Carousel');
/** The corpus around one string: everything alive but the view. */
const avec = (...lines: string[]) => [view(), layout('merge'), component(), home(), pager(lines)];

const coupes = async (...sources: Source[]) => {
  const sim = await simulerLePointFixe(
    { sources, resourceEntries: ENTRIES, modulesWithCode: [APP], moduleDirs: [APP] }, SEGS, { androidApi: api });
  expect(sim.complete).toBe(true);
  return sim.coupes;
};
/** chemin -> ronde, pour chaque fichier que le point fixe supprime. */
const supprimes = async (...sources: Source[]) =>
  new Map((await coupes(...sources)).filter(c => c.famille === 'fichiers' || c.famille === 'ressources').map(c => [c.path, c.round]));

describe('G71, une vue qu une phrase de log nomme', () => {
  it('temoin : sans la phrase, la vue est rapportee par la regle d injection', () => {
    expect(rapportee(...avec('Log.w("Pager", "page requested");'))).toMatchObject({ verdict: 'unreferenced', via: 'injection' });
  });

  it('avec la phrase, elle l est encore', () => {
    expect(rapportee(...avec(SENTENCE))).toMatchObject({ verdict: 'unreferenced', via: 'injection' });
  });

  it('l explication et le scan disent la meme chose', () => {
    expect(expliquee(...avec(SENTENCE))).toMatchObject({ outcome: 'unreferenced', via: 'injection' });
    expect(expliquee(...avec('Log.w("Carousel", "page requested");'))).toMatchObject({ outcome: 'alive:main' });
  });

  it('deux phrases, dont une en fin de chaine, se retranchent toutes les deux', () => {
    expect(rapportee(...avec(SENTENCE, 'Log.w("Pager", "nothing left in the Carousel");')))
      .toMatchObject({ verdict: 'unreferenced', via: 'injection' });
  });

  it('la vue, son layout, la declaration d injection et son import partent, la phrase reste', async () => {
    const temoin = await coupes(...avec('Log.w("Pager", "page requested");'));
    const liste = await coupes(...avec(SENTENCE));
    const vue = (l: typeof liste) => l.map(c => `${c.round} ${c.famille} ${c.path} ${c.extrait.trim().split('\n')[0]}`).sort();
    expect(vue(liste)).toEqual(vue(temoin));
    expect(liste.filter(c => c.famille === 'fichiers' || c.famille === 'ressources').map(c => c.path).sort())
      .toEqual([VIEW_PATH, LAYOUT_PATH].sort());
    expect(liste.filter(c => c.path === COMPONENT_PATH).map(c => `${c.famille} ${c.extrait.trim()}`).sort())
      .toEqual(['balayage import com.x.Carousel', 'injections fun inject(target: Carousel)']);
    expect(liste.filter(c => c.path === PAGER_PATH)).toEqual([]);
  });

  // The real shape: the string alone on its line under the call, a view that
  // implements a nested interface of its contract, a layout naming the view.
  it('la forme vue sur le projet de reference part dans une seule ronde', async () => {
    const corps = ['\t\t((TextView) findViewById(R.id.carousel_title)).setText("x");'];
    const autour = [view({ contract: true, body: corps }), layout('com.x.Carousel'), component(), home(), CONTRACT];
    const phrase = ['Log.w("Pager", String.format(', '\t\t"Carousel page requested %s but only %s exist",', '\t\tpage, count));'];
    const temoin = await supprimes(...autour, pager(['Log.w("Pager", "page requested");'], ' implements CarouselContract.Presenter'));
    const partis = await supprimes(...autour, pager(phrase, ' implements CarouselContract.Presenter'));
    expect([...temoin.keys()].sort()).toEqual([VIEW_PATH, LAYOUT_PATH].sort());
    expect(partis).toEqual(temoin);
    expect(partis.get(VIEW_PATH)).toBe(partis.get(LAYOUT_PATH));
  });
});

describe('G71, jumeaux : ce qu une chaine ecrit et qui tient encore la vue', () => {
  const formes: [string, string][] = [
    ['le nom seul', 'Log.w("Carousel", "page requested");'],
    ['le nom qualifie', 'Log.w("Pager", "com.x.Carousel page requested");'],
    ['un membre du nom', 'Log.w("Pager", "Carousel.title page requested");'],
    ['une ligne qui porte un $', 'Log.w("Pager", "Carousel page requested $1");'],
    ['une apostrophe sur la ligne', 'Log.w("Pager", "Carousel page couldn\'t load");'],
    ['une requete', 'Log.w("Pager", "select id from Carousel where page = 1");'],
    ['une requete en majuscules', 'Log.w("Pager", "SELECT id FROM Carousel WHERE page = 1");'],
    ['une requete a la casse melangee', 'Log.w("Pager", "SELECT id FROM Carousel where page = 1");'],
    ['une regle keep', 'Log.w("Pager", "-keep class Carousel extends android.view.View");'],
    ['un JSON a guillemets echappes', 'Log.w("Pager", "{\\"view\\": \\"Carousel\\", \\"page\\": 1}");'],
    ['un nom derriere un guillemet echappe', 'Log.w("Pager", "\\"Carousel page\\" requested");'],
    ['une liste de noms', 'Log.w("Pager", "Carousel Footer Header");'],
    ['un voisin d une seule lettre', 'Log.w("Pager", "Carousel x");'],
    ['un voisin de droite en camelCase', 'Log.w("Pager", "Carousel pageCount");'],
    ['un voisin de gauche en camelCase', 'Log.w("Pager", "pageCount Carousel");'],
    ['un nom colle a une ponctuation', 'Log.w("Pager", "the Carousel, page requested");'],
    ['un bloc de texte Java', 'String s = """Carousel page requested""";'],
  ];
  for (const [nom, ligne] of formes) {
    it(`${nom} tient la vue`, () => {
      expect(rapportee(...avec(ligne))).toBeUndefined();
    });
  }

  // After one of these the name is a reference: a query, a keep rule, code quoted in a message.
  for (const mot of ['class', 'interface', 'extends', 'implements', 'new', 'import', 'from', 'into', 'table', 'join', 'update']) {
    it(`le nom ecrit apres « ${mot} » tient la vue`, () => {
      expect(rapportee(...avec(`Log.w("Pager", "${mot} Carousel page requested");`))).toBeUndefined();
    });
  }

  it('temoin des jumeaux : la meme ligne, ecrite en phrase, ne la tient pas', () => {
    expect(rapportee(...avec('Log.w("Pager", "Carousel page requested");'))).toBeDefined();
  });

  it('une phrase et une forme qui tient, ensemble : la vue reste', () => {
    expect(rapportee(...avec(SENTENCE, 'Log.w("Carousel", "page requested");'))).toBeUndefined();
  });
});

describe('G71, jumeaux : ou la phrase est ecrite', () => {
  const ailleurs = (p: string, text: string) => [...avec('Log.w("Pager", "page requested");'), f(p, text)];

  it('dans un gabarit Kotlin, elle tient la vue', () => {
    const kt = f(`${MAIN}/Report.kt`, 'package com.x\n\nfun report(page: Int): String = "Carousel page $page requested"\n');
    expect(rapportee(...avec('Log.w("Pager", "page requested");'), kt, f(`${MAIN}/Use.kt`, 'package com.x\n\nfun main() {\n    report(1)\n}\n')))
      .toBeUndefined();
  });

  it('dans une chaine Kotlin sans gabarit, elle ne la tient pas', () => {
    const kt = f(`${MAIN}/Report.kt`, 'package com.x\n\nfun report(): String = "Carousel page requested"\n');
    expect(rapportee(...avec('Log.w("Pager", "page requested");'), kt, f(`${MAIN}/Use.kt`, 'package com.x\n\nfun main() {\n    report()\n}\n')))
      .toMatchObject({ verdict: 'unreferenced', via: 'injection' });
  });

  it('dans un attribut XML, elle tient la vue', () => {
    expect(rapportee(...ailleurs(`${APP}/src/main/res/layout/footer.xml`,
      '<TextView xmlns:android="http://schemas.android.com/apk/res/android" android:contentDescription="Carousel page requested" />\n')))
      .toBeUndefined();
  });

  it('dans un script Gradle, elle tient la vue', () => {
    expect(rapportee(...ailleurs(`${APP}/build.gradle.kts`, 'description = "Carousel page requested"\n'))).toBeUndefined();
  });

  it('dans un fichier de regles, elle tient la vue', () => {
    expect(rapportee(...ailleurs(`${APP}/proguard-rules.pro`, '# "Carousel page requested"\n'))).toBeUndefined();
  });

  it('dans un test, elle laisse la vue a revoir', () => {
    const test = f(`${APP}/src/test/java/com/x/PagerTest.java`, [
      'package com.x;', '', 'public class PagerTest {', '',
      '\tString expected = "Carousel page requested";', '}', '',
    ].join('\n'));
    expect(rapportee(...avec('Log.w("Pager", "page requested");'), test)).toMatchObject({ verdict: 'testOnly', via: 'injection' });
  });
});

describe('G71, gardes : ce que la phrase ne doit pas defaire', () => {
  it('un vrai usage a cote de la phrase garde la vue', () => {
    expect(rapportee(view(), layout('merge'), component(), home('Carousel(this)'), pager([SENTENCE]))).toBeUndefined();
  });

  it('une phrase et un vrai usage dans le meme fichier : la vue reste', () => {
    // One sentence takes one mention away, never the other mentions of its file.
    expect(rapportee(view(), layout('merge'), component(), home(), pager([SENTENCE, 'Object held = new Carousel(null);']))).toBeUndefined();
  });

  it('un usage ecrit entre deux espaces, hors de toute chaine, garde la vue', () => {
    const usage = ['when (currentFocus) {', '    is Carousel -> return', '    else -> Unit', '}'];
    expect(rapportee(view(), layout('merge'), component(), home(...usage), pager(['Log.w("Pager", "page requested");']))).toBeUndefined();
  });

  it('sans declaration d injection, une phrase seule garde la vue', () => {
    expect(rapportee(view(), layout('merge'), component(false), home(), pager([SENTENCE]))).toBeUndefined();
  });

  it('la phrase ecrite dans le fichier de la vue ne cache pas un usage ecrit ailleurs', () => {
    const bavarde = view({ body: ['\t\tinflate(context, R.layout.carousel, this);', '\t\tandroid.util.Log.w("x", "Carousel page requested");'] });
    expect(rapportee(bavarde, layout('merge'), component(), home('Carousel(this)'), pager(['Log.w("Pager", "page requested");']))).toBeUndefined();
    expect(rapportee(bavarde, layout('merge'), component(), home(), pager(['Log.w("Pager", "page requested");'])))
      .toMatchObject({ verdict: 'unreferenced', via: 'injection' });
  });

  it('une fonction du meme nom qu un mot de phrase reste jugee comme avant', () => {
    // The rule lives in the injection branch: a function is never judged there.
    const fn = f(`${MAIN}/Requested.kt`, 'package com.x\n\nfun requested() {\n    println("x")\n}\n');
    const sans = findUnusedSymbols({ sources: [...avec('Log.w("Pager", "page asked");'), fn], testSourceSets: SEGS, androidApi: api });
    const avecLaPhrase = findUnusedSymbols({ sources: [...avec('Log.w("Pager", "page requested twice");'), fn], testSourceSets: SEGS, androidApi: api });
    expect(sans.map(s => s.name)).toContain('requested');
    expect(avecLaPhrase.map(s => s.name)).not.toContain('requested');
  });
});
