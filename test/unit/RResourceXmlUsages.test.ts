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

/**
 * La syntaxe `@type/cle` n'a de sens que dans un XML. Du code Kotlin ou Java
 * ecrit `R.string.cle` ; un `@string/cle` n'y apparait que dans une chaine ou
 * un commentaire, et n'est pas une reference navigable.
 *
 * Chercher ce motif dans chaque ligne de chaque source coutait cher pour rien :
 * A/B entrelace sur les 6219 fichiers d'un projet reel, 45 ms contre 32, soit
 * 41 % de plus, distributions disjointes.
 */
describe('le motif XML ne sert que pour les fichiers XML', () => {
  const KT = 'file:///p/app/src/main/java/com/x/A.kt';
  const SRC_KT = [
    'package com.x',
    '',
    '// voir @string/titre dans le layout',
    'fun go() = getString("@string/titre")',
  ].join(NL);

  it('un @string dans du Kotlin n est pas un usage', () => {
    const i = new RResourceIndex();
    i.reindexFile(KT, SRC_KT);
    expect(i.getUsages('string', 'titre')).toEqual([]);
  });

  it('mais le meme texte dans un XML en est un', () => {
    const i = new RResourceIndex();
    i.reindexFile('file:///p/app/src/main/res/layout/a.xml', '<T android:text="@string/titre"/>');
    expect(i.getUsages('string', 'titre')).toHaveLength(1);
  });

  it('et un AndroidManifest.xml compte comme les autres XML', () => {
    const i = new RResourceIndex();
    i.reindexFile('file:///p/app/src/main/AndroidManifest.xml',
      ['<manifest>', '  <application android:icon="@mipmap/ic_launcher"', '    android:label="@string/app_name" />', '</manifest>'].join(NL));
    expect(i.getUsages('mipmap', 'ic_launcher')).toHaveLength(1);
    expect(i.getUsages('string', 'app_name')).toHaveLength(1);
  });

  it('le R.string du code continue de compter', () => {
    const i = new RResourceIndex();
    i.reindexFile(KT, ['package com.x', '', 'fun go() = R.string.titre'].join(NL));
    expect(i.getUsages('string', 'titre')).toHaveLength(1);
  });
});

/**
 * Une reference dans un commentaire n'est pas une reference.
 *
 * Le badge d'usages excluait deja les commentaires ; l'index de navigation,
 * lui, lisait les lignes brutes, donc Ctrl+clic depuis une cle proposait
 * d'aller sur une ligne commentee. Mesure sur un projet reel : 5 cibles de ce
 * genre sur 4396, dont deux assertions Kotlin mises en commentaire et trois
 * commentaires XML.
 *
 * Le desamorcage COMPLET d'un fichier Kotlin coutait treize fois le prix de
 * l'index entier, 411 ms contre 32 : la regle cote code est donc un controle
 * par correspondance, en temps constant, et non un balayage du fichier. Elle
 * n'a fait perdre aucun usage reel sur les 4391 restants.
 */
describe('une reference commentee n est pas un usage', () => {
  const KT = 'file:///p/app/src/main/java/com/x/A.kt';
  const XML = 'file:///p/app/src/main/res/values/styles.xml';

  it('une ligne de code mise en commentaire', () => {
    const i = new RResourceIndex();
    i.reindexFile(KT, ['package com.x', '', '//  assertEquals(R.drawable.logo, x)'].join(NL));
    expect(i.getUsages('drawable', 'logo')).toEqual([]);
  });

  it('une ligne de KDoc', () => {
    const i = new RResourceIndex();
    i.reindexFile(KT, ['package com.x', '', '/**', ' * voir R.string.titre', ' */', 'fun f() {}'].join(NL));
    expect(i.getUsages('string', 'titre')).toEqual([]);
  });

  it('un commentaire XML', () => {
    const i = new RResourceIndex();
    i.reindexFile(XML, ['<resources>', '  <!-- textSize: @dimen/marge -->', '</resources>'].join(NL));
    expect(i.getUsages('dimen', 'marge')).toEqual([]);
  });

  it('mais un commentaire EN FIN de ligne ne masque pas ce qui precede', () => {
    const i = new RResourceIndex();
    i.reindexFile(XML, ['<resources>', '  <item name="c">@color/blanc</item> <!-- a changer -->', '</resources>'].join(NL));
    expect(i.getUsages('color', 'blanc')).toHaveLength(1);
  });

  it('et cote CODE non plus, un commentaire de fin de ligne ne masque rien', () => {
    const i = new RResourceIndex();
    i.reindexFile(KT, ['package com.x', '', 'val a = R.string.titre // a revoir'].join(NL));
    expect(i.getUsages('string', 'titre'), 'la reference precede le //').toHaveLength(1);
  });

  it('et un usage reel du code reste un usage', () => {
    const i = new RResourceIndex();
    i.reindexFile(KT, ['package com.x', '', 'val a = R.string.titre'].join(NL));
    expect(i.getUsages('string', 'titre')).toHaveLength(1);
  });
});
