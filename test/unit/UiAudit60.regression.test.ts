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

describe('Les objets anonymes ne consomment pas le plafond de resultats', () => {
  // Le filtre de la v1.42.84 s'appliquait APRES le plafond de 200 de
  // `index.search`. Sur LaPresse, « anon » remplissait le plafond de 199
  // symboles synthetiques, et la classe reelle dont le nom les contient au
  // milieu ne passait pas. Le depot ecarte deja les locaux DANS `search`,
  // pour cette raison exacte.
  function indexSature(): SymbolIndex {
    const index = new SymbolIndex();
    // 250 objets anonymes : au dela du plafond de 200.
    const lignes = ['package p', '', 'class Sature {'];
    for (let i = 0; i < 250; i++) {
      lignes.push(`    val h${i} = object : Listener${i} {}`);
    }
    lignes.push('}');
    index.add(parse('file:///a60b/Sature.kt', lignes.join('\n')));
    // Une vraie classe dont le nom contient « anon » AU MILIEU : elle ne
    // correspond que par sous chaine, donc elle passe apres les prefixes.
    index.add(parse('file:///a60b/Aide.kt', 'package p\n\nclass MyAnonHelper\n'));
    index.finalize();
    return index;
  }

  it('l\'index en produit bien plus de 200, sinon le test ne prouve rien', () => {
    const index = indexSature();
    const brut = index.getFileSymbols('file:///a60b/Sature.kt').filter(e => e.name.startsWith('$anon$'));
    expect(brut.length).toBe(250);
  });

  it('une classe dont le nom contient anon au milieu reste atteignable', () => {
    const index = indexSature();
    const r = (new KotlinFileProvider(index).provideWorkspaceSymbols('anon') as any[]) ?? [];
    expect(r.map(s => s.name)).toContain('MyAnonHelper');
  });

  it('@object: ne gaspille pas sa limite non plus', () => {
    const index = indexSature();
    index.add(parse('file:///a60b/Reel.kt', 'package p\n\nobject VraiSingleton\n'));
    index.finalize();
    const r = (new KotlinFileProvider(index).provideWorkspaceSymbols('@object:') as any[]) ?? [];
    expect(r.map(s => s.name)).toContain('VraiSingleton');
    expect(r.some(s => s.name.startsWith('$anon$'))).toBe(false);
  });
});
