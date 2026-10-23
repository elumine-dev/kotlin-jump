import { describe, it, expect } from 'vitest';
import { findUnusedContracts } from '../../../src/providers/unusedContracts';
import { findUnusedSymbols, explainSymbols } from '../../../src/providers/unusedSymbols';
import { findUnusedMembers, explainMembers } from '../../../src/providers/unusedMembers';

/**
 * G64 — une annotation de marquage tenait du code mort en vie.
 *
 * Audit de dix fichiers du projet de reference apres cette revue,
 * 2026-10-21. Trois marqueurs ne creent aucun appel et gardaient pourtant
 * tout ce qu ils touchent :
 *
 *   `@UnstableApi` (media3)    `ExoUtil` entiere, morte depuis longtemps :
 *                              F5 sur la classe, M4 sur ses 19 membres
 *   `@OpenClassForTest`        quatre methodes mortes d `AppLifecycleObserver`,
 *                              M4 sur ses 16 membres
 *   `@Nullable`                `EditionModel.findPageExternalUid`,
 *                              `SectionDO.getPageExternalUid` (M6)
 *
 * `@UnstableApi` est un marqueur `@RequiresOptIn` : il dit que l API peut
 * changer, rien sur qui l appelle. G29 l avait deja range parmi les cautions
 * illegitimes. `@OpenClassForTest` est consomme par le plugin Kotlin
 * `allOpen`, qui retire `final` a la compilation pour qu un test puisse
 * moquer la classe ; il n ajoute aucune reference. Une annotation de
 * nullabilite parle au compilateur et aux outils d analyse.
 *
 * La regle ne code en dur que les noms de bibliotheque connus. Les marqueurs
 * du projet se lisent dans le projet : un bloc `allOpen { annotation(...) }`
 * ou `noArg { ... }` d un build Gradle, ou une declaration d annotation qui
 * porte `@RequiresOptIn`.
 */

const MAIN = '/w/app/src/main/java/com/x';
const f = (path: string, text: string) => ({ path, text });
const SEGS = ['/src/test/'];

const symboles = (...sources: { path: string; text: string }[]) =>
  findUnusedSymbols({ sources, testSourceSets: SEGS }).map(s => s.name);
const pourquoiSymbole = (nom: string, ...sources: { path: string; text: string }[]) =>
  (explainSymbols({ sources, testSourceSets: SEGS }) as any[]).find(s => s.name === nom);
const membres = (...sources: { path: string; text: string }[]) =>
  findUnusedMembers({ sources, testSourceSets: SEGS } as any).filter(m => m.verdict === 'unreferenced').map(m => m.name);
const pourquoiMembre = (nom: string, ...sources: { path: string; text: string }[]) =>
  (explainMembers({ sources, testSourceSets: SEGS } as any) as any[]).find(r => r.name === nom);

const CANARI = f(`${MAIN}/CanaryGone.kt`, 'package com.x\n\nclass CanaryGone\n');

/** `ExoUtil.kt`, reduit. */
const EXO = f(`${MAIN}/ExoUtil.kt`, [
  'package com.x',
  '',
  'import androidx.media3.common.util.UnstableApi',
  '',
  '@UnstableApi',
  'class ExoUtil {',
  '    fun play() = Unit',
  '}',
  '',
].join('\n'));

/** `AppLifecycleObserver.kt`, reduit : une methode vivante, une morte. */
const OBSERVER = f(`${MAIN}/AppLifecycleObserver.kt`, [
  'package com.x',
  '',
  'import com.x.annotation.OpenClassForTest',
  '',
  '@OpenClassForTest',
  'class AppLifecycleObserver {',
  '    fun isMainActivityVisible(): Boolean = true',
  '',
  '    fun isMainActivityActive(): Boolean = false',
  '}',
  '',
].join('\n'));

const UTILISATEUR = f(`${MAIN}/Use.kt`, [
  'package com.x',
  '',
  'fun go(o: AppLifecycleObserver) = o.isMainActivityVisible()',
  '',
].join('\n'));

