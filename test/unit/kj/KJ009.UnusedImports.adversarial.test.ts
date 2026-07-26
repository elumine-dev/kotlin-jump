import { describe, it, expect } from 'vitest';
import {
  findUnusedImports,
  sanitizeForUsageScan,
  UnusedImportCodeActionProvider,
} from '../../../src/providers/UnusedImportProvider';
import { Range } from '../../unit/__mocks__/vscode';

/** KJ-009 — tentatives de casse au-delà du contrat. */

describe('KJ-009 adversarial', () => {
  it('usage UNIQUEMENT dans un template ${…} : compte comme usage', () => {
    const text = 'import com.x.User\nval s = "hello ${User.name}"\n';
    expect(findUnusedImports(text)).toHaveLength(0);
  });

  it('« Users » ne compte pas comme usage de « User » (frontière de mot)', () => {
    const text = 'import com.x.User\nval all = Users.fetch()\n';
    expect(findUnusedImports(text)).toHaveLength(1);
  });

  it('référence KDoc [User] = commentaire → flagué quand même', () => {
    const text = 'import com.x.User\n/** voir [User] pour le modèle */\nfun f() = 1\n';
    expect(findUnusedImports(text)).toHaveLength(1);
  });

  it('import avec commentaire de fin de ligne parsé correctement', () => {
    const text = 'import com.x.Foo // gardé pour plus tard\nval y = 2\n';
    const unused = findUnusedImports(text);
    expect(unused).toHaveLength(1);
    expect(unused[0].statement).toContain('import com.x.Foo');
  });

  it('usage en qualificateur (User.EMPTY) compte', () => {
    const text = 'import com.x.User\nval e = User.EMPTY\n';
    expect(findUnusedImports(text)).toHaveLength(0);
  });

  it('string avec guillemet échappé ne déraille pas le scanner', () => {
    const text = 'import com.x.Foo\nval s = "dit \\"Foo\\" fort"\nval t = 3\n';
    // Foo n'apparaît QUE dans la string → flagué
    expect(findUnusedImports(text)).toHaveLength(1);
  });

  it('fichier sans import → [] sans crash', () => {
    expect(findUnusedImports('fun main() {}')).toEqual([]);
  });

  it('BUG-HUNT-4 : mention dans un char literal ne compte pas comme usage', () => {
    // `val c = 'A'` ne doit pas sauver `import x.y as A` — les chars
    // n'étaient pas blanchis par le scanner.
    const text = "import com.x.Thing as A\nval c = 'A'\nval d = 2\n";
    expect(findUnusedImports(text)).toHaveLength(1);
  });

  it('BUG-HUNT-4b : char échappé et apostrophe encadrée survivent au scanner', () => {
    const text = "import com.x.Used\nval q = '\\''\nval u = Used()\n";
    expect(findUnusedImports(text)).toHaveLength(0);
  });

  it('sanitize préserve les longueurs (mapping des positions)', () => {
    const text = 'val s = "abc ${x} def" // com\nval y = 2';
    expect(sanitizeForUsageScan(text).length).toBe(text.length);
  });

  it('quick fix « Remove all unused imports » supprime les bonnes lignes, ordre décroissant', () => {
    const text = 'import com.x.Used\nimport com.x.Dead1\nimport com.x.Dead2\nval u = Used()\n';
    const doc = {
      languageId: 'kotlin',
      getText: () => text,
      uri: { toString: () => 'file:///t.kt' },
    } as any;
    const provider = new UnusedImportCodeActionProvider();
    const actions = provider.provideCodeActions(doc, new Range(3, 0, 3, 0) as any);

    const all = actions.find(a => a.title.startsWith('Remove all'));
    expect(all?.title).toBe('Remove all unused imports (2)');
    const ranges = (all!.edit as any).entries().map((e: any) => e.range.start.line);
    expect(ranges).toEqual([2, 1]); // décroissant : pas de décalage d'index
  });

  it('quick fix individuel proposé seulement sur la ligne d’un import grisé', () => {
    const text = 'import com.x.Dead\nval y = 2\n';
    const doc = {
      languageId: 'kotlin',
      getText: () => text,
      uri: { toString: () => 'file:///t.kt' },
    } as any;
    const provider = new UnusedImportCodeActionProvider();

    const onImport = provider.provideCodeActions(doc, new Range(0, 3, 0, 3) as any);
    expect(onImport.some(a => a.title === 'Remove unused import')).toBe(true);

    const elsewhere = provider.provideCodeActions(doc, new Range(1, 0, 1, 0) as any);
    expect(elsewhere.some(a => a.title === 'Remove unused import')).toBe(false);
    expect(elsewhere.some(a => a.title.startsWith('Remove all'))).toBe(true);
  });

  it('aucune action quand tous les imports servent', () => {
    const text = 'import com.x.Used\nval u = Used()\n';
    const doc = {
      languageId: 'kotlin',
      getText: () => text,
      uri: { toString: () => 'file:///t.kt' },
    } as any;
    expect(new UnusedImportCodeActionProvider().provideCodeActions(doc, new Range(0, 0, 0, 0) as any)).toEqual([]);
  });

  it('gros fichier : 3000 lignes avec 50 imports < 300 ms', () => {
    const imports = Array.from({ length: 50 }, (_, i) => `import com.pkg.Class${i}`).join('\n');
    const body = Array.from({ length: 3000 }, (_, i) => `val v${i} = Class${i % 50}()`).join('\n');
    const start = performance.now();
    expect(findUnusedImports(`${imports}\n${body}`)).toHaveLength(0);
    expect(performance.now() - start).toBeLessThan(300);
  });
});
