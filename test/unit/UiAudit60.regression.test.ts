import { describe, it, expect } from 'vitest';
import { parse } from '../../src/indexer/KotlinParser';
import { SymbolIndex } from '../../src/indexer/SymbolIndex';
import { KotlinDocumentSymbolProvider } from '../../src/providers/DocumentSymbolProvider';
import { KotlinFileProvider } from '../../src/providers/FileProvider';

// Audit 60 : `$anon$<ligne>` est le nom synthetique que le parseur donne a un
// `object : Interface`, pour que le compte d'implementations le voie. Rien ne
// l'empechait d'atteindre l'ecran :
//   - 275 noeuds `$anon$25` dans le panneau Outline et le fil d'Ariane, sur
//     172 fichiers de LaPresse ;
//   - Cmd+T sur « anon » : 200 resultats sur 200 sont synthetiques, donc une
//     classe reellement nommee AnonymousUser devient introuvable ;
//   - « @object: » : 37 des 122 resultats.
// La v1.42.78 en a ajoute 78 de plus en elargissant la detection.

const URI = 'file:///a60/Ecran.kt';
const CODE = [
  'package p',
  '',
  'interface Listener {',
  '    fun onEvent()',
  '}',
  '',
  'class Ecran {',
  '    fun attacher(v: View) {',
  '        v.addListener(object : Listener {',
  '            override fun onEvent() {}',
  '        })',
  '        v.observer.add(object : ViewTreeObserver.OnPreDrawListener {',
  '            override fun onPreDraw() = true',
  '        })',
  '    }',
  '}',
].join('\n');

function indexDe(codes: Record<string, string>): SymbolIndex {
  const index = new SymbolIndex();
  for (const [uri, code] of Object.entries(codes)) index.add(parse(uri, code));
  index.finalize();
  return index;
}

function doc(uri: string, texte: string): any {
  const l = texte.split('\n');
  return {
    uri: { toString: () => uri, path: uri.replace('file://', '') },
    languageId: 'kotlin', version: 1, isDirty: false, lineCount: l.length,
    getText: () => texte,
    lineAt: (n: number) => ({ text: l[n] ?? '', range: { end: { line: n, character: (l[n] ?? '').length } } }),
  };
}

function tousLesNoeuds(noeuds: any[]): any[] {
  return noeuds.flatMap(n => [n, ...tousLesNoeuds(n.children ?? [])]);
}

describe('Aucun nom synthetique n\'atteint l\'ecran', () => {
  it('l\'Outline libelle l\'objet anonyme par son supertype', () => {
    const index = indexDe({ [URI]: CODE });
    const arbre = new KotlinDocumentSymbolProvider(index).provideDocumentSymbols(doc(URI, CODE), {} as any);
    const noms = tousLesNoeuds(arbre).map(n => n.name);
    expect(noms.some(n => n.startsWith('$anon$'))).toBe(false);
    expect(noms).toContain('object : Listener');
    // Le qualificateur est reconstitue tel qu'il est ecrit dans le code.
    expect(noms).toContain('object : ViewTreeObserver.OnPreDrawListener');
  });

  it('la plage de selection couvre le mot cle, pas un nom qui n\'existe pas', () => {
    const index = indexDe({ [URI]: CODE });
    const arbre = new KotlinDocumentSymbolProvider(index).provideDocumentSymbols(doc(URI, CODE), {} as any);
    const anon = tousLesNoeuds(arbre).find(n => n.name === 'object : Listener')!;
    const ligne = CODE.split('\n')[anon.selectionRange.start.line];
    expect(ligne.slice(anon.selectionRange.start.character, anon.selectionRange.end.character)).toBe('object');
  });

  it('Cmd+T ne propose pas les objets anonymes', () => {
    const index = indexDe({ [URI]: CODE });
    const p = new KotlinFileProvider(index);
    for (const requete of ['anon', '$anon', '@object:']) {
      const r = (p.provideWorkspaceSymbols(requete) as any[]) ?? [];
      expect(r.filter(s => s.name.startsWith('$anon$'))).toEqual([]);
    }
  });

  it('une vraie classe dont le nom contient anon reste trouvable', () => {
    const index = indexDe({
      [URI]: CODE,
      'file:///a60/Utilisateur.kt': 'package p\n\nclass AnonymousUser\n',
    });
    const r = (new KotlinFileProvider(index).provideWorkspaceSymbols('anon') as any[]) ?? [];
    expect(r.map(s => s.name)).toContain('AnonymousUser');
  });

  it('l\'index continue de compter l\'objet anonyme comme implementation', () => {
    const index = indexDe({ [URI]: CODE });
    const listener = index.lookup('Listener').find(e => e.kind === 'interface')!;
    expect(index.lookupImplementationsDeep(listener)).toHaveLength(1);
  });
});
