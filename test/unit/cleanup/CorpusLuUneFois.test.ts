import { describe, it, expect } from 'vitest';
import { findUnusedSymbols, explainSymbols, readSymbolCorpus } from '../../../src/providers/unusedSymbols';
import { findUnusedMembers, explainMembers, readMemberCorpus } from '../../../src/providers/unusedMembers';
import { findDeadIslands } from '../../../src/providers/deadIslands';
import { androidApi } from '../../../src/util/androidApi';

/**
 * Une passe lit les candidats et leurs mentions une fois, puis les remet aux
 * deux scans et aux ilots, qui refaisaient chacun cette lecture. Le remettre
 * ne doit changer aucun verdict, et un corpus lu ailleurs ne doit jamais etre
 * cru : il ferait couper du code vivant.
 */

const SEGS = ['/src/test/'];
const MAIN = '/w/app/src/main/kotlin/com/x';
const f = (name: string, text: string) => ({ path: `${MAIN}/${name}`, text });

// Une trouvaille par famille : une fonction morte, un membre mort, une paire mutuelle.
const SOURCES = [
  f('Dead.kt', 'package com.x\n\nfun deadAlone() {\n    println("x")\n}\n'),
  f('Holder.kt', 'package com.x\n\nclass Holder {\n    fun unusedMember() {\n        println("x")\n    }\n}\n'),
  f('Use.kt', 'package com.x\n\nfun main() {\n    Holder()\n}\n'),
  f('LegacySync.kt', 'package com.x\n\nfun legacySync() {\n    uploaderSend()\n}\n'),
  f('Uploader.kt', 'package com.x\n\nfun uploaderSend() {\n    legacySync()\n}\n'),
];
const OTHER = [f('Other.kt', 'package com.x\n\nfun somethingElse() {\n    println("x")\n}\n')];
const sur = (sources: typeof SOURCES) => ({ sources, testSourceSets: SEGS });

describe('le corpus lu une fois', () => {
  const symbols = readSymbolCorpus(SOURCES, SEGS);
  const members = readMemberCorpus(SOURCES, SEGS);

  it('temoin : chaque famille trouve quelque chose dans ce corpus', () => {
    expect(findUnusedSymbols(sur(SOURCES)).map(s => s.name)).toContain('deadAlone');
    expect(findUnusedMembers(sur(SOURCES)).map(m => m.name)).toContain('unusedMember');
    expect(findDeadIslands(sur(SOURCES)).map(i => i.members.map(m => m.name).sort())).toContainEqual(['legacySync', 'uploaderSend']);
  });

  it('remis aux scans et aux ilots, il ne change aucun verdict', () => {
    expect(findUnusedSymbols(sur(SOURCES), symbols)).toEqual(findUnusedSymbols(sur(SOURCES)));
    expect(explainSymbols(sur(SOURCES), symbols)).toEqual(explainSymbols(sur(SOURCES)));
    expect(findUnusedMembers(sur(SOURCES), members)).toEqual(findUnusedMembers(sur(SOURCES)));
    expect(explainMembers(sur(SOURCES), members)).toEqual(explainMembers(sur(SOURCES)));
    expect(findDeadIslands(sur(SOURCES), { symbols, members })).toEqual(findDeadIslands(sur(SOURCES)));
  });

  // Une copie videe le prouve : ce qui est remis est ce qui est lu, rien n est collecte a nouveau.
  it('remis, il remplace la collecte', () => {
    const vide = { ...symbols, collected: { ...symbols.collected, candidates: [] } };
    const videMembres = { ...members, collected: { ...members.collected, candidates: [] } };
    expect(findUnusedSymbols(sur(SOURCES), vide)).toEqual([]);
    expect(explainSymbols(sur(SOURCES), vide)).toEqual([]);
    expect(findUnusedMembers(sur(SOURCES), videMembres)).toEqual([]);
    expect(explainMembers(sur(SOURCES), videMembres)).toEqual([]);
    expect(findDeadIslands(sur(SOURCES), { symbols: vide, members: videMembres })).toEqual([]);
  });

  it('lu sur d autres sources, il n est pas cru', () => {
    expect(findUnusedSymbols(sur(OTHER), symbols).map(s => s.name)).toEqual(['somethingElse']);
    expect(explainSymbols(sur(OTHER), symbols).map(s => s.name)).toEqual(['somethingElse']);
    expect(findUnusedMembers(sur(OTHER), members)).toEqual([]);
    expect(explainMembers(sur(OTHER), members)).toEqual([]);
  });

  it('lu avec d autres ensembles de test, il n est pas cru', () => {
    // Tout le corpus devient du test : plus aucun candidat.
    const toutEstTest = { sources: SOURCES, testSourceSets: ['/src/main/'] };
    expect(findUnusedSymbols(toutEstTest, symbols)).toEqual([]);
    expect(findUnusedMembers(toutEstTest, members)).toEqual([]);
  });
});

describe('le corpus des membres et l index de la plateforme', () => {
  const API = androidApi({
    level: 'test',
    names: ['setOrientation'],
    types: {
      'java.lang.Object': [null, [], []],
      'android.view.View': ['java.lang.Object', [], []],
      'android.view.ViewGroup': ['android.view.View', [], []],
      'android.widget.LinearLayout': ['android.view.ViewGroup', [], [0]],
    },
  });
  const JAVA = '/w/app/src/main/java/p';
  const VIEW = [
    { path: `${JAVA}/OverlayLayout.java`, text: [
      'package p;', '', 'import android.content.Context;', 'import android.widget.LinearLayout;', '',
      'public class OverlayLayout extends LinearLayout {',
      '\tpublic OverlayLayout(Context c) { super(c); }', '',
      '\tpublic void setOverlayColor(int color) {', '\t\tsetAlpha(color);', '\t}', '}', '',
    ].join('\n') },
    { path: `${JAVA}/Screen.java`, text: [
      'package p;', '', 'import android.app.Activity;', '',
      'public class Screen extends Activity {',
      '\t@Override', '\tprotected void onResume() {', '\t\tsuper.onResume();', '\t\tnew OverlayLayout(this);', '\t}', '}', '',
    ].join('\n') },
  ];
  const avecIndex = { sources: VIEW, testSourceSets: SEGS, androidApi: API };
  const sansIndex = { sources: VIEW, testSourceSets: SEGS };
  const noms = (liste: { name: string }[]) => liste.map(m => m.name);

  it('temoin : l index change le verdict du membre', () => {
    expect(noms(findUnusedMembers(avecIndex))).toContain('setOverlayColor');
    expect(noms(findUnusedMembers(sansIndex))).not.toContain('setOverlayColor');
  });

  it('lu sans l index, il n est pas cru par un scan qui en a un, et inversement', () => {
    expect(noms(findUnusedMembers(avecIndex, readMemberCorpus(VIEW, SEGS)))).toContain('setOverlayColor');
    expect(noms(findUnusedMembers(sansIndex, readMemberCorpus(VIEW, SEGS, API)))).not.toContain('setOverlayColor');
  });
});
