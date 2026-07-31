import { describe, it, expect, afterEach } from 'vitest';
import { workspace } from '../__mocks__/vscode';
import { SymbolIndex } from '../../../src/indexer/SymbolIndex';
import { parse } from '../../../src/indexer/KotlinParser';
import { parseJava } from '../../../src/indexer/JavaParser';
import { clearContentCache, scanForUsagesWithTarget, scanImports } from '../../../src/providers/FindUsagesEngine';
import { computeFileRename } from '../../../src/providers/RenameProvider';

/**
 * KJ-033 — le test de SÛRETÉ du rename.
 *
 * Rename lance deux scans : `scanForUsages`, pré-filtré par l'index de mots,
 * et `scanImports`, qui ne l'est PAS. Tant que les fichiers Java ne
 * contribuaient aucun mot, renommer une classe Kotlin réécrivait leurs lignes
 * d'import sans toucher les corps : 56 fichiers dont l'en-tête pointait le
 * nouveau nom et le code l'ancien. Une corruption, pas un oubli.
 *
 * Ce test exige que les deux moitiés couvrent le même ensemble de fichiers.
 */

const TOKEN = { isCancellationRequested: false } as any;

let restore: (() => void) | undefined;
afterEach(() => { restore?.(); restore = undefined; clearContentCache(); });

function project(consumers: number) {
  const index = new SymbolIndex();
  const content: Record<string, string> = {};

  const declUri = 'file:///w/a/PaymentGateway.kt';
  const declText = 'package com.a\n\nclass PaymentGateway {\n    fun charge() {}\n}\n';
  index.add(parse(declUri, declText));
  content[declUri] = declText;

  const javaUris: string[] = [];
  for (let i = 0; i < consumers; i++) {
    const uri = `file:///w/b/Caller${i}.java`;
    javaUris.push(uri);
    const text = [
      'package com.b;',
      '',
      'import com.a.PaymentGateway;',
      '',
      `public class Caller${i} {`,
      '    private final PaymentGateway gateway = new PaymentGateway();',
      '    void run() { gateway.charge(); }',
      '}',
      '',
    ].join('\n');
    index.add(parseJava(uri, text));
    content[uri] = text;
  }

  index.finalize();
  const original = workspace.fs.readFile;
  workspace.fs.readFile = async (uri: any) =>
    Buffer.from(content[String(uri.toString ? uri.toString() : uri)] ?? '') as any;
  restore = () => { workspace.fs.readFile = original; };

  return { index, declUri, javaUris };
}

describe('KJ-033 — renommer une classe Kotlin utilisée depuis Java', () => {
  it('les deux moitiés du rename couvrent les mêmes fichiers Java', async () => {
    const { index, declUri, javaUris } = project(8);
    const target = index.lookup('PaymentGateway')[0];
    const all = [declUri, ...javaUris];

    const [bodies, imports] = await Promise.all([
      scanForUsagesWithTarget('PaymentGateway', target, index, all, TOKEN),
      scanImports('PaymentGateway', index, all, TOKEN),
    ]);

    const bodyFiles = new Set(bodies.map(r => r.uriString).filter(u => u.endsWith('.java')));
    const importFiles = new Set(imports.map(r => r.uriString).filter(u => u.endsWith('.java')));

    // Le cœur du test : un fichier dont on réécrit l'import DOIT voir son corps
    // réécrit aussi, sinon le rename le laisse cassé.
    for (const f of importFiles) {
      expect(bodyFiles.has(f), `import réécrit mais corps ignoré : ${f}`).toBe(true);
    }
    expect(importFiles.size).toBe(javaUris.length);
  });

  it('chaque usage dans le corps est atteint, pas seulement l’import', async () => {
    const { index, declUri, javaUris } = project(3);
    const target = index.lookup('PaymentGateway')[0];

    const results = await scanForUsagesWithTarget(
      'PaymentGateway', target, index, [declUri, ...javaUris], TOKEN);

    for (const uri of javaUris) {
      const inFile = results.filter(r => r.uriString === uri);
      // deux occurrences dans le corps : le type du champ et le constructeur
      expect(inFile.length, `usages manquants dans ${uri}`).toBeGreaterThanOrEqual(2);
    }
  });
});

describe('KJ-033 — le fichier compagnon', () => {
  it('renomme Foo.java quand la classe Foo est renommée', () => {
    const index = new SymbolIndex();
    index.add(parseJava('file:///w/a/Foo.java', 'package com.a;\n\npublic class Foo {}\n'));
    index.finalize();

    const entry = index.lookup('Foo')[0];
    expect(String(computeFileRename(entry, 'Bar', index))).toContain('Bar.java');
  });

  it('renomme toujours Foo.kt pour une classe Kotlin', () => {
    const index = new SymbolIndex();
    index.add(parse('file:///w/a/Foo.kt', 'package com.a\n\nclass Foo\n'));
    index.finalize();

    const entry = index.lookup('Foo')[0];
    expect(String(computeFileRename(entry, 'Bar', index))).toContain('Bar.kt');
  });

  it('ne renomme pas quand le nom du fichier ne suit pas la classe', () => {
    const index = new SymbolIndex();
    index.add(parseJava('file:///w/a/Helpers.java', 'package com.a;\n\npublic class Foo {}\n'));
    index.finalize();

    const entry = index.lookup('Foo')[0];
    expect(computeFileRename(entry, 'Bar', index)).toBeNull();
  });

  it('ne renomme pas une extension inconnue', () => {
    const index = new SymbolIndex();
    index.add(parseJava('file:///w/a/Foo.jav', 'package com.a;\n\npublic class Foo {}\n'));
    index.finalize();

    const entry = index.lookup('Foo')[0];
    expect(computeFileRename(entry, 'Bar', index)).toBeNull();
  });
});
