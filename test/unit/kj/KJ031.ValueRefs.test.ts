import { describe, it, expect } from 'vitest';
import { importOrNull } from './harness';

/**
 * KJ-031 — les collecteurs de références vers une clé de `values*`.
 *
 * Six formes, dont trois que `collectXmlResourceRefs` ne sait pas voir :
 * le parent de style (nu, sans `@`), la référence de thème (`?attr/`), et
 * le token `R.styleable.X_y` où le nom d'attr est un SUFFIXE.
 */

const mod: any = await importOrNull('src/util/xmlRefs');

const KINDS = ['string', 'color', 'dimen', 'style', 'attr', 'integer', 'bool', 'array', 'plurals'];
const refs = (text: string, path: string) =>
  mod.collectValueResourceRefs(text, path, KINDS).map((r: any) => `${r.kind}/${r.name}`);

describe.skipIf(!mod)('collectValueResourceRefs', () => {
  it('lit @kind/name dans le XML et R.kind.name dans le code', () => {
    expect(refs('<TextView android:text="@string/hello" />', '/a/res/layout/m.xml')).toContain('string/hello');
    expect(refs('val v = R.color.brand', '/a/Main.kt')).toContain('color/brand');
    expect(refs('int v = R2.dimen.pad;', '/a/Main.java')).toContain('dimen/pad');
  });

  it('accepte les noms pointés, que les anciens collecteurs coupaient', () => {
    expect(refs('<View style="@style/Widget.Kj.Button" />', '/a/res/layout/m.xml'))
      .toContain('style/Widget.Kj.Button');
  });

  it('normalise le point et l’underscore : R.style.A_B référence @style/A.B', () => {
    const found = mod.collectValueResourceRefs('val s = R.style.Widget_Kj_Button', '/a/Main.kt', KINDS);
    const names = found.map((r: any) => r.name);
    expect(names).toContain('Widget_Kj_Button');
    expect(mod.normalizeResourceName('Widget.Kj.Button')).toBe('Widget_Kj_Button');
  });

  it('ignore les commentaires des deux langages', () => {
    expect(refs('<!-- @string/ghost -->\n<View a="@string/real" />', '/a/res/layout/m.xml'))
      .toEqual(['string/real']);
    expect(refs('// R.string.ghost\nval v = R.string.real', '/a/Main.kt')).toEqual(['string/real']);
  });

  it('ignore tools: mais garde tools:keep', () => {
    expect(refs('<View tools:text="@string/design" />', '/a/res/layout/m.xml')).toEqual([]);
    expect(refs('<resources tools:keep="@string/kept" />', '/a/res/values/keep.xml')).toContain('string/kept');
  });

  it('ne confond pas le namespace android avec une ressource locale', () => {
    expect(refs('<View a="@android:color/white" />', '/a/res/layout/m.xml')).toEqual([]);
  });

  it('lit aussi le texte d’élément, pas seulement les attributs', () => {
    expect(refs('<item name="x">@color/accent</item>', '/a/res/values/s.xml')).toContain('color/accent');
  });
});

describe.skipIf(!mod)('collectStyleParentRefs', () => {
  it('lit les deux formes de parent', () => {
    const found = mod.collectStyleParentRefs('<style name="A" parent="Base" />\n<style name="B" parent="@style/Other" />');
    expect([...found]).toEqual(expect.arrayContaining(['Base', 'Other']));
  });

  it('ne prend pas le nom du style déclaré pour son propre parent', () => {
    expect([...mod.collectStyleParentRefs('<style name="Solo" />')]).toEqual([]);
  });

  it('ignore un parent de plateforme', () => {
    const found = mod.collectStyleParentRefs('<style name="A" parent="@android:style/Widget" />');
    expect([...found]).not.toContain('Widget');
  });
});

