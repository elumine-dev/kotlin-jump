import { describe, it, expect } from 'vitest';
import { organizeImports } from '../../src/providers/OrganizeImportsProvider';
import { expandPostfix } from '../../src/providers/PostfixCompletionProvider';
import { computeTripleStringMask } from '../../src/providers/SemanticTokensProvider';
import { coverageCandidatePaths } from '../../src/testing/GradleTestRunner';

// Audit 27 : complétion et imports, décorations, couverture Gradle.

function applyOrganize(text: string): string {
  const r = organizeImports(text, { removeUnused: true });
  if (!r) return text;
  const ls = text.split('\n');
  return [...ls.slice(0, r.firstLine), r.replacement, ...ls.slice(r.lastLine + 1)].join('\n');
}

describe('Organize Imports et les commentaires de bloc', () => {
  it('recopie un /* … */ du bloc d\'imports sans perdre sa ligne de fermeture', () => {
    const text = [
      'package p',
      '',
      'import a.B',
      '/* TODO remove these',
      '   once the migration lands */',
      'import e.F',
      '',
      'class X { val b = B(); val f = F() }',
    ].join('\n');
    const out = applyOrganize(text);
    expect(out).toContain('   once the migration lands */');
    // Le commentaire reste équilibré : autant d'ouvertures que de fermetures.
    expect((out.match(/\/\*/g) ?? []).length).toBe((out.match(/\*\//g) ?? []).length);
    expect(out).toContain('import a.B');
    expect(out).toContain('import e.F');
  });

  it('un import commenté dans un bloc /* */ n\'est pas trié comme un vrai import', () => {
    const text = [
      'package p',
      '',
      'import z.Z',
      '/*',
      'import m.M',
      '*/',
      'import a.A',
      '',
      'class X { val a = A(); val z = Z() }',
    ].join('\n');
    const out = applyOrganize(text);
    const lines = out.split('\n');
    // Le corps du commentaire est intact et n'a pas été déplacé par le tri.
    expect(lines.filter(l => l.trim() === 'import m.M').length).toBe(1);
    expect(out).toContain('/*');
    expect(out).toContain('*/');
    // Les deux vrais imports survivent, une fois chacun. Le tri ne les
    // rapproche pas : un commentaire scinde volontairement le bloc en groupes
    // triés séparément, pour qu'il reste au dessus de l'import qu'il commente.
    expect(lines.filter(l => l.trim() === 'import a.A').length).toBe(1);
    expect(lines.filter(l => l.trim() === 'import z.Z').length).toBe(1);
  });
});

describe('Postfix sur un appel sécurisé', () => {
  it('le ? du safe call ne part pas dans le modèle', () => {
    expect(expandPostfix('null', 'viewModel?')).toBe('if (viewModel == null) {\n    $0\n}');
    expect(expandPostfix('val', 'viewModel?')).toBe('val ${1:value} = viewModel');
    expect(expandPostfix('not', 'viewModel?')).toBe('!viewModel');
    expect(expandPostfix('for', 'items?')).toContain('for (item in items)');
  });

  it('let garde la forme ?.let, qui est justement celle qu\'on veut', () => {
    expect(expandPostfix('let', 'viewModel?')).toBe('viewModel?.let { $0 }');
    expect(expandPostfix('let', 'viewModel')).toBe('viewModel.let { $0 }');
  });

  it('un receveur avec des ? internes n\'est pas touché', () => {
    expect(expandPostfix('val', 'find(25)?.name?.length')).toBe('val ${1:value} = find(25)?.name?.length');
  });
});

describe('Masque des chaînes brutes', () => {
  const masked = (lines: string[], li: number) => computeTripleStringMask(lines).get(li);

  it('un """ dans un commentaire de ligne n\'ouvre pas de chaîne brute', () => {
    const lines = ['class A {', '    // exemple : """ttt"""', '    val x = 1', '}', 'class B'];
    expect(masked(lines, 2)).toBeUndefined();
    expect(masked(lines, 4)).toBeUndefined();
  });

  it('un """ dans un commentaire de bloc non plus, même sur plusieurs lignes', () => {
    const lines = ['/*', ' un """ ici', ' et un autre """ là', '*/', 'val y = 2', 'class C'];
    expect(masked(lines, 4)).toBeUndefined();
    expect(masked(lines, 5)).toBeUndefined();
  });

  it('une vraie chaîne brute est toujours masquée, et se referme', () => {
    const lines = ['val sql = """', '  SELECT 1', '"""', 'val after = 3'];
    expect(masked(lines, 1)).toEqual([[0, '  SELECT 1'.length]]);
    expect(masked(lines, 3)).toBeUndefined();
  });

  it('un """ après du code sur la même ligne qu\'un commentaire reste vu', () => {
    const lines = ['val s = """', 'x', '""" // fin', 'val z = 4'];
    expect(masked(lines, 1)).toEqual([[0, 1]]);
    expect(masked(lines, 3)).toBeUndefined();
  });
});

describe('Couverture Gradle', () => {
  it('le nom de classe est lu, pas le sourcefilename', () => {
    const re = /<class\s[^>]*?\bname="([^"]*)"[^>]*>/;
    expect(re.exec('<class name="com/example/news/Foo" sourcefilename="Foo.kt">')?.[1]).toBe('com/example/news/Foo');
    expect(re.exec('<class sourcefilename="Foo.kt" name="com/example/news/Foo">')?.[1]).toBe('com/example/news/Foo');
  });

  it('la source est cherchée sous le module, dans les source sets réels et pour les deux langages', () => {
    const paths = coverageCandidatePaths('com/example/news/Foo', '/proj/feature/news');
    expect(paths[0]).toBe('/proj/feature/news/src/main/kotlin/com/example/news/Foo.kt');
    expect(paths).toContain('/proj/feature/news/src/main/java/com/example/news/Foo.java');
    expect(paths).toContain('/proj/feature/news/src/commonMain/kotlin/com/example/news/Foo.kt');
  });

  it('une classe imbriquée retombe sur le fichier de sa classe englobante', () => {
    const paths = coverageCandidatePaths('com/example/Foo$Inner', '/proj/app');
    expect(paths[0]).toBe('/proj/app/src/main/kotlin/com/example/Foo.kt');
  });
});
