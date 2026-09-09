import { describe, it, expect } from 'vitest';
import { parse } from '../../src/indexer/KotlinParser';
import { SymbolIndex } from '../../src/indexer/SymbolIndex';
import { KotlinDocumentSymbolProvider } from '../../src/providers/DocumentSymbolProvider';
import { bodyEndLine, rangeEndLine } from '../../src/util/symbolRanges';

// Audit 62 : un symbole declare sur la MEME ligne qu'un autre ne peut pas
// clore le corps de celui ci. `rangeEndLine` s'arrete au symbole suivant de
// profondeur inferieure ou egale, et pour `val x = object : L {` ce suivant est
// la propriete elle meme, sur la meme ligne : l'objet anonyme etait donc borne
// a une ligne. Ses `override` sortaient de lui dans l'Outline, et son repli ne
// repliait rien. 111 objets anonymes sur les 3187 fichiers de LaPresse.

const URI = 'file:///a62/Holder.kt';
const CODE = [
  'package p',
  '',
  'class Holder {',
  '    val observateur = object : DefaultLifecycleObserver {',
  '        override fun onStart(owner: LifecycleOwner) {}',
  '',
  '        override fun onStop(owner: LifecycleOwner) {}',
  '    }',
  '',
  '    fun apres() {}',
  '}',
].join('\n');

function doc(uri: string, texte: string): any {
  const l = texte.split('\n');
  return {
    uri: { toString: () => uri, path: uri.replace('file://', '') },
    languageId: 'kotlin', version: 1, isDirty: false, lineCount: l.length,
    getText: () => texte,
    lineAt: (n: number) => ({ text: l[n] ?? '', range: { end: { line: n, character: (l[n] ?? '').length } } }),
  };
}

describe('Un symbole de la meme ligne ne clot pas le corps du precedent', () => {
  it('la fixture met bien deux symboles sur la ligne de l\'objet', () => {
    // Sans cela le test ne prouverait rien : c'est l'ordre d'emission qui cree
    // le probleme, l'objet anonyme etant pousse avant la propriete.
    const surLaLigne = parse(URI, CODE).symbols.filter(s => s.line === 3).map(s => s.name);
    expect(surLaLigne.length).toBe(2);
    expect(surLaLigne[0].startsWith('$anon$')).toBe(true);
  });

  it('le plafond de l\'objet anonyme depasse sa propre ligne', () => {
    const syms = parse(URI, CODE).symbols;
    const i = syms.findIndex(s => s.name.startsWith('$anon$'));
    expect(rangeEndLine(syms, i, CODE.split('\n').length - 1)).toBeGreaterThan(3);
  });

  it('son etendue va jusqu\'a son accolade fermante', () => {
    const lignes = CODE.split('\n');
    const syms = parse(URI, CODE).symbols;
    const i = syms.findIndex(s => s.name.startsWith('$anon$'));
    expect(bodyEndLine(lignes, syms, i, lignes.length - 1)).toBe(7);
  });

  it('la propriete porte les override, sans doublon a cote d\'elle', () => {
    const index = new SymbolIndex();
    index.add(parse(URI, CODE));
    index.finalize();
    const arbre = new KotlinDocumentSymbolProvider(index).provideDocumentSymbols(doc(URI, CODE), {} as any);
    const classe = arbre.find(n => n.name === 'Holder')!;
    // Un seul noeud pour cette ligne : le nom ecrit par l'auteur.
    expect(classe.children.map(n => n.name)).toEqual(['observateur', 'apres']);
    const prop = classe.children[0];
    expect(prop.children.map(n => n.name).sort()).toEqual(['onStart', 'onStop']);
    expect(prop.range.end.line).toBe(7);
  });

  it('un objet anonyme sans propriete garde son libelle', () => {
    const code = [
      'package p',
      '',
      'class Vue {',
      '    fun attacher(v: View) {',
      '        v.addListener(object : Listener {',
      '            override fun onEvent() {}',
      '        })',
      '    }',
      '}',
    ].join('\n');
    const index = new SymbolIndex();
    index.add(parse(URI, code));
    index.finalize();
    const arbre = new KotlinDocumentSymbolProvider(index).provideDocumentSymbols(doc(URI, code), {} as any);
    const tous = (ns: any[]): string[] => ns.flatMap(n => [n.name, ...tous(n.children ?? [])]);
    expect(tous(arbre)).toContain('object : Listener');
  });

  it('un vrai frere sur une autre ligne borne toujours', () => {
    const code = ['package p', '', 'class C {', '    val a = 1', '    val b = 2', '}'].join('\n');
    const syms = parse(URI, code).symbols;
    const i = syms.findIndex(s => s.name === 'a');
    expect(rangeEndLine(syms, i, code.split('\n').length - 1)).toBe(3);
  });
});