describe.skipIf(!mod)('styleParentClosure', () => {
  it('un style pointé garde vivants tous ses préfixes', () => {
    const closure = mod.styleParentClosure(['Widget.Kj.Button.Primary']);
    expect([...closure].sort()).toEqual(['Widget', 'Widget.Kj', 'Widget.Kj.Button']);
  });

  it('un nom sans point ne produit rien', () => {
    expect([...mod.styleParentClosure(['Solo'])]).toEqual([]);
  });

  it('ne se retourne jamais contre lui-même', () => {
    expect([...mod.styleParentClosure(['A.B'])]).toEqual(['A']);
  });
});

describe.skipIf(!mod)('collectThemeAttrRefs', () => {
  it('lit ?attr/nom et ?nom', () => {
    const found = mod.collectThemeAttrRefs('<View a="?attr/kjAccent" b="?kjOther" />');
    expect([...found].sort()).toEqual(['kjAccent', 'kjOther']);
  });

  it('ignore le namespace android', () => {
    expect([...mod.collectThemeAttrRefs('<View a="?android:attr/colorPrimary" />')]).toEqual([]);
  });

  it('une valeur qui CONTIENT un ? n’est pas une référence de thème', () => {
    // sinon toute URL dans un <string> empoisonnerait l'ensemble des vivants
    expect([...mod.collectThemeAttrRefs('<string name="u">https://x/y?z=1</string>')]).toEqual([]);
  });
});

describe.skipIf(!mod)('collectStyleableTokens', () => {
  it('récolte les tokens R.styleable entiers, sans les découper', () => {
    const found = mod.collectStyleableTokens('val a = R.styleable.KjBadge_kjBadgeColor');
    expect([...found]).toEqual(['KjBadge_kjBadgeColor']);
  });

  it('un attr est vivant quand un token finit par _<attr>', () => {
    const tokens = mod.collectStyleableTokens('R.styleable.KjBadge_kj_badge_color');
    expect(mod.styleableCovers(tokens, 'kj_badge_color')).toBe(true);
    expect(mod.styleableCovers(tokens, 'autre_chose')).toBe(false);
  });

  it('sur-couvre plutôt que de découper un token ambigu', () => {
    // Les deux moitiés d'un token peuvent contenir « _ », donc le découpage est
    // indécidable. Un attr nommé « badge_color » passera pour vivant ici. C'est
    // le contrat : une occurrence non classifiable compte comme un usage.
    const tokens = mod.collectStyleableTokens('R.styleable.KjBadge_kj_badge_color');
    expect(mod.styleableCovers(tokens, 'badge_color')).toBe(true);
  });
});

describe.skipIf(!mod)('collectStyleItemAttrNames', () => {
  it('un item dans un style nomme l’attr qu’il pose', () => {
    const xml = '<resources>\n <style name="T">\n  <item name="kjAccent">@color/a</item>\n </style>\n</resources>';
    expect([...mod.collectStyleItemAttrNames(xml)]).toEqual(['kjAccent']);
  });

  it('ne récolte pas les item de plateforme ni ceux hors style', () => {
    const xml = '<resources>\n <style name="T"><item name="android:textColor">#fff</item></style>\n'
      + ' <item name="topLevel" type="string">v</item>\n</resources>';
    expect([...mod.collectStyleItemAttrNames(xml)]).toEqual([]);
  });
});

describe.skipIf(!mod)('blankValueDeclarationNames', () => {
  it('blanchit la valeur de name= sans bouger les offsets', () => {
    const xml = '<string name="kj_key">value</string>';
    const out = mod.blankValueDeclarationNames(xml);
    expect(out).toHaveLength(xml.length);
    expect(out).not.toContain('kj_key');
    expect(out).toContain('value');
  });

  it('c’est ce qui empêche une déclaration de se ressusciter elle-même', () => {
    const xml = '<resources><string name="kj_dead">x</string></resources>';
    const literals = mod.collectStringLiterals(mod.blankValueDeclarationNames(xml));
    expect(literals.has('kj_dead')).toBe(false);
  });
});