const ALL_OPEN_KTS = f('/w/app/build.gradle.kts', [
  'plugins {',
  '    id("kotlin-allopen")',
  '}',
  '',
  'allOpen {',
  '    annotation("com.x.annotation.OpenClassForTest")',
  '}',
  '',
].join('\n'));

const MODELE = f(`${MAIN}/EditionModel.java`, [
  'package com.x;',
  '',
  'import androidx.annotation.Nullable;',
  '',
  'public class EditionModel {',
  '\tpublic String getEditionUid() { return "u"; }',
  '',
  '\t@Nullable',
  '\tpublic String findPageExternalUid(String uid) { return null; }',
  '}',
  '',
].join('\n'));

const LECTEUR = f(`${MAIN}/Reader.java`, [
  'package com.x;',
  '',
  'class Reader {',
  '\tString read(EditionModel m) { return m.getEditionUid(); }',
  '}',
  '',
].join('\n'));

describe('G64 — un marqueur ne garde plus rien', () => {
  it('une classe @UnstableApi que rien ne nomme', () => {
    expect(symboles(EXO, CANARI)).toContain('ExoUtil');
    expect(pourquoiSymbole('ExoUtil', EXO, CANARI)).toMatchObject({ outcome: 'unreferenced' });
  });

  it('les membres d une classe @UnstableApi sont juges', () => {
    const vivante = f(`${MAIN}/Host.kt`, 'package com.x\n\nfun host() = ExoUtil()\n');
    expect(membres(EXO, vivante)).toContain('play');
  });

  it('une annotation que le projet donne au plugin allOpen', () => {
    expect(membres(OBSERVER, UTILISATEUR, ALL_OPEN_KTS)).toContain('isMainActivityActive');
    expect(membres(OBSERVER, UTILISATEUR, ALL_OPEN_KTS)).not.toContain('isMainActivityVisible');
  });

  it('la meme en Groovy, et sous noArg', () => {
    const groovy = f('/w/app/build.gradle', "apply plugin: 'kotlin-allopen'\n\nallOpen {\n    annotation 'com.x.annotation.OpenClassForTest'\n}\n");
    expect(membres(OBSERVER, UTILISATEUR, groovy)).toContain('isMainActivityActive');
    const noArg = f('/w/app/build.gradle.kts', 'noArg {\n    annotations("com.x.annotation.OpenClassForTest", "com.x.Other")\n}\n');
    expect(membres(OBSERVER, UTILISATEUR, noArg)).toContain('isMainActivityActive');
  });

  it('un marqueur @RequiresOptIn que le projet declare', () => {
    const marqueur = f(`${MAIN}/InternalApi.kt`, [
      'package com.x',
      '',
      '@RequiresOptIn(level = RequiresOptIn.Level.WARNING)',
      '@Retention(AnnotationRetention.BINARY)',
      'annotation class InternalApi',
      '',
    ].join('\n'));
    const marque = f(`${MAIN}/Marked.kt`, 'package com.x\n\n@InternalApi\nclass Marked\n');
    expect(symboles(marqueur, marque, CANARI)).toContain('Marked');
  });

  it('une methode @Nullable que personne n appelle', () => {
    expect(membres(MODELE, LECTEUR)).toContain('findPageExternalUid');
    expect(pourquoiMembre('findPageExternalUid', MODELE, LECTEUR)).toMatchObject({ outcome: 'unreferenced' });
  });
});

