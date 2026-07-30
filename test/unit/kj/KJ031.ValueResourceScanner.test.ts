import { describe, it, expect } from 'vitest';
import { importOrNull } from './harness';

/**
 * KJ-031 — le scanner de balises de `res/values*​/*.xml`.
 *
 *   collectValueKeyDeclarations(path, xml, moduleDirs?): ValueKeyDeclaration[]
 *   parseValuesPath(path): { qualifier, isBase } | undefined
 *
 * Contrat : une passe, une pile d'éléments. Chaque déclaration porte les
 * offsets de l'entrée ENTIÈRE (`<` de l'ouvrante jusqu'après la fermante),
 * ce qui rend `<plurals>` et `<style>` gratuits pour la suppression.
 */

const mod: any = await importOrNull('src/indexer/ValueResourceScanner');

const P = '/w/app/src/main/res/values/x.xml';
const scan = (xml: string, path = P) => mod.collectValueKeyDeclarations(path, xml);
const names = (xml: string, path = P) => scan(xml, path).map((d: any) => `${d.kind}/${d.name}`);
const res = (body: string) => `<?xml version="1.0" encoding="utf-8"?>\n<resources>\n${body}\n</resources>\n`;

describe.skipIf(!mod)('parseValuesPath', () => {
  it('reconnaît le dossier de base et les qualifiers', () => {
    expect(mod.parseValuesPath(P)).toEqual({ qualifier: 'values', isBase: true });
    expect(mod.parseValuesPath('/w/a/res/values-night/c.xml')).toEqual({ qualifier: 'values-night', isBase: false });
    expect(mod.parseValuesPath('/w/a/res/values-w1024dp-h695dp/d.xml'))
      .toEqual({ qualifier: 'values-w1024dp-h695dp', isBase: false });
  });

  it('rejette ce qui n’est pas un fichier values', () => {
    expect(mod.parseValuesPath('/w/a/res/layout/main.xml')).toBeUndefined();
    expect(mod.parseValuesPath('/w/a/res/drawable-hdpi/ic.png')).toBeUndefined();
    expect(mod.parseValuesPath('/w/a/AndroidManifest.xml')).toBeUndefined();
    expect(mod.parseValuesPath('/w/a/values/x.xml')).toBeUndefined(); // pas sous res/
  });

  it('accepte les séparateurs Windows', () => {
    expect(mod.parseValuesPath('C:\\w\\a\\res\\values-fr\\s.xml'))
      .toEqual({ qualifier: 'values-fr', isBase: false });
  });
});

describe.skipIf(!mod)('les neuf types déclarés', () => {
  it('reconnaît chaque type au premier niveau', () => {
    const xml = res([
      '  <string name="s">v</string>',
      '  <color name="c">#fff</color>',
      '  <dimen name="d">1dp</dimen>',
      '  <integer name="i">2</integer>',
      '  <bool name="b">true</bool>',
      '  <style name="St" />',
      '  <string-array name="sa"><item>x</item></string-array>',
      '  <integer-array name="ia"><item>1</item></integer-array>',
      '  <array name="ar"><item>x</item></array>',
      '  <plurals name="pl"><item quantity="one">x</item></plurals>',
      '  <attr name="at" format="color" />',
    ].join('\n'));
    expect(names(xml)).toEqual([
      'string/s', 'color/c', 'dimen/d', 'integer/i', 'bool/b', 'style/St',
      'array/sa', 'array/ia', 'array/ar', 'plurals/pl', 'attr/at',
    ]);
  });

  it('un <item type="k"> déclare le type k, sauf id', () => {
    const xml = res('  <item name="k1" type="string">v</item>\n  <item name="k2" type="id" />');
    expect(names(xml)).toEqual(['string/k1']);
  });

  it('ignore ce qui n’est pas une déclaration de clé', () => {
    const xml = res('  <declare-styleable name="Sty" />\n  <eat-comment />\n  <item name="noType">x</item>');
    expect(names(xml)).toEqual([]);
  });
});

describe.skipIf(!mod)('attr et item : la profondeur décide', () => {
  it('dans un declare-styleable, un attr n’est une déclaration que s’il a format', () => {
    const xml = res([
      '  <declare-styleable name="KjBadge">',
      '    <attr name="withFormat" format="color" />',
      '    <attr name="noFormat" />',
      '  </declare-styleable>',
    ].join('\n'));
    expect(names(xml)).toEqual(['attr/withFormat']);
  });

  it('un <item> dans un <style> nomme un attr, il ne déclare rien', () => {
    const xml = res([
      '  <style name="Theme.Kj">',
      '    <item name="kjAccent">@color/a</item>',
      '    <item name="android:textColor">#fff</item>',
      '  </style>',
    ].join('\n'));
    expect(names(xml)).toEqual(['style/Theme.Kj']);
  });

  it('un nom contenant deux-points n’est jamais une déclaration locale', () => {
    const xml = res([
      '  <declare-styleable name="S">',
      '    <attr name="android:textColor" />',
      '    <attr name="android:background" format="reference" />',
      '  </declare-styleable>',
    ].join('\n'));
    expect(names(xml)).toEqual([]);
  });
});

