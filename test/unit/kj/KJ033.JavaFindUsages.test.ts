import { describe, it, expect, afterEach } from 'vitest';
import { workspace } from '../__mocks__/vscode';
import { SymbolIndex } from '../../../src/indexer/SymbolIndex';
import { parse } from '../../../src/indexer/KotlinParser';
import { parseJava } from '../../../src/indexer/JavaParser';
import { clearContentCache, scanForUsagesWithTarget } from '../../../src/providers/FindUsagesEngine';

/**
 * KJ-033 — le verrou de régression du bug Java.
 *
 * `parseJava` rendait `imports: []`, donc un fichier Java ne contribuait aucun
 * mot à l'index. `getFilesContainingWord` ne le retournait jamais, et
 * `scanForUsagesWithTarget` filtre dessus. Mesuré sur un vrai monorepo : une
 * interface Kotlin importée par 56 fichiers Java rendait 0 usage sur 56.
 *
 * C'est le test qui aurait attrapé le défaut d'origine.
 */

const TOKEN = { isCancellationRequested: false } as any;

/** Le moteur lit le disque : on lui sert le contenu des URIs fictives. */
function serve(contentByUri: Record<string, string>) {
  const original = workspace.fs.readFile;
  workspace.fs.readFile = async (uri: any) =>
    Buffer.from(contentByUri[String(uri.toString ? uri.toString() : uri)] ?? '') as any;
  restore = () => { workspace.fs.readFile = original; };
}
let restore: (() => void) | undefined;
afterEach(() => { restore?.(); restore = undefined; clearContentCache(); });

/** Un projet : une déclaration Kotlin, N consommateurs Java d'un autre package. */
function project(consumers: number) {
  const index = new SymbolIndex();
  const content: Record<string, string> = {};

  const declUri = 'file:///w/a/ConnectivityService.kt';
  const declText = [
    'package com.a',
    '',
    'interface ConnectivityService {',
    '    fun isOnline(): Boolean',
    '}',
    '',
  ].join('\n');
  index.add(parse(declUri, declText));
  content[declUri] = declText;

  const javaUris: string[] = [];
  for (let i = 0; i < consumers; i++) {
    const uri = `file:///w/b/Consumer${i}.java`;
    javaUris.push(uri);
    const javaText = [
      'package com.b;',
      '',
      'import com.a.ConnectivityService;',
      '',
      `public class Consumer${i} {`,
      '    private ConnectivityService service;',
      '    public boolean check() {',
      '        return service.isOnline();',
      '    }',
      '}',
      '',
    ].join('\n');
    index.add(parseJava(uri, javaText));
    content[uri] = javaText;
  }

  index.finalize();
  serve(content);
  return { index, declUri, javaUris };
}

describe('KJ-033 — Find Usages traverse la frontière Kotlin/Java', () => {
  it('les fichiers Java qui importent le symbole sont des candidats', () => {
    const { index, javaUris } = project(5);
    const target = index.lookup('ConnectivityService')[0];
    expect(target).toBeDefined();

    const candidates = index.getFilesContainingWord('ConnectivityService', target);
    expect(candidates, 'index de mots non prêt').not.toBeNull();
    for (const uri of javaUris) {
      expect(candidates!.has(uri), `fichier Java absent des candidats : ${uri}`).toBe(true);
    }
  });

  it('le scan rend un usage par consommateur Java', async () => {
    const { index, javaUris, declUri } = project(5);
    const target = index.lookup('ConnectivityService')[0];

    const results = await scanForUsagesWithTarget(
      'ConnectivityService', target, index,
      [declUri, ...javaUris], TOKEN,
    );

    const hitFiles = new Set(results.map(r => r.uriString).filter(u => u.endsWith('.java')));
    expect(hitFiles.size, 'des consommateurs Java sont invisibles').toBe(javaUris.length);
  });

  it('à l’échelle : 56 consommateurs, comme sur le monorepo mesuré', async () => {
    const { index, javaUris, declUri } = project(56);
    const target = index.lookup('ConnectivityService')[0];

    const results = await scanForUsagesWithTarget(
      'ConnectivityService', target, index,
      [declUri, ...javaUris], TOKEN,
    );

    const hitFiles = new Set(results.map(r => r.uriString).filter(u => u.endsWith('.java')));
    expect(hitFiles.size).toBe(56);
  });

  it('un fichier Java du MÊME package est trouvé même sans import', () => {
    const index = new SymbolIndex();
    index.add(parse('file:///w/a/Service.kt', 'package com.a\n\ninterface Service\n'));
    index.add(parseJava('file:///w/a/User.java', [
      'package com.a;',
      '',
      'public class User {',
      '    private Service s;',
      '}',
      '',
    ].join('\n')));
    index.finalize();

    const target = index.lookup('Service')[0];
    const candidates = index.getFilesContainingWord('Service', target);
    expect(candidates!.has('file:///w/a/User.java')).toBe(true);
  });

  it('un fichier Java sans rapport n’est pas un candidat', () => {
    const { index } = project(2);
    index.add(parseJava('file:///w/c/Unrelated.java', [
      'package com.c;',
      '',
      'import java.util.List;',
      '',
      'public class Unrelated {',
      '    private List<String> items;',
      '}',
      '',
    ].join('\n')));
    index.finalize();

    const target = index.lookup('ConnectivityService')[0];
    const candidates = index.getFilesContainingWord('ConnectivityService', target);
    expect(candidates!.has('file:///w/c/Unrelated.java')).toBe(false);
  });
});
