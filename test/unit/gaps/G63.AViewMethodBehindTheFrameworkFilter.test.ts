import { describe, it, expect } from 'vitest';
import { explainMembers, findUnusedMembers } from '../../../src/providers/unusedMembers';
import { androidApi, AndroidApiIndex } from '../../../src/util/androidApi';

/**
 * G63 — une methode de vue que G61 savait juger, et que M4 ne lui laissait pas.
 *
 * Trouve par la meme revue humaine que G62 (meme PR) :
 * `EditionContainer.stopBlinkLiveButton()` n a aucun appelant. KJ la gardait
 * sous `M4:F7:ViewGroup`.
 *
 * G61 a appris aux membres a lire l index de `android.jar` : quand toute la
 * chaine d ancetres est connue (corpus ou plateforme) et qu aucun ancetre ne
 * declare le nom, aucune surcharge ne se cache, et le membre redescend dans
 * le comptage. Mais G61 ne levait que M3. M4 tombe AVANT : il ecarte tout
 * membre d une classe dont l ascendance touche un type de `F7`, et
 * `EditionContainer extends ViewGroup` y touche au premier etage. Le temoin
 * de G61 passait parce qu il prolonge `LinearLayout`, absent de `F7`.
 *
 * M4:F7 dit « le cadre appelle peut etre ce membre ». Le cadre n appelle un
 * membre qu a travers un type qu il connait : le sien. Quand l index prouve
 * que ni la plateforme ni le corpus ne declarent ce nom dans la chaine, le
 * cadre n a aucun contrat par lequel l atteindre. Les autres voies restent
 * couvertes ailleurs : `@Subscribe` et consorts par M6, un setter nomme en
 * chaine (`ObjectAnimator`) par M13, un attribut XML de data binding par H9
 * inverse.
 *
 * Sans index, ou avec un ancetre AndroidX inconnu de l index, rien ne change.
 */

const INDEX: AndroidApiIndex = {
  level: 'test',
  names: ['getVisibility', 'setAlpha', 'onLayout', 'onMeasure', 'toString', 'hashCode', 'onTrimMemory'],
  types: {
    'java.lang.Object': [null, [], [4, 5]],
    'android.view.View': ['java.lang.Object', [], [0, 1, 3]],
    'android.view.ViewGroup': ['android.view.View', [], [2]],
    'android.app.Service': ['java.lang.Object', [], [6]],
  },
};
const API = androidApi(INDEX);
const SEGS = ['test/java'];
const P = '/w/app/src/main/java/p';
const src = (path: string, ...lines: string[]) => ({ path: `${P}/${path}`, text: lines.join('\n') + '\n' });

const PRESENTER = src('LiveSpotlightPresenter.java',
  'package p;',
  '',
  'public interface LiveSpotlightPresenter {',
  '\tvoid showLiveSpotlight();',
  '}',
);

/** `EditionContainer.java`, reduit a ce qui compte. */
const container = (extra: string[] = [], base = 'ViewGroup', imp = 'android.view.ViewGroup') => src('EditionContainer.java',
  'package p;',
  '',
  'import android.content.Context;',
  `import ${imp};`,
  '',
  `public class EditionContainer extends ${base} implements LiveSpotlightPresenter {`,
  '\tpublic EditionContainer(Context c) { super(c); }',
  '',
  '\t@Override',
  '\tprotected void onLayout(boolean changed, int l, int t, int r, int b) {',
  '\t}',
  '',
  '\t@Override',
  '\tpublic void showLiveSpotlight() {',
  '\t\tsetAlpha(1);',
  '\t}',
  '',
  '\tpublic void stopBlinkLiveButton() {',
  '\t\tsetAlpha(0);',
  '\t}',
  ...extra,
  '}',
);

const MAIN = src('Main.java',
  'package p;',
  '',
  'public class Main {',
  '\tpublic static void main(String[] a) {',
  '\t\tLiveSpotlightPresenter p = new EditionContainer(null);',
  '\t\tp.showLiveSpotlight();',
  '\t}',
  '}',
);

// `null` says « no index »: `undefined` would fall back to the default.
const morts = (sources: { path: string; text: string }[], api: typeof API | null = API) =>
  findUnusedMembers({ sources, testSourceSets: SEGS, androidApi: api ?? undefined } as any)
    .filter(m => m.verdict === 'unreferenced').map(m => m.name);

const pourquoi = (nom: string, sources: { path: string; text: string }[], api: typeof API | null = API) =>
  (explainMembers({ sources, testSourceSets: SEGS, androidApi: api ?? undefined } as any) as any[])
    .find(r => r.name === nom);

describe('G63 — une methode de vue derriere M4:F7', () => {
  it('rapporte la methode d un ViewGroup que personne n appelle', () => {
    expect(morts([container(), PRESENTER, MAIN])).toContain('stopBlinkLiveButton');
  });

  it('et celle d une View directe', () => {
    expect(morts([container([], 'View', 'android.view.View'), PRESENTER, MAIN])).toContain('stopBlinkLiveButton');
  });

  it('explain dit pareil que find', () => {
    expect(pourquoi('stopBlinkLiveButton', [container(), PRESENTER, MAIN]))
      .toMatchObject({ outcome: 'unreferenced' });
  });

  it('un Service de la plateforme suit la meme regle', () => {
    const service = src('SyncService.java',
      'package p;',
      '',
      'import android.app.Service;',
      '',
      'public class SyncService extends Service {',
      '\t@Override',
      '\tpublic void onTrimMemory(int level) {}',
      '',
      '\tpublic void neverCalled() {}',
      '}',
    );
    expect(morts([service, MAIN])).toContain('neverCalled');
  });
});