describe.skipIf(!mod)('les offsets couvrent l’entrée entière', () => {
  it('une entrée sur une ligne', () => {
    const xml = res('  <string name="s">hello</string>');
    const [d] = scan(xml);
    expect(xml.slice(d.start, d.end)).toBe('<string name="s">hello</string>');
  });

  it('une balise auto-fermante', () => {
    const xml = res('  <attr name="a" format="color" />');
    const [d] = scan(xml);
    expect(xml.slice(d.start, d.end)).toBe('<attr name="a" format="color" />');
  });

  it('un bloc multiligne : plurals', () => {
    const xml = res([
      '  <plurals name="p">',
      '    <item quantity="one">x</item>',
      '    <item quantity="other">y</item>',
      '  </plurals>',
    ].join('\n'));
    const [d] = scan(xml);
    const slice = xml.slice(d.start, d.end);
    expect(slice.startsWith('<plurals name="p">')).toBe(true);
    expect(slice.endsWith('</plurals>')).toBe(true);
    expect(slice).toContain('quantity="other"');
  });

  it('un <style> imbriqué garde ses items dans sa plage', () => {
    const xml = res([
      '  <style name="A">',
      '    <item name="x">1</item>',
      '  </style>',
      '  <string name="after">z</string>',
    ].join('\n'));
    const [style, after] = scan(xml);
    expect(xml.slice(style.start, style.end).endsWith('</style>')).toBe(true);
    expect(xml.slice(after.start, after.end)).toBe('<string name="after">z</string>');
  });

  it('la position pointe la valeur de name=, pas la balise', () => {
    const xml = res('  <string name="kj_key">v</string>');
    const [d] = scan(xml);
    const lines = xml.split('\n');
    expect(lines[d.line].slice(d.character, d.character + d.nameLength)).toBe('kj_key');
    expect(d.nameLength).toBe(6);
  });
});

describe.skipIf(!mod)('le tokeniseur tient les cas pénibles', () => {
  it('un > nu dans le texte de l’élément', () => {
    const xml = res('  <string name="cmp">a > b</string>\n  <string name="next">z</string>');
    expect(names(xml)).toEqual(['string/cmp', 'string/next']);
  });

  it('un > à l’intérieur d’une valeur d’attribut', () => {
    const xml = res('  <string name="q" translatable="a>b">v</string>\n  <color name="c">#fff</color>');
    expect(names(xml)).toEqual(['string/q', 'color/c']);
  });

  it('du CDATA contenant des balises', () => {
    const xml = res('  <string name="html"><![CDATA[<b>bold</b> & <i>x</i>]]></string>\n  <color name="c">#fff</color>');
    expect(names(xml)).toEqual(['string/html', 'color/c']);
  });

  it('un commentaire entre deux entrées ne casse rien et n’est pas lu', () => {
    const xml = res('  <!-- <string name="ghost">x</string> -->\n  <string name="real">v</string>');
    expect(names(xml)).toEqual(['string/real']);
  });

  it('le prologue et une DOCTYPE sont sautés', () => {
    const xml = '<?xml version="1.0"?>\n<!DOCTYPE resources>\n<resources>\n  <string name="s">v</string>\n</resources>';
    expect(names(xml)).toEqual(['string/s']);
  });

  it('une balise jamais fermée ne fait pas déborder la plage', () => {
    const xml = '<resources>\n  <string name="unclosed">v\n';
    const found = scan(xml);
    for (const d of found) {
      expect(d.start).toBeGreaterThanOrEqual(0);
      expect(d.end).toBeLessThanOrEqual(xml.length);
      expect(d.end).toBeGreaterThan(d.start);
    }
  });

  it('les apostrophes simples délimitent aussi une valeur d’attribut', () => {
    const xml = res("  <string name='single'>v</string>");
    expect(names(xml)).toEqual(['string/single']);
  });

  it('fichier vide ou sans resources', () => {
    expect(scan('')).toEqual([]);
    expect(scan('<?xml version="1.0"?>')).toEqual([]);
  });
});

describe.skipIf(!mod)('métadonnées de chemin', () => {
  it('porte le qualifier et le drapeau de base', () => {
    const [base] = scan(res('  <color name="c">#fff</color>'));
    expect(base.qualifier).toBe('values');
    expect(base.isBase).toBe(true);

    const [night] = scan(res('  <color name="c">#000</color>'), '/w/app/src/main/res/values-night/c.xml');
    expect(night.qualifier).toBe('values-night');
    expect(night.isBase).toBe(false);
  });

  it('rattache la déclaration à son module quand on lui donne les dossiers', () => {
    const decls = mod.collectValueKeyDeclarations(
      '/w/feature/src/main/res/values/s.xml',
      res('  <string name="s">v</string>'),
      ['/w/app', '/w/feature'],
    );
    expect(decls[0].moduleDir).toBe('/w/feature');
  });

  it('sans dossiers de module, moduleDir reste vide', () => {
    expect(scan(res('  <string name="s">v</string>'))[0].moduleDir).toBe('');
  });
});
