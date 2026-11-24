import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { findUnusedSymbols } from '../../../src/providers/unusedSymbols';
import { simulerLePointFixe } from '../../../src/cleanup/simulation';
import { androidApi } from '../../../src/util/androidApi';

/**
 * G69 — une vue que seuls une declaration d injection et son layout nomment.
 *
 * Vu sur le projet de reference : une vue `extends FrameLayout`, nommee par
 * une declaration `inject(target: X)` et par la balise racine de son propre
 * layout, dont elle lit un `R.id`. Rien ne la construit, rien ne gonfle le
 * layout, et rien ne partait. Deux causes, separees ici :
 *
 * - la regle d injection (KJ-067) abandonnait des que la chaine des
 *   supertypes sortait du corpus par un nom absent de la liste ecrite a la
 *   main, alors que l index de la plateforme sait que `FrameLayout` est une
 *   vue. G09 decrit la meme garde sans passer l index ;
 * - la balise garde la classe, la lecture de `R.id` garde le layout. Aucun des
 *   deux detecteurs ne tranche seul : la passe rejoue les symboles sans le
 *   layout, et coupe la paire dans la meme ronde. Le layout seul laisserait un
 *   `R.id` qui ne se resout plus.
 *
 * Chaque cas a son jumeau, qui ne differe que d une chose : une fixture mal
 * formee ne peut pas passer pour le defaut.
 *
 * Limite assumee : `ConstraintLayout` et les autres vues AndroidX ne sont pas
 * dans l index de la plateforme, elles restent retenues.
 */

const api = androidApi(JSON.parse(fs.readFileSync(path.join(__dirname, '../../../bundled/android-api-36.json'), 'utf8')));

type Source = { path: string; text: string };
const f = (p: string, text: string): Source => ({ path: p, text });
const SEGS = ['/src/test/'];
const APP = '/w/app';
const MAIN = `${APP}/src/main/java/com/x`;
const VIEW_PATH = `${MAIN}/Carousel.java`;
const LAYOUT_PATH = `${APP}/src/main/res/layout/carousel.xml`;

const INFLATES_ITSELF = '\t\tinflate(context, R.layout.carousel, this);';
const READS_AN_ID = '\t\t((TextView) findViewById(R.id.carousel_title)).setText("x");';

const SUPERTYPES = {
  ViewGroup: 'android.view.ViewGroup',
  FrameLayout: 'android.widget.FrameLayout',
  Handler: 'android.os.Handler',
};

const view = (supertype: keyof typeof SUPERTYPES, body = '') => f(VIEW_PATH, [
  'package com.x;', '',
  'import android.content.Context;',
  `import ${SUPERTYPES[supertype]};`,
  'import android.widget.TextView;', '',
  `public class Carousel extends ${supertype} {`, '',
  '\tpublic Carousel(Context context) {', '\t\tsuper(context);', body, '\t}', '}', '',
].join('\n'));

const layout = (root: 'merge' | 'com.x.Carousel') => f(LAYOUT_PATH, [
  '<?xml version="1.0" encoding="utf-8"?>',
  `<${root} xmlns:android="http://schemas.android.com/apk/res/android">`,
  '    <TextView android:id="@+id/carousel_title" />',
  `</${root}>`, '',
].join('\n'));

const COMPONENT = f(`${MAIN}/AppComponent.kt`, [
  'package com.x', '', 'import dagger.Component', '',
  '@Component', 'interface AppComponent {',
  '    fun inject(target: Carousel)', '    fun inject(target: Home)', '}', '',
].join('\n'));

const home = (body = '') => f(`${MAIN}/Home.kt`, [
  'package com.x', '', 'import android.app.Activity', '',
  // A lifecycle override: the body must not be dead code itself.
  'class Home : Activity() {', '    override fun onResume() {', '        super.onResume()', body, '    }', '}', '',
].join('\n'));

const ENTRIES = [{ kind: 'layout' as const, name: 'carousel', variants: [{ path: LAYOUT_PATH, qualifier: 'layout', moduleDir: APP }] }];

const rapportee = (...sources: Source[]) =>
  findUnusedSymbols({ sources, testSourceSets: SEGS, androidApi: api })
    .find(s => s.name === 'Carousel');

/** chemin -> ronde, pour chaque fichier que le point fixe supprime. */
const supprimes = async (...sources: Source[]) => {
  const sim = await simulerLePointFixe(
    { sources, resourceEntries: ENTRIES, modulesWithCode: [APP], moduleDirs: [APP] }, SEGS, { androidApi: api });
  expect(sim.complete).toBe(true);
  return new Map(sim.coupes.filter(c => c.famille === 'fichiers' || c.famille === 'ressources').map(c => [c.path, c.round]));
};

describe('G69, une vue que seule une declaration d injection nomme', () => {
  it('temoin : rapportee quand son supertype est de ceux que le detecteur epelle', () => {
    expect(rapportee(view('ViewGroup'), COMPONENT, home())).toMatchObject({ verdict: 'unreferenced', via: 'injection' });
  });

  it('rapportee quand l index de la plateforme dit que son supertype est une vue', () => {
    expect(rapportee(view('FrameLayout'), COMPONENT, home())).toMatchObject({ verdict: 'unreferenced', via: 'injection' });
  });

  it('temoin : part avec le layout qu elle gonfle elle meme, supertype epele', async () => {
    const partis = await supprimes(view('ViewGroup', INFLATES_ITSELF), layout('merge'), COMPONENT, home());
    expect([...partis.keys()].sort()).toEqual([VIEW_PATH, LAYOUT_PATH].sort());
  });

  it('part avec le layout qu elle gonfle elle meme, supertype connu de l index seul', async () => {
    const partis = await supprimes(view('FrameLayout', INFLATES_ITSELF), layout('merge'), COMPONENT, home());
    expect([...partis.keys()].sort()).toEqual([VIEW_PATH, LAYOUT_PATH].sort());
  });
});

