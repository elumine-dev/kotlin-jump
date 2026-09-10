import { describe, it, expect } from 'vitest';
import { parse } from '../../src/indexer/KotlinParser';
import { SymbolIndex } from '../../src/indexer/SymbolIndex';
import { handleGetFileSymbols } from '../../src/server/mcp';

// Audit 66 : `get_file_symbols` normalisait le chemin a la main, sans resoudre
// ni `.` ni `..` ni les doubles barres, et sans racine pour un chemin relatif.
// Quatre formes sur sept rendaient un tableau vide, que l'agent ne peut pas
// distinguer d'un fichier sans symbole. Le chemin relatif est justement celui
// qu'un agent manipule, puisque c'est ainsi qu'il lit et ecrit les fichiers.

const RACINE = '/proj';
const CHEMIN = '/proj/app/src/main/kotlin/Depot.kt';
const CODE = 'package p\n\ninterface Depot {\n    fun lire(): String\n}\n';

function indexDe(): SymbolIndex {
  const index = new SymbolIndex();
  index.add(parse('file://' + CHEMIN, CODE));
  index.finalize();
  return index;
}

describe('get_file_symbols accepte les formes de chemin qu\'un agent produit', () => {
  const attendu = ['Depot', 'lire'];

  it('URI complete, telle qu\'indexee', () => {
    expect(handleGetFileSymbols(indexDe(), 'file://' + CHEMIN).map(s => s.name)).toEqual(attendu);
  });

  it('chemin absolu nu', () => {
    expect(handleGetFileSymbols(indexDe(), CHEMIN).map(s => s.name)).toEqual(attendu);
  });

  it('chemin relatif a la racine du projet', () => {
    expect(handleGetFileSymbols(indexDe(), 'app/src/main/kotlin/Depot.kt', RACINE).map(s => s.name))
      .toEqual(attendu);
  });

  it('chemin avec un segment point', () => {
    expect(handleGetFileSymbols(indexDe(), '/proj/./app/src/main/kotlin/Depot.kt').map(s => s.name))
      .toEqual(attendu);
  });

  it('chemin avec un segment deux points', () => {
    expect(handleGetFileSymbols(indexDe(), '/proj/app/autre/../src/main/kotlin/Depot.kt').map(s => s.name))
      .toEqual(attendu);
  });

  it('double barre au milieu', () => {
    expect(handleGetFileSymbols(indexDe(), '/proj//app/src/main/kotlin/Depot.kt').map(s => s.name))
      .toEqual(attendu);
  });

  it('un fichier reellement absent rend toujours un tableau vide', () => {
    expect(handleGetFileSymbols(indexDe(), '/proj/app/Inexistant.kt')).toEqual([]);
  });

  it('un chemin relatif sans racine ne devine pas', () => {
    expect(handleGetFileSymbols(indexDe(), 'app/src/main/kotlin/Depot.kt')).toEqual([]);
  });

  it('un chemin contenant un espace, encode ou non', () => {
    const index = new SymbolIndex();
    index.add(parse('file:///proj/Mon%20Fichier.kt', 'package p\n\nclass Espace\n'));
    index.finalize();
    // Le test existant McpServer E4 avait attrape une premiere version de ce
    // correctif qui encodait le %20 une seconde fois.
    expect(handleGetFileSymbols(index, 'file:///proj/Mon%20Fichier.kt').map(s => s.name)).toEqual(['Espace']);
    expect(handleGetFileSymbols(index, '/proj/Mon Fichier.kt').map(s => s.name)).toEqual(['Espace']);
    expect(handleGetFileSymbols(index, 'Mon Fichier.kt', '/proj').map(s => s.name)).toEqual(['Espace']);
  });
});
