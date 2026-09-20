import { describe, it, expect } from 'vitest';
import { importOrNull } from './harness';

/**
 * KJ-071 — un fichier de ressource qui declare un id que quelqu un lit encore.
 *
 * Supprimer un layout emporte les `@+id/foo` qu il declare, et chaque
 * `R.id.foo` survivant cesse de resoudre : javac repond « cannot find symbol,
 * location: class id ». Vu sur le projet de reference le jour ou un
 * controleur mort a libere son layout de panneau, pendant que la VUE du
 * panneau, vivante, lisait encore deux ids de ce layout.
 *
 * Le trou etait la depuis toujours : la famille demandait qui reference
 * `R.layout.x`, jamais qui lit les ids que x declare. Il a fallu qu une autre
 * regle rende le layout supprimable pour qu il se voie.
 */

const mod: any = await importOrNull('src/providers/UnusedResourceProvider');

const APP = '/w/app';
const f = (path: string, text: string) => ({ path, text });

const entree = (name: string, path: string) => ({
  kind: 'layout',
  name,
  variants: [{ path, moduleDir: APP }],
});

const scan = (sources: { path: string; text: string }[], entries: any[]) =>
  (mod.findUnusedResources({
    sources, entries, modulesWithCode: [APP], libraryModules: [],
  }) as any[]).map(r => r.name);

const LAYOUT = f(`${APP}/src/main/res/layout/widget_panel.xml`, [
  '<LinearLayout xmlns:android="http://schemas.android.com/apk/res/android">',
  '    <TextView android:id="@+id/panelTimer_web" />',
  '    <TextView android:id="@+id/panelTimer_fullscreen" />',
  '</LinearLayout>',
  '',
].join('\n'));

describe.skipIf(!mod)('un layout que plus personne n inflate', () => {
  it('reste quand du code vivant lit un de ses ids', () => {
    const vue = f(`${APP}/src/main/java/com/x/PanelView.java`, [
      'package com.x;',
      '',
      'public class PanelView {',
      '    void bind() {',
      '        find(R.id.panelTimer_web);',
      '    }',
      '}',
      '',
    ].join('\n'));
    expect(scan([LAYOUT, vue], [entree('widget_panel', LAYOUT.path)])).toEqual([]);
  });

  it('part quand plus personne ne lit ses ids', () => {
    const autre = f(`${APP}/src/main/java/com/x/Autre.java`,
      'package com.x;\n\npublic class Autre {\n    int n = 1;\n}\n');
    expect(scan([LAYOUT, autre], [entree('widget_panel', LAYOUT.path)])).toEqual(['widget_panel']);
  });

  it('un id lu seulement par le layout lui meme ne le sauve pas', () => {
    // Une contrainte interne s en va avec le fichier.
    const seul = f(`${APP}/src/main/res/layout/widget_seul.xml`, [
      '<ConstraintLayout xmlns:app="http://schemas.android.com/apk/res-auto">',
      '    <TextView android:id="@+id/haut" />',
      '    <TextView app:layout_constraintTop_toBottomOf="@id/haut" />',
      '</ConstraintLayout>',
      '',
    ].join('\n'));
    expect(scan([seul], [entree('widget_seul', seul.path)])).toEqual(['widget_seul']);
  });

  it('un autre layout qui pointe vers l id le garde', () => {
    const voisin = f(`${APP}/src/main/res/layout/voisin.xml`,
      '<merge xmlns:app="http://schemas.android.com/apk/res-auto">\n'
      + '    <View app:layout_constraintTop_toBottomOf="@id/panelTimer_web" />\n</merge>\n');
    expect(scan([LAYOUT, voisin], [entree('widget_panel', LAYOUT.path)]))
      .not.toContain('widget_panel');
  });

  it('la forme ButterKnife R2.id compte aussi', () => {
    const vue = f(`${APP}/src/main/java/com/x/PanelView.java`,
      'package com.x;\n\npublic class PanelView {\n    int id = R2.id.panelTimer_fullscreen;\n}\n');
    expect(scan([LAYOUT, vue], [entree('widget_panel', LAYOUT.path)])).toEqual([]);
  });
});