describe('G69, une vue et le layout qui la nomme, rien d autre', () => {
  it('temoin : les deux partent quand la vue ne lit aucun id du layout', async () => {
    const partis = await supprimes(view('ViewGroup'), layout('com.x.Carousel'), COMPONENT, home());
    expect([...partis.keys()].sort()).toEqual([VIEW_PATH, LAYOUT_PATH].sort());
  });

  it('les deux partent, dans la meme ronde, quand la vue lit un id du layout', async () => {
    const partis = await supprimes(view('ViewGroup', READS_AN_ID), layout('com.x.Carousel'), COMPONENT, home());
    expect([...partis.keys()].sort()).toEqual([VIEW_PATH, LAYOUT_PATH].sort());
    expect(partis.get(VIEW_PATH)).toBe(partis.get(LAYOUT_PATH));
  });

  // The view is cut twice in that round, once on its own and once with the layout.
  // The layout names no reader here: the pass reads the first scan, no replay.
  it('les deux partent aussi quand la vue etait deja morte sans le layout', async () => {
    const partis = await supprimes(view('ViewGroup', READS_AN_ID), layout('merge'), COMPONENT, home());
    expect([...partis.keys()].sort()).toEqual([VIEW_PATH, LAYOUT_PATH].sort());
    expect(partis.get(VIEW_PATH)).toBe(partis.get(LAYOUT_PATH));
  });

  // Needs both fixes: the supertype for the injection rule, the pair for the layout.
  it('la forme reelle : FrameLayout, son propre layout, une declaration d injection', async () => {
    const partis = await supprimes(view('FrameLayout', READS_AN_ID), layout('com.x.Carousel'), COMPONENT, home());
    expect([...partis.keys()].sort()).toEqual([VIEW_PATH, LAYOUT_PATH].sort());
    expect(partis.get(VIEW_PATH)).toBe(partis.get(LAYOUT_PATH));
  });
});

// The pass skips the replay when the layout writes no word the scan judges a
// reader by. A function sharing its name with a property is also judged by the
// property's accessors: the layout below writes `getCaption` and nothing else.
describe('G69, un lecteur tenu par l accesseur de son homonyme', () => {
  const READER_PATH = `${MAIN}/Captions.kt`;
  const TWIN_PATH = `${MAIN}/Legend.kt`;
  const READER = f(READER_PATH, [
    'package com.x', '', 'import android.view.View', 'import android.widget.TextView', '',
    'fun caption(v: View): TextView = v.findViewById(R.id.carousel_title)', '',
  ].join('\n'));
  const twin = (name: string) => f(TWIN_PATH, ['package com.x', '', `val ${name} = "x"`, ''].join('\n'));
  const TAGGED = f(LAYOUT_PATH, [
    '<?xml version="1.0" encoding="utf-8"?>',
    '<merge xmlns:android="http://schemas.android.com/apk/res/android">',
    '    <TextView android:id="@+id/carousel_title" android:tag="getCaption" />',
    '</merge>', '',
  ].join('\n'));

  it('temoin : sans homonyme, le lecteur et le layout partent dans la meme ronde', async () => {
    const partis = await supprimes(READER, twin('legend'), TAGGED);
    expect([...partis.keys()].sort()).toEqual([READER_PATH, TWIN_PATH, LAYOUT_PATH].sort());
    expect(partis.get(READER_PATH)).toBe(partis.get(LAYOUT_PATH));
  });

  it('avec un homonyme propriete, le rejeu sans le layout libere le lecteur', async () => {
    const partis = await supprimes(READER, twin('caption'), TAGGED);
    expect([...partis.keys()].sort()).toEqual([READER_PATH, TWIN_PATH, LAYOUT_PATH].sort());
    expect(partis.get(READER_PATH)).toBe(partis.get(LAYOUT_PATH));
  });
});

describe('G69, gardes : ce qui reste', () => {
  it('un supertype de la plateforme qui n est pas une vue retient toujours', () => {
    expect(rapportee(view('FrameLayout'), COMPONENT, home())).toBeDefined();
    expect(rapportee(view('Handler'), COMPONENT, home())).toBeUndefined();
  });

  it('la vue que du code vivant construit', async () => {
    const construit = home('        Carousel(this)');
    expect(rapportee(view('FrameLayout'), COMPONENT, construit)).toBeUndefined();
    expect((await supprimes(view('FrameLayout', INFLATES_ITSELF), layout('merge'), COMPONENT, construit)).size).toBe(0);
  });

  it('la vue nommee par un layout que du code vivant gonfle', async () => {
    const gonfle = home('        setContentView(R.layout.carousel)');
    expect((await supprimes(view('FrameLayout'), layout('com.x.Carousel'), COMPONENT, gonfle)).size).toBe(0);
  });

  it('le layout, tant que du code vivant construit la vue qui lit ses ids', async () => {
    const construit = home('        Carousel(this)');
    expect((await supprimes(view('ViewGroup', READS_AN_ID), layout('com.x.Carousel'), COMPONENT, construit)).size).toBe(0);
    expect((await supprimes(view('ViewGroup', READS_AN_ID), layout('merge'), COMPONENT, construit)).size).toBe(0);
  });
});