describe('G63 — ce qui reste garde', () => {
  it('temoin : sans index, la reponse prudente d avant', () => {
    expect(morts([container(), PRESENTER, MAIN], null)).not.toContain('stopBlinkLiveButton');
    expect(pourquoi('stopBlinkLiveButton', [container(), PRESENTER, MAIN], null))
      .toMatchObject({ outcome: 'M4:F7:ViewGroup' });
  });

  it('une methode appelee', () => {
    const appel = src('Caller.java', 'package p;', '', 'class Caller {', '\tvoid go(EditionContainer c) { c.stopBlinkLiveButton(); }', '}');
    expect(morts([container(), PRESENTER, MAIN, appel])).not.toContain('stopBlinkLiveButton');
  });

  it('une surcharge que la plateforme declare, meme sans @Override', () => {
    const v = container(['', '\tprotected void onMeasure(int w, int h) {', '\t}']);
    expect(morts([v, PRESENTER, MAIN])).not.toContain('onMeasure');
  });

  it('une methode d un contrat du corpus', () => {
    expect(morts([container(), PRESENTER, MAIN])).not.toContain('showLiveSpotlight');
  });

  it('un ancetre que l index ne connait pas (AndroidX)', () => {
    const v = container([], 'RecyclerView', 'androidx.recyclerview.widget.RecyclerView');
    expect(morts([v, PRESENTER, MAIN])).not.toContain('stopBlinkLiveButton');
  });

  it('un setter qu ObjectAnimator nomme en chaine', () => {
    const v = container(['', '\tpublic void setCellAlpha(float a) {', '\t\tsetAlpha(0);', '\t}']);
    const anim = src('Anim.java', 'package p;', '', 'class Anim {', '\tvoid go(Object v) { android.animation.ObjectAnimator.ofFloat(v, "cellAlpha", 1f); }', '}');
    expect(morts([v, PRESENTER, MAIN])).toContain('setCellAlpha');
    expect(morts([v, PRESENTER, MAIN, anim])).not.toContain('setCellAlpha');
  });

  it('un setter qu un attribut de data binding nomme', () => {
    const v = container(['', '\tpublic void setLabelText(String s) {', '\t}']);
    const layout = { path: '/w/app/src/main/res/layout/edition.xml', text: [
      '<layout xmlns:app="http://schemas.android.com/apk/res-auto">',
      '    <p.EditionContainer app:labelText="@{vm.label}" />',
      '</layout>',
      '',
    ].join('\n') };
    expect(morts([v, PRESENTER, MAIN])).toContain('setLabelText');
    expect(morts([v, PRESENTER, MAIN, layout])).not.toContain('setLabelText');
  });

  /**
   * F6 n est pas F7. Sur le projet de reference, la premiere version levait aussi
   * `M4:F6:Serializable` et emportait `SectionDO.getBillingCode` : Jackson lit
   * les getters par leur nom. (Un `hasTitle`, que Jackson ne lit pas, est
   * l affaire de G65.)
   */
  it('un getter d un modele Serializable', () => {
    const modele = src('ObituaryModel.java',
      'package p;',
      '',
      'import java.io.Serializable;',
      '',
      'public class ObituaryModel implements Serializable {',
      '\tprivate String title;',
      '',
      '\tpublic String getTitle() {',
      '\t\treturn title;',
      '\t}',
      '}',
    );
    const api = androidApi({ ...INDEX, types: { ...INDEX.types, 'java.io.Serializable': [null, [], []] } });
    expect(morts([modele, MAIN], api)).not.toContain('getTitle');
    expect(pourquoi('getTitle', [modele, MAIN], api)).toMatchObject({ outcome: 'M4:F6:Serializable' });
  });

  /**
   * La porte du 2026-10-21 : deux surcharges Java d une vue changeaient
   * d etiquette (M4:F7 vers M3) et la famille des ilots, qui n absorbe que
   * F7, les perdait. Quand M3 garde de toute facon, M4:F7 reste l etiquette.
   */
  it('deux surcharges Java gardent l etiquette F7, celle que les ilots lisent', () => {
    const v = container([
      '',
      '\tpublic void setPageMarginDrawable(int resId) {',
      '\t}',
      '',
      '\tpublic void setPageMarginDrawable(Object d) {',
      '\t}',
    ]);
    expect(pourquoi('setPageMarginDrawable', [v, PRESENTER, MAIN]))
      .toMatchObject({ outcome: 'M4:F7:ViewGroup' });
  });

  it('une methode annotee qu un bus appelle', () => {
    const v = container(['', '\t@Subscribe', '\tpublic void onBusEvent(Object e) {', '\t}']);
    expect(morts([v, PRESENTER, MAIN])).not.toContain('onBusEvent');
  });
});
