import { describe, it, expect } from 'vitest';
import { importOrNull } from './harness';

/**
 * KJ-031 — les PLAGES de suppression, isolément.
 *
 * C'est la partie qui retire du texte, donc celle où une erreur coûte cher.
 * On teste `expandToWholeLines` composé avec les offsets du scanner, sans
 * passer par VS Code.
 */

const mod: any = await importOrNull('src/providers/UnusedResourceKeyProvider');
const scanner: any = await importOrNull('src/indexer/ValueResourceScanner');

const P = '/w/app/src/main/res/values/x.xml';

/** Applique la suppression d'une clé comme le ferait le code action. */
function removeKey(xml: string, name: string): string {
  const decl = scanner.collectValueKeyDeclarations(P, xml).find((d: any) => d.name === name);
  if (!decl) return xml;
  const { start, end } = mod.expandToWholeLines(xml, decl.start, decl.end);
  return xml.slice(0, start) + xml.slice(end);
}

describe.skipIf(!mod || !scanner)('expandToWholeLines', () => {
  it('avale la ligne entière quand l’entrée est seule dessus', () => {
    const xml = '<resources>\n  <string name="a">v</string>\n  <string name="b">w</string>\n</resources>\n';
    expect(removeKey(xml, 'a')).toBe('<resources>\n  <string name="b">w</string>\n</resources>\n');
  });

  it('ne laisse jamais de ligne vide orpheline', () => {
    const xml = '<resources>\n  <color name="dead">#fff</color>\n</resources>\n';
    const out = removeKey(xml, 'dead');
    expect(out).toBe('<resources>\n</resources>\n');
    expect(out).not.toMatch(/\n\s*\n/);
  });

  it('mais se limite à l’entrée quand la ligne porte autre chose', () => {
    const xml = '<resources>\n  <string name="a">v</string><string name="b">w</string>\n</resources>\n';
    const out = removeKey(xml, 'a');
    expect(out).toContain('<string name="b">w</string>');
    expect(out).not.toContain('name="a"');
    expect(out.split('\n')).toHaveLength(xml.split('\n').length);
  });

  it('un bloc multiligne part en entier', () => {
    const xml = [
      '<resources>',
      '  <plurals name="dead">',
      '    <item quantity="one">x</item>',
      '    <item quantity="other">y</item>',
      '  </plurals>',
      '  <string name="keep">v</string>',
      '</resources>',
      '',
    ].join('\n');
    const out = removeKey(xml, 'dead');
    expect(out).not.toContain('plurals');
    expect(out).not.toContain('quantity');
    expect(out).toContain('<string name="keep">v</string>');
  });

  it('un <style> avec ses items part en entier', () => {
    const xml = [
      '<resources>',
      '  <style name="Dead">',
      '    <item name="kjAccent">#fff</item>',
      '  </style>',
      '  <style name="Keep" />',
      '</resources>',
      '',
    ].join('\n');
    const out = removeKey(xml, 'Dead');
    expect(out).not.toContain('kjAccent');
    expect(out).toContain('<style name="Keep" />');
  });

  it('le commentaire au-dessus n’est pas mangé', () => {
    // Un commentaire couvre souvent un groupe entier : le laisser coûte du
    // cosmétique, le manger perd de la donnée.
    const xml = '<resources>\n  <!-- Brand colors -->\n  <color name="dead">#fff</color>\n</resources>\n';
    expect(removeKey(xml, 'dead')).toContain('<!-- Brand colors -->');
  });

  it('la première et la dernière entrée du fichier se retirent proprement', () => {
    const xml = '<resources>\n  <string name="first">a</string>\n  <string name="last">z</string>\n</resources>\n';
    expect(removeKey(xml, 'first')).toBe('<resources>\n  <string name="last">z</string>\n</resources>\n');
    expect(removeKey(xml, 'last')).toBe('<resources>\n  <string name="first">a</string>\n</resources>\n');
  });

  it('le fichier reste bien formé après suppression', () => {
    const xml = [
      '<?xml version="1.0" encoding="utf-8"?>',
      '<resources>',
      '  <string name="dead">x</string>',
      '  <string name="live">y</string>',
      '</resources>',
      '',
    ].join('\n');
    const out = removeKey(xml, 'dead');
    expect((out.match(/<resources>/g) ?? []).length).toBe(1);
    expect((out.match(/<\/resources>/g) ?? []).length).toBe(1);
    expect(scanner.collectValueKeyDeclarations(P, out).map((d: any) => d.name)).toEqual(['live']);
  });

  it('une entrée dont la valeur contient une balise ne déborde pas', () => {
    const xml = '<resources>\n  <string name="dead"><![CDATA[<b>x</b>]]></string>\n  <string name="live">y</string>\n</resources>\n';
    const out = removeKey(xml, 'dead');
    expect(out).not.toContain('CDATA');
    expect(out).toContain('<string name="live">y</string>');
  });

  it('les fins de ligne Windows survivent', () => {
    const xml = '<resources>\r\n  <string name="dead">x</string>\r\n  <string name="live">y</string>\r\n</resources>\r\n';
    const out = removeKey(xml, 'dead');
    expect(out).not.toContain('name="dead"');
    expect(out).toContain('<string name="live">y</string>\r\n');
  });

  it('supprimer plusieurs clés de la fin vers le début reste cohérent', () => {
    const xml = [
      '<resources>',
      '  <string name="a">1</string>',
      '  <string name="b">2</string>',
      '  <string name="c">3</string>',
      '</resources>',
      '',
    ].join('\n');
    const decls = scanner.collectValueKeyDeclarations(P, xml)
      .filter((d: any) => d.name !== 'b')
      .map((d: any) => mod.expandToWholeLines(xml, d.start, d.end))
      .sort((x: any, y: any) => y.start - x.start);
    let out = xml;
    for (const r of decls) out = out.slice(0, r.start) + out.slice(r.end);
    expect(out).toBe('<resources>\n  <string name="b">2</string>\n</resources>\n');
  });

  it('une clé absente du fichier ne produit aucune édition', () => {
    const xml = '<resources>\n  <string name="a">v</string>\n</resources>\n';
    expect(removeKey(xml, 'jamais_declaree')).toBe(xml);
  });
});