describe('G64 — ce qui reste garde', () => {
  it('temoin : sans bloc allOpen, la meme annotation reste etrangere', () => {
    expect(membres(OBSERVER, UTILISATEUR)).not.toContain('isMainActivityActive');
    expect(pourquoiMembre('isMainActivityActive', OBSERVER, UTILISATEUR))
      .toMatchObject({ outcome: 'M4:@OpenClassForTest' });
  });

  it('un bloc allOpen ne blanchit que ce qu il nomme', () => {
    const autre = f('/w/app/build.gradle.kts', 'allOpen {\n    annotation("com.x.annotation.Other")\n}\n');
    expect(membres(OBSERVER, UTILISATEUR, autre)).not.toContain('isMainActivityActive');
  });

  it('une annotation qui ne porte pas @RequiresOptIn reste etrangere', () => {
    const qualif = f(`${MAIN}/Qualif.kt`, 'package com.x\n\n@Retention(AnnotationRetention.RUNTIME)\nannotation class Qualif\n');
    const marque = f(`${MAIN}/Marked.kt`, 'package com.x\n\n@Qualif\nclass Marked\n');
    expect(symboles(qualif, marque, CANARI)).not.toContain('Marked');
  });

  it('@Keep et @Subscribe gardent toujours', () => {
    const keep = f(`${MAIN}/Kept.kt`, 'package com.x\n\nimport androidx.annotation.Keep\n\n@Keep\nclass Kept\n');
    expect(symboles(keep, CANARI)).not.toContain('Kept');
    const bus = f(`${MAIN}/Bus.java`, [
      'package com.x;',
      '',
      'public class Bus {',
      '\tpublic String getEditionUid() { return "u"; }',
      '',
      '\t@Subscribe',
      '\tpublic void onBusEvent(Object e) { }',
      '}',
      '',
    ].join('\n'));
    const lit = f(`${MAIN}/R2.java`, 'package com.x;\n\nclass R2 {\n\tString r(Bus b) { return b.getEditionUid(); }\n}\n');
    expect(membres(bus, lit)).not.toContain('onBusEvent');
  });

  it('une methode @Nullable appelee', () => {
    const appel = f(`${MAIN}/Caller.java`, 'package com.x;\n\nclass Caller {\n\tString c(EditionModel m) { return m.findPageExternalUid("x"); }\n}\n');
    expect(membres(MODELE, LECTEUR, appel)).not.toContain('findPageExternalUid');
  });
});

/** `AppLifecycleObserver.addMainActivityLifecycleDetectorListener` porte `@UiThread`. */
describe('G64 — une annotation de fil', () => {
  it('@UiThread ne garde pas une methode que personne n appelle', () => {
    const obs = f(`${MAIN}/Obs.kt`, [
      'package com.x',
      '',
      'import androidx.annotation.UiThread',
      '',
      'class Obs {',
      '    fun visible(): Boolean = true',
      '',
      '    @UiThread',
      '    fun addListener(l: Any) = Unit',
      '}',
      '',
    ].join('\n'));
    const use = f(`${MAIN}/U.kt`, 'package com.x\n\nfun u(o: Obs) = o.visible()\n');
    expect(membres(obs, use)).toContain('addListener');
  });
});

/** La famille des contrats (G44) lit les memes annotations neutres. */
describe('G64 — un contrat dont l implementation porte @OpenClassForTest', () => {
  const SERVICE = f(`${MAIN}/Lifecycle.kt`, [
    'package com.x',
    '',
    'interface Lifecycle {',
    '    fun isVisible(): Boolean',
    '',
    '    fun isFromContextVisible(): Boolean',
    '}',
    '',
  ].join('\n'));
  const IMPL = f(`${MAIN}/Observer.kt`, [
    'package com.x',
    '',
    'import com.x.annotation.OpenClassForTest',
    '',
    '@OpenClassForTest',
    'class Observer : Lifecycle {',
    '    override fun isVisible(): Boolean = true',
    '',
    '    override fun isFromContextVisible(): Boolean = false',
    '}',
    '',
  ].join('\n'));
  const USE = f(`${MAIN}/Use2.kt`, 'package com.x\n\nfun main() {\n    val l: Lifecycle = Observer()\n    println(l.isVisible())\n}\n');
  const trouves = (...sources: { path: string; text: string }[]) =>
    (findUnusedContracts({ sources, testSourceSets: SEGS }) as any[]).map(c => `${c.interfaceName}.${c.name}`);

  it('avec le bloc allOpen, le contrat mort est rapporte', () => {
    expect(trouves(SERVICE, IMPL, USE, ALL_OPEN_KTS)).toContain('Lifecycle.isFromContextVisible');
  });

  it('sans lui, l annotation reste etrangere', () => {
    expect(trouves(SERVICE, IMPL, USE)).not.toContain('Lifecycle.isFromContextVisible');
  });
});
