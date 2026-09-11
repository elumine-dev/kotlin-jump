/**
 * La longueur de la plage d'un usage de ressource.
 *
 * Les trois fournisseurs qui vont d'un XML de `values` vers ses usages
 * construisaient la plage a partir d'une longueur DEVINEE :
 *
 *     const matchLen = `R.color.${key}`.length;
 *
 * C'etait juste tant que tout usage s'ecrivait `R.color.accent` dans du code.
 * Depuis que les references des layouts comptent, un usage peut s'ecrire
 * `@color/accent`, qui fait UN caractere de moins. La plage debordait donc
 * d'un caractere sur ce qui suit, pour tous les usages venus d'un XML.
 *
 * La longueur est desormais celle du texte reellement reconnu, relevee a
 * l'indexation : plus rien a deviner.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { workspace, Position } from './__mocks__/vscode';
import { mockDocument } from './helpers';
import { RResourceIndex } from '../../src/indexer/RResourceIndex';
import { StringXmlDefinitionProvider } from '../../src/providers/StringXmlDefinitionProvider';
import { ColorXmlDefinitionProvider } from '../../src/providers/ColorXmlDefinitionProvider';
import { DrawableXmlDefinitionProvider } from '../../src/providers/DrawableXmlDefinitionProvider';

const NL = String.fromCharCode(10);
afterEach(() => vi.restoreAllMocks());

const LAYOUT = 'file:///p/app/src/main/res/layout/ecran.xml';
const LAYOUT_XML = [
  '<LinearLayout>',
  '    <TextView android:text="@string/titre" android:tag="apres" />',
  '    <View android:background="@color/accent" android:tag="apres" />',
  '    <ImageView android:src="@drawable/logo" android:tag="apres" />',
  '</LinearLayout>',
].join(NL);

const CODE = 'file:///p/app/src/main/java/com/x/Ecran.kt';
const CODE_KT = ['package com.x', '', 'val a = R.string.titre', 'val b = R.color.accent'].join(NL);

const STRINGS = 'file:///p/app/src/main/res/values/strings.xml';
const STRINGS_XML = ['<resources>', '    <string name="titre">Titre</string>', '</resources>'].join(NL);
const COLORS = 'file:///p/app/src/main/res/values/colors.xml';
const COLORS_XML = ['<resources>', '    <color name="accent">#FFF</color>', '</resources>'].join(NL);
const DRAWABLE = 'file:///p/app/src/main/res/drawable/logo.xml';
const DRAWABLE_XML = ['<vector android:width="24dp">', '</vector>'].join(NL);

function index() {
  const i = new RResourceIndex();
  i.reindexFile(LAYOUT, LAYOUT_XML);
  i.reindexFile(CODE, CODE_KT);
  return i;
}

/** Le texte reellement couvert par une plage rendue. */
function texteDe(loc: any): string {
  const src = String(loc.uri) === LAYOUT ? LAYOUT_XML : CODE_KT;
  const ligne = src.split(NL)[loc.range.start.line] ?? '';
  return ligne.slice(loc.range.start.character, loc.range.end.character);
}

describe('la plage d un usage couvre exactement le texte reconnu', () => {
  it('une chaine referencee depuis un layout', () => {
    const col = STRINGS_XML.split(NL)[1].indexOf('name="titre"') + 6;
    const locs = new StringXmlDefinitionProvider(index()).provideDefinition(
      mockDocument(STRINGS, STRINGS_XML) as any, new Position(1, col) as any,
    );
    const depuisLayout = (locs ?? []).filter((l: any) => String(l.uri) === LAYOUT);
    expect(depuisLayout, 'le layout est trouve').toHaveLength(1);
    expect(texteDe(depuisLayout[0])).toBe('@string/titre');
  });

  it('et depuis le code, la forme R. garde sa longueur', () => {
    const col = STRINGS_XML.split(NL)[1].indexOf('name="titre"') + 6;
    const locs = new StringXmlDefinitionProvider(index()).provideDefinition(
      mockDocument(STRINGS, STRINGS_XML) as any, new Position(1, col) as any,
    );
    const depuisCode = (locs ?? []).filter((l: any) => String(l.uri) === CODE);
    expect(depuisCode).toHaveLength(1);
    expect(texteDe(depuisCode[0])).toBe('R.string.titre');
  });

  it('une couleur referencee depuis un layout', () => {
    const col = COLORS_XML.split(NL)[1].indexOf('name="accent"') + 6;
    const locs = new ColorXmlDefinitionProvider(index()).provideDefinition(
      mockDocument(COLORS, COLORS_XML) as any, new Position(1, col) as any,
    );
    const depuisLayout = (locs ?? []).filter((l: any) => String(l.uri) === LAYOUT);
    expect(depuisLayout).toHaveLength(1);
    expect(texteDe(depuisLayout[0])).toBe('@color/accent');
  });

  it('un drawable referencee depuis un layout', () => {
    const locs = new DrawableXmlDefinitionProvider(index()).provideDefinition(
      mockDocument(DRAWABLE, DRAWABLE_XML) as any, new Position(0, 2) as any,
    );
    expect(locs).toHaveLength(1);
    expect(texteDe(locs[0])).toBe('@drawable/logo');
  });
});
