/**
 * Les references `@string/cle` des layouts, pour la navigation XML vers usage.
 *
 * L'index des usages ne lisait que `.kt`, `.kts` et `.java`. Or en Android la
 * plupart des chaines sont referencees depuis un layout, un menu ou un graphe
 * de navigation. Ctrl+clic sur `name="cle"` dans `strings.xml` ne menait donc
 * nulle part pour celles la.
 *
 * Mesure sur un projet reel de 1237 cles declarees en locale par defaut :
 * 723 sont referencees depuis le code, et 428 le sont UNIQUEMENT depuis un
 * XML, soit 35 %. Le corpus concerne pese 1081 fichiers pour 2,17 Mo, dont
 * 229 que l'extension lisait deja.
 */
import { describe, it, expect } from 'vitest';
import { RResourceIndex } from '../../src/indexer/RResourceIndex';

const NL = String.fromCharCode(10);

const LAYOUT = 'file:///p/app/src/main/res/layout/ecran.xml';
const LAYOUT_XML = [
  '<LinearLayout>',
  '    <TextView android:text="@string/titre" />',
  '    <TextView android:hint="@string/titre" android:textColor="@color/accent" />',
  '    <ImageView android:src="@drawable/logo" />',
  '    <View android:id="@+id/titre" android:background="@color/accent" />',
  '    <TextView android:text="@plurals/jours" />',
  '</LinearLayout>',
].join(NL);

const CODE = 'file:///p/app/src/main/java/com/x/Ecran.kt';
const CODE_KT = ['package com.x', '', 'fun go() = R.string.titre'].join(NL);

describe('les references @type/cle des XML comptent comme usages', () => {
  it('une chaine utilisee dans un layout est trouvee', () => {
    const i = new RResourceIndex();
    i.reindexFile(LAYOUT, LAYOUT_XML);
    const u = i.getUsages('string', 'titre');
    expect(u.map(x => x.line).sort((a, b) => a - b), 'les deux references du layout').toEqual([1, 2]);
    expect(u[0].uri).toBe(LAYOUT);
  });

  it('les couleurs, drawables et pluriels aussi', () => {
    const i = new RResourceIndex();
    i.reindexFile(LAYOUT, LAYOUT_XML);
    expect(i.getUsages('color', 'accent').map(x => x.line)).toEqual([2, 4]);
    expect(i.getUsages('drawable', 'logo').map(x => x.line)).toEqual([3]);
    expect(i.getUsages('plurals', 'jours').map(x => x.line)).toEqual([5]);
  });

  it('mais `@+id/titre` n est pas une chaine', () => {
    const i = new RResourceIndex();
    i.reindexFile(LAYOUT, LAYOUT_XML);
    // ligne 4 porte `@+id/titre` : elle ne doit pas figurer parmi les chaines
    expect(i.getUsages('string', 'titre').map(x => x.line)).not.toContain(4);
  });

  it('et le code continue de compter comme avant', () => {
    const i = new RResourceIndex();
    i.reindexFile(CODE, CODE_KT);
    i.reindexFile(LAYOUT, LAYOUT_XML);
    const u = i.getUsages('string', 'titre');
    expect(u.map(x => x.uri).sort()).toEqual([CODE, LAYOUT, LAYOUT].sort());
  });

  it('et retirer le layout retire ses usages', () => {
    const i = new RResourceIndex();
    i.reindexFile(CODE, CODE_KT);
    i.reindexFile(LAYOUT, LAYOUT_XML);
    i.removeFile(LAYOUT);
    expect(i.getUsages('string', 'titre').map(x => x.uri)).toEqual([CODE]);
  });
});
