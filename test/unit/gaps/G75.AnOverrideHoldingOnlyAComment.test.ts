import { describe, it, expect } from 'vitest';
import { findIdleImplementations } from '../../../src/providers/idleImplementations';

/**
 * G75, une surcharge dont il ne reste qu un commentaire.
 *
 * La regle de l interface implementee pour rien (KJ-072) exige que chaque
 * surcharge soit vide, et lit le corps sur le texte brut : un commentaire y
 * compte comme du contenu. Vu sur le projet de reference : un menage retire
 * la derniere instruction d un rappel et laisse la ligne de commentaire qui
 * l expliquait. Le rappel ne fait plus rien, l ecouteur reste inscrit, et la
 * regle ne voit rien.
 *
 * Ce choix a une raison : un commentaire seul est parfois la reponse voulue
 * (« rien a faire ici »), et detekt ne tient pas ce bloc pour vide. La coupe
 * reste pourtant neutre a l execution, comme pour un corps vide. Ce fichier
 * decrit le cas, sans trancher lequel des deux a raison.
 */

type Source = { path: string; text: string };
const MAIN = '/w/app/src/main/java/com/x';

const grid = (name: string, body: string[]): Source => ({
  path: `${MAIN}/${name}.java`,
  text: [
    'package com.x;', '',
    'import android.widget.AbsListView;', '',
    `public class ${name} extends Base implements AbsListView.OnScrollListener {`, '',
    '\tprivate AbsListView gridView;', '',
    '\tvoid setUp() {', '\t\tgridView.setOnScrollListener(this);', '\t}', '',
    '\t@Override',
    '\tpublic void onScrollStateChanged(final AbsListView absListView, final int state) {',
    ...body.map(l => `\t\t${l}`), '\t}', '',
    '\t@Override',
    '\tpublic void onScroll(final AbsListView absListView, final int i, final int j, final int k) {',
    ...body.map(l => `\t\t${l}`), '\t}', '}', '',
  ].join('\n'),
});

const trouvees = (...sources: Source[]) =>
  findIdleImplementations({ sources, testSourceSets: ['/src/test/'] }).map(t => t.className).sort();

/** The canary: an implementation whose overrides are plainly empty. */
const EMPTY = grid('EmptyGrid', []);

describe('G75, une surcharge reduite a un commentaire', () => {
  it('temoin : deux surcharges vides, l implementation est rapportee', () => {
    expect(trouvees(EMPTY)).toEqual(['EmptyGrid']);
  });

  it.fails('un commentaire de ligne seul dans chaque surcharge', () => {
    expect(trouvees(grid('Grid', ['// nothing left to do here']))).toEqual(['Grid']);
  });

  it.fails('un commentaire de bloc seul dans chaque surcharge', () => {
    expect(trouvees(grid('Grid', ['/* nothing left to do here */']))).toEqual(['Grid']);
  });
});

describe('G75, ce qui doit rester', () => {
  it('une surcharge qui garde une instruction sous son commentaire', () => {
    expect(trouvees(EMPTY, grid('Grid', ['// keeps the header in place', 'gridView.invalidate();']))).toEqual(['EmptyGrid']);
  });

  it('une surcharge dont le commentaire cache une instruction', () => {
    // A commented out call is still a comment, but the line under it is code.
    expect(trouvees(EMPTY, grid('Grid', ['// gridView.invalidate();', 'gridView.requestLayout();']))).toEqual(['EmptyGrid']);
  });
});
