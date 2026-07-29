import { describe, it, expect } from 'vitest';
import {
  blankToolsAttributes,
  bindingClassTokens,
  bindingStemOf,
  collectCodeResourceRefs,
  collectStringLiterals,
  collectXmlResourceRefs,
  stripKotlinComments,
  stripXmlComments,
} from '../../../src/util/xmlRefs';

const KINDS = ['layout', 'menu', 'anim', 'drawable'];

describe('xmlRefs — blanchiment', () => {
  it('blankToolsAttributes préserve les longueurs et les lignes', () => {
    const xml = '<View\n  tools:layout="@layout/x"\n  android:id="@+id/y" />\n';
    const out = blankToolsAttributes(xml);
    expect(out.length).toBe(xml.length);
    expect(out.split('\n').length).toBe(xml.split('\n').length);
  });

  it('la valeur d’un tools: disparaît, celle des autres reste', () => {
    const xml = '<View tools:layout="@layout/ghost" android:background="@drawable/real" />';
    const out = blankToolsAttributes(xml);
    expect(out).not.toContain('@layout/ghost');
    expect(out).toContain('@drawable/real');
    expect(out).toContain('tools:layout='); // le nom de l’attribut survit
  });

  it('tools:keep est l’exception : c’est la keep-list du shrinker', () => {
    const xml = '<resources tools:keep="@layout/kept,@drawable/also_kept" />';
    expect(blankToolsAttributes(xml)).toContain('@layout/kept');
  });

  it('stripXmlComments et stripKotlinComments préservent les longueurs', () => {
    const xml = '<a/><!-- @layout/x -->\n<b/>';
    expect(stripXmlComments(xml).length).toBe(xml.length);
    expect(stripXmlComments(xml)).not.toContain('@layout/x');
    const kt = 'val a = 1 // R.layout.x\n/* R.layout.y */\nval b = 2';
    expect(stripKotlinComments(kt).length).toBe(kt.length);
    expect(stripKotlinComments(kt)).not.toContain('R.layout.x');
    expect(stripKotlinComments(kt)).not.toContain('R.layout.y');
  });
});

describe('xmlRefs — collecte', () => {
  it('attributs et texte d’élément en une passe', () => {
    const xml = [
      '<layout>',
      '  <include layout="@layout/header"/>',
      '  <item name="android:windowBackground">@drawable/bg</item>',
      '  <BottomNav app:menu="@menu/main"/>',
      '</layout>',
    ].join('\n');
    const refs = collectXmlResourceRefs(xml, KINDS).map(r => `${r.kind}/${r.name}`);
    expect(refs).toEqual(['layout/header', 'drawable/bg', 'menu/main']);
  });

  it('un tools: ne compte pas, un commentaire non plus', () => {
    const xml = '<View tools:layout="@layout/ghost"/>\n<!-- <include layout="@layout/commented"/> -->';
    expect(collectXmlResourceRefs(xml, KINDS)).toEqual([]);
  });

  it('@android:drawable n’est jamais confondu avec une ressource locale', () => {
    const xml = '<View android:background="@android:drawable/list_selector"/>';
    expect(collectXmlResourceRefs(xml, KINDS)).toEqual([]);
  });

  it('R.kind.name et R2.kind.name côté code, commentaires exclus', () => {
    const code = 'setContentView(R.layout.main)\n// R.layout.dead\nval m = R2.menu.opts\nval q = com.example.R.anim.fade';
    const refs = collectCodeResourceRefs(code, KINDS).map(r => `${r.kind}/${r.name}`);
    expect(refs).toEqual(['layout/main', 'menu/opts', 'anim/fade']);
  });

  it('littéraux nus et tokens de binding', () => {
    expect(collectStringLiterals('load("config_dynamic")').has('config_dynamic')).toBe(true);
    const tokens = bindingClassTokens('val b = ActivityMainBinding.inflate(i)\nFragmentDetailsBindingImpl()');
    expect(tokens.has('ActivityMain')).toBe(true);
    expect(tokens.has('FragmentDetails')).toBe(true);
  });

  it('bindingStemOf convertit le nom de ressource en racine de classe', () => {
    expect(bindingStemOf('activity_main')).toBe('ActivityMain');
    expect(bindingStemOf('view_kj_banner')).toBe('ViewKjBanner');
    expect(bindingStemOf('simple')).toBe('Simple');
  });
});
