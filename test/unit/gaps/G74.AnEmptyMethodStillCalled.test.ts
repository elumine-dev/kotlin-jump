import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { simulerLePointFixe } from '../../../src/cleanup/simulation';
import { androidApi } from '../../../src/util/androidApi';

/**
 * G74, une methode videe que du code vivant appelle encore.
 *
 * Vu sur le projet de reference : un menage retire ce qu une methode faisait
 * et laisse la methode, vide, avec ses appels. Le compilateur est content et
 * l appel ne fait rien. Un humain retire la methode et ses appels ensemble.
 *
 * Le moteur ne le fait pas, et ce n est pas un oubli. Couper un appel exige de
 * savoir de quelle classe est le receveur : sur le projet de reference le nom
 * en cause est declare par cinq classes et une interface. Retirer `x.onDone()`
 * sans prouver le type de `x` retire en silence l appel d une autre classe, et
 * le code compile toujours.
 *
 * Ce fichier decrit la coupe voulue dans sa forme la plus simple, un receveur
 * dont le type est ecrit dans le fichier, puis les formes qui doivent rester.
 */

const api = androidApi(JSON.parse(fs.readFileSync(path.join(__dirname, '../../../bundled/android-api-36.json'), 'utf8')));

type Source = { path: string; text: string };
const f = (p: string, text: string): Source => ({ path: p, text });
const SEGS = ['/src/test/'];
const APP = '/w/app';
const MAIN = `${APP}/src/main/java/com/x`;
const PLAYER_PATH = `${MAIN}/Player.java`;
const SCREEN_PATH = `${MAIN}/Screen.kt`;
const RECORDER_PATH = `${MAIN}/Recorder.java`;

/** `neverCalled` is the canary: dead in the plainest way, it must always be cut. */
const player = (o: { body?: string[]; override?: boolean } = {}) => f(PLAYER_PATH, [
  'package com.x;', '',
  `public class Player${o.override ? ' implements Listener' : ''} {`, '',
  '\tpublic void start() {', '\t\tSystem.out.println("start");', '\t}', '',
  ...(o.override ? ['\t@Override'] : []),
  '\tpublic void onFullscreenDone() {', ...(o.body ?? []).map(l => `\t\t${l}`), '\t}', '',
  '\tpublic void neverCalled() {', '\t\tSystem.out.println("canary");', '\t}',
  '}', '',
].join('\n'));

const screen = (...lines: string[]) => f(SCREEN_PATH, [
  'package com.x', '', 'import android.app.Activity', '',
  'class Screen : Activity() {', '    private val player = Player()', '',
  '    override fun onResume() {', '        super.onResume()', '        player.start()',
  ...lines.map(l => `        ${l}`), '    }', '}', '',
].join('\n'));

const javaCaller = f(`${MAIN}/Panel.java`, [
  'package com.x;', '',
  'import android.app.Activity;', '',
  'public class Panel extends Activity {', '',
  '\tprivate final Player player = new Player();', '',
  '\t@Override', '\tprotected void onResume() {', '\t\tsuper.onResume();',
  '\t\tplayer.start();', '\t\tplayer.onFullscreenDone();', '\t}', '}', '',
].join('\n'));

/** The same name on another class, with a body that does something. */
const RECORDER = f(RECORDER_PATH, [
  'package com.x;', '',
  'public class Recorder {', '',
  '\tpublic void onFullscreenDone() {', '\t\tSystem.out.println("recorded");', '\t}', '}', '',
].join('\n'));

const LISTENER = f(`${MAIN}/Listener.java`, [
  'package com.x;', '',
  'public interface Listener {', '',
  '\tvoid onFullscreenDone();', '}', '',
].join('\n'));

/** What keeps both callers alive: the platform starts them. */
const MANIFEST = f(`${APP}/src/main/AndroidManifest.xml`, [
  '<?xml version="1.0" encoding="utf-8"?>',
  '<manifest xmlns:android="http://schemas.android.com/apk/res/android">',
  '    <application>',
  '        <activity android:name="com.x.Screen" />',
  '        <activity android:name="com.x.Panel" />',
  '    </application>',
  '</manifest>', '',
].join('\n'));

