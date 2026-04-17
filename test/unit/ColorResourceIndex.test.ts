/**
 * Tests pour ColorResourceIndex — parsing XML, priorité locale, formats hex.
 *
 * Attack surface:
 *  1. RE_COLOR regex — multiline [\s\S]*?, trim de la valeur
 *  2. getValue() — priorité /values/ sur /values-night/ etc.
 *  3. removeFile() — suppression propre de l'index
 *  4. Tous les formats Android : #RGB #RRGGBB #ARGB #AARRGGBB
 *
 * Tests nommés SP2-CRI-* pour faciliter le grep.
 */

import { describe, it, expect } from 'vitest';
import { ColorResourceIndex } from '../../src/indexer/ColorResourceIndex';

function xmlUri(path: string) {
  return { toString: () => `file://${path}` };
}

const VALUES_URI     = xmlUri('/app/res/values/colors.xml');
const VALUES_NIGHT   = xmlUri('/app/res/values-night/colors.xml');
const VALUES_EN      = xmlUri('/app/res/values-en/colors.xml');

function singleColorXml(name: string, value: string) {
  return `<?xml version="1.0" encoding="utf-8"?>\n<resources>\n    <color name="${name}">${value}</color>\n</resources>`;
}

// ── SP2-CRI-1 : parsing basique ───────────────────────────────────────────────

describe('SP2-CRI-1 — parsing basique', () => {
  it('couleur simple #RRGGBB', () => {
    const idx = new ColorResourceIndex();
    idx.reindexFile(VALUES_URI, singleColorXml('primary', '#7F52FF'));
    const e = idx.getValue('primary');
    expect(e).toBeDefined();
    expect(e!.value).toBe('#7F52FF');
  });

  it('plusieurs couleurs dans un même fichier', () => {
    const idx = new ColorResourceIndex();
    idx.reindexFile(VALUES_URI, `<resources>
      <color name="a">#FF0000</color>
      <color name="b">#00FF00</color>
      <color name="c">#0000FF</color>
    </resources>`);
    expect(idx.getValue('a')!.value).toBe('#FF0000');
    expect(idx.getValue('b')!.value).toBe('#00FF00');
    expect(idx.getValue('c')!.value).toBe('#0000FF');
  });

  it('clé inconnue — getValue retourne undefined (SP2-CRI-6)', () => {
    const idx = new ColorResourceIndex();
    idx.reindexFile(VALUES_URI, singleColorXml('primary', '#7F52FF'));
    expect(idx.getValue('not_there')).toBeUndefined();
  });
});

// ── SP2-CRI-2 : priorité locale ───────────────────────────────────────────────

describe('SP2-CRI-2 — priorité /values/ sur autres qualificateurs', () => {
  it('/values/ prioritaire sur /values-night/', () => {
    const idx = new ColorResourceIndex();
    idx.reindexFile(VALUES_NIGHT, singleColorXml('bg', '#121212'));
    idx.reindexFile(VALUES_URI,   singleColorXml('bg', '#FFFFFF'));
    expect(idx.getValue('bg')!.value).toBe('#FFFFFF');
  });

  it('/values/ prioritaire sur /values-en/', () => {
    const idx = new ColorResourceIndex();
    idx.reindexFile(VALUES_EN,  singleColorXml('text', '#333333'));
    idx.reindexFile(VALUES_URI, singleColorXml('text', '#212121'));
    expect(idx.getValue('text')!.value).toBe('#212121');
  });

  it('clé absente de /values/ mais présente dans /values-night/ — fallback', () => {
    const idx = new ColorResourceIndex();
    idx.reindexFile(VALUES_NIGHT, singleColorXml('dark_surface', '#1E1E1E'));
    // pas dans /values/
    expect(idx.getValue('dark_surface')!.value).toBe('#1E1E1E');
  });
});

// ── SP2-CRI-3..5 : formats hex Android ───────────────────────────────────────

