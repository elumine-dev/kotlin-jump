import { describe, it, expect } from 'vitest';
import { findUnusedContracts } from '../../../src/providers/unusedContracts';
import { explainMembers, findUnusedMembers } from '../../../src/providers/unusedMembers';
import { androidApi } from '../../../src/util/androidApi';

/**
 * G66 — un supertype imbrique que la chaine d ancetres ne retrouvait pas.
 *
 * Audit de dix fichiers du projet de reference, 2026-10-21 :
 * `CirclePageWithMarginIndicator extends View implements OnPageChangeListener`,
 * avec `import com.example.view.ViewPagerWithMargin.OnPageChangeListener`.
 * `setCentered` n a ni appelant ni homonyme dans tout le depot, et sortait
 * pourtant `M4:F7:View` : la chaine n etait pas visible, donc G63 ne pouvait
 * pas lever M4.
 *
 * La cause : un type imbrique etait range sous `paquet.Inner`, alors que son
 * nom complet, celui qu on importe, est `paquet.Outer.Inner`. L import ne
 * correspondait jamais, et le maillon passait pour etranger. Meme defaut sous
 * la forme qualifiee `implements ViewPagerWithMargin.OnPageChangeListener`,
 * qui cherchait un type nomme litteralement « ViewPagerWithMargin.OnPage... ».
 * La famille des contrats (G44) batissait ses types avec la meme formule.
 */

const SEGS = ['test/java'];
const API = androidApi({
  level: 'test',
  names: ['onDraw', 'onMeasure', 'setAlpha', 'toString'],
  types: {
    'java.lang.Object': [null, [], [3]],
    'android.view.View': ['java.lang.Object', [], [0, 1, 2]],
  },
});
const src = (path: string, ...lines: string[]) => ({ path: `/w/app/src/main/java/${path}`, text: lines.join('\n') + '\n' });

const PAGER = src('com/example/view/ViewPagerWithMargin.java',
  'package com.example.view;',
  '',
  'public class ViewPagerWithMargin {',
  '\tpublic interface OnPageChangeListener {',
  '\t\tvoid onPageSelected(int position);',
  '\t}',
  '}',
);

const indicateur = (entete: string, imp: string) => src('com/x/CirclePageWithMarginIndicator.java',
  'package com.x;',
  '',
  'import android.view.View;',
  imp,
  '',
  `public class CirclePageWithMarginIndicator extends View implements ${entete} {`,
  '\t@Override',
  '\tpublic void onPageSelected(int position) {',
  '\t}',
  '',
  '\tpublic void setCentered(boolean centered) {',
  '\t\tsetAlpha(1);',
  '\t}',
  '}',
);

const IMPORTEE = indicateur('OnPageChangeListener', 'import com.example.view.ViewPagerWithMargin.OnPageChangeListener;');
const QUALIFIEE = indicateur('ViewPagerWithMargin.OnPageChangeListener', 'import com.example.view.ViewPagerWithMargin;');

const MAIN = src('com/x/Main.java',
  'package com.x;',
  '',
  'class Main {',
  '\tObject m() { return new CirclePageWithMarginIndicator(); }',
  '}',
);

const morts = (...sources: { path: string; text: string }[]) =>
  findUnusedMembers({ sources, testSourceSets: SEGS, androidApi: API } as any).filter(m => m.verdict === 'unreferenced').map(m => m.name);
const pourquoi = (nom: string, ...sources: { path: string; text: string }[]) =>
  (explainMembers({ sources, testSourceSets: SEGS, androidApi: API } as any) as any[]).find(r => r.name === nom);

describe('G66 — un supertype imbrique', () => {
  it('importe par son nom complet Outer.Inner', () => {
    expect(morts(IMPORTEE, PAGER, MAIN)).toContain('setCentered');
    expect(pourquoi('setCentered', IMPORTEE, PAGER, MAIN)).toMatchObject({ outcome: 'unreferenced' });
  });

  it('ecrit sous la forme qualifiee Outer.Inner', () => {
    expect(morts(QUALIFIEE, PAGER, MAIN)).toContain('setCentered');
  });
});

describe('G66 — ce qui reste garde', () => {
  it('la surcharge d une methode de l interface imbriquee', () => {
    expect(morts(IMPORTEE, PAGER, MAIN)).not.toContain('onPageSelected');
  });

  it('une interface imbriquee que l interface declare aussi sous ce nom', () => {
    const pager = src('com/example/view/ViewPagerWithMargin.java',
      'package com.example.view;',
      '',
      'public class ViewPagerWithMargin {',
      '\tpublic interface OnPageChangeListener {',
      '\t\tvoid onPageSelected(int position);',
      '',
      '\t\tvoid setCentered(boolean centered);',
      '\t}',
      '}',
    );
    expect(morts(IMPORTEE, pager, MAIN)).not.toContain('setCentered');
  });

  it('temoin : un import qui ne correspond a aucun type du corpus reste etranger', () => {
    const ailleurs = indicateur('OnPageChangeListener', 'import androidx.viewpager.widget.ViewPager.OnPageChangeListener;');
    expect(morts(ailleurs, PAGER, MAIN)).not.toContain('setCentered');
  });
});

/** La famille des contrats (G44) batissait ses types avec la meme formule. */
describe('G66 — un contrat porte par une interface imbriquee', () => {
  const SERVICES = src('p/Services.java',
    'package p;',
    '',
    'public class Services {',
    '\tpublic interface SystemInfoService {',
    '\t\tboolean isChargerConnected();',
    '',
    '\t\tlong getCurrentMemoryUsage();',
    '\t}',
    '}',
  );
  const IMPL = src('q/SystemInfoServiceImpl.java',
    'package q;',
    '',
    'import p.Services.SystemInfoService;',
    '',
    'public class SystemInfoServiceImpl implements SystemInfoService {',
    '\t@Override',
    '\tpublic boolean isChargerConnected() { return true; }',
    '',
    '\t@Override',
    '\tpublic long getCurrentMemoryUsage() { return 42L; }',
    '}',
  );
  const CALLER = src('q/Caller.java',
    'package q;',
    '',
    'import p.Services.SystemInfoService;',
    '',
    'public class Caller {',
    '\tpublic static void main(String[] args) {',
    '\t\tSystemInfoService s = new SystemInfoServiceImpl();',
    '\t\tSystem.out.println(s.isChargerConnected());',
    '\t}',
    '}',
  );
  const trouves = (...sources: { path: string; text: string }[]) =>
    (findUnusedContracts({ sources, testSourceSets: SEGS }) as any[]).map(c => `${c.interfaceName}.${c.name}`);

  it('rapporte la methode d interface que personne n appelle', () => {
    expect(trouves(SERVICES, IMPL, CALLER)).toContain('SystemInfoService.getCurrentMemoryUsage');
  });

  it('et garde celle qui est appelee', () => {
    expect(trouves(SERVICES, IMPL, CALLER)).not.toContain('SystemInfoService.isChargerConnected');
  });
});