const coupes = async (...sources: Source[]) => {
  const sim = await simulerLePointFixe(
    { sources: [MANIFEST, ...sources], resourceEntries: [], modulesWithCode: [APP], moduleDirs: [APP] }, SEGS, { androidApi: api });
  expect(sim.complete).toBe(true);
  return sim.coupes;
};
const retire = (cuts: Awaited<ReturnType<typeof coupes>>, file: string, text: string) =>
  cuts.some(c => c.path === file && c.extrait.includes(text));

describe('G74, une methode vide encore appelee', () => {
  it('temoin : le corpus est juge, le canari part et la methode appelee reste', async () => {
    const cuts = await coupes(player(), screen('player.onFullscreenDone()'));
    expect(retire(cuts, PLAYER_PATH, 'neverCalled')).toBe(true);
    expect(retire(cuts, PLAYER_PATH, 'void start()')).toBe(false);
  });

  it('temoin : sans son appel, la methode vide part deja', async () => {
    expect(retire(await coupes(player(), screen()), PLAYER_PATH, 'onFullscreenDone')).toBe(true);
  });

  it.fails('appelee depuis Kotlin sur une propriete de ce type : la methode et son appel partent', async () => {
    const cuts = await coupes(player(), screen('player.onFullscreenDone()'));
    expect(retire(cuts, PLAYER_PATH, 'onFullscreenDone')).toBe(true);
    expect(retire(cuts, SCREEN_PATH, 'player.onFullscreenDone()')).toBe(true);
  });

  it.fails('appelee depuis Java sur un champ de ce type : la methode et son appel partent', async () => {
    const cuts = await coupes(player(), screen(), javaCaller);
    expect(retire(cuts, PLAYER_PATH, 'onFullscreenDone')).toBe(true);
    expect(retire(cuts, javaCaller.path, 'player.onFullscreenDone();')).toBe(true);
  });
});

describe('G74, ce qui doit rester', () => {
  it('une methode qui fait encore quelque chose', async () => {
    const cuts = await coupes(player({ body: ['System.out.println("done");'] }), screen('player.onFullscreenDone()'));
    expect(retire(cuts, PLAYER_PATH, 'neverCalled')).toBe(true);
    expect(retire(cuts, PLAYER_PATH, 'onFullscreenDone')).toBe(false);
    expect(retire(cuts, SCREEN_PATH, 'onFullscreenDone')).toBe(false);
  });

  it('l appel du meme nom sur une autre classe, dont la methode travaille', async () => {
    const cuts = await coupes(player(), RECORDER, screen('player.onFullscreenDone()', 'Recorder().onFullscreenDone()'));
    expect(retire(cuts, PLAYER_PATH, 'neverCalled')).toBe(true);
    expect(retire(cuts, RECORDER_PATH, 'onFullscreenDone')).toBe(false);
    expect(retire(cuts, SCREEN_PATH, 'Recorder().onFullscreenDone()')).toBe(false);
  });

  it('l appel dont le receveur fait un travail', async () => {
    // Dropping the statement would also drop whatever building the receiver does.
    const cuts = await coupes(player(), screen('Player().onFullscreenDone()'));
    expect(retire(cuts, PLAYER_PATH, 'neverCalled')).toBe(true);
    expect(retire(cuts, SCREEN_PATH, 'Player().onFullscreenDone()')).toBe(false);
  });

  it('la surcharge vide qu une interface exige encore', async () => {
    // Another file sees the class as a `Listener`: the override cannot go alone.
    const cuts = await coupes(player({ override: true }), LISTENER,
      screen('val listener: Listener = player', 'listener.onFullscreenDone()'));
    expect(retire(cuts, PLAYER_PATH, 'neverCalled')).toBe(true);
    expect(retire(cuts, PLAYER_PATH, 'onFullscreenDone')).toBe(false);
    expect(retire(cuts, LISTENER.path, 'onFullscreenDone')).toBe(false);
  });
});