describe('SP2-CRI-3..5 — formats hex Android stockés tels quels', () => {
  it('SP2-CRI-3: #AARRGGBB', () => {
    const idx = new ColorResourceIndex();
    idx.reindexFile(VALUES_URI, singleColorXml('scrim', '#66000000'));
    expect(idx.getValue('scrim')!.value).toBe('#66000000');
  });

  it('SP2-CRI-4: #RGB shorthand', () => {
    const idx = new ColorResourceIndex();
    idx.reindexFile(VALUES_URI, singleColorXml('red_short', '#F00'));
    expect(idx.getValue('red_short')!.value).toBe('#F00');
  });

  it('SP2-CRI-5: #ARGB shorthand', () => {
    const idx = new ColorResourceIndex();
    idx.reindexFile(VALUES_URI, singleColorXml('semi_white', '#8FFF'));
    expect(idx.getValue('semi_white')!.value).toBe('#8FFF');
  });
});

// ── SP2-CRI-7 : removeFile ────────────────────────────────────────────────────

describe('SP2-CRI-7 — removeFile', () => {
  it('après removeFile, getValue retourne undefined', () => {
    const idx = new ColorResourceIndex();
    idx.reindexFile(VALUES_URI, singleColorXml('primary', '#7F52FF'));
    expect(idx.getValue('primary')).toBeDefined();
    idx.removeFile(VALUES_URI);
    expect(idx.getValue('primary')).toBeUndefined();
  });

  it('removeFile sur URI inexistante ne crash pas', () => {
    const idx = new ColorResourceIndex();
    expect(() => idx.removeFile(xmlUri('/nonexistent/colors.xml'))).not.toThrow();
  });
});

// ── SP2-CRI-8 : 2 fichiers clés distinctes ───────────────────────────────────

describe('SP2-CRI-8 — 2 fichiers avec clés distinctes', () => {
  it('les deux clés accessibles', () => {
    const idx = new ColorResourceIndex();
    idx.reindexFile(VALUES_URI,   singleColorXml('primary', '#7F52FF'));
    idx.reindexFile(VALUES_NIGHT, singleColorXml('surface', '#1E1E1E'));
    expect(idx.getValue('primary')!.value).toBe('#7F52FF');
    expect(idx.getValue('surface')!.value).toBe('#1E1E1E');
  });
});

// ── SP2-CRI-9 : balise multiline ─────────────────────────────────────────────

describe('SP2-CRI-9 — balise multiline', () => {
  it('valeur sur plusieurs lignes — trimée', () => {
    const xml = `<resources>
    <color name="primary">
      #FF0000
    </color>
</resources>`;
    const idx = new ColorResourceIndex();
    idx.reindexFile(VALUES_URI, xml);
    expect(idx.getValue('primary')!.value).toBe('#FF0000');
  });
});

// ── Regressions ───────────────────────────────────────────────────────────────

describe('SP2-CRI — edge cases supplémentaires', () => {
  it('reindexFile remplace le contenu précédent du même fichier', () => {
    const idx = new ColorResourceIndex();
    idx.reindexFile(VALUES_URI, singleColorXml('primary', '#111111'));
    idx.reindexFile(VALUES_URI, singleColorXml('primary', '#222222'));
    expect(idx.getValue('primary')!.value).toBe('#222222');
  });

  it('numéro de ligne correctement calculé (0-indexé)', () => {
    const xml = `<resources>\n    <color name="first">#FFFFFF</color>\n</resources>`;
    const idx = new ColorResourceIndex();
    idx.reindexFile(VALUES_URI, xml);
    expect(idx.getValue('first')!.line).toBe(1);
  });

  it('uri stockée dans ColorEntry', () => {
    const idx = new ColorResourceIndex();
    idx.reindexFile(VALUES_URI, singleColorXml('x', '#000'));
    expect(idx.getValue('x')!.uri.toString()).toBe(VALUES_URI.toString());
  });
});
