/**
 * Le filtre qui cache les sources de test depuis un fichier de production.
 *
 * Le depot porte DEUX predicats pour la meme question :
 *
 *  - `isTestPath`, qui ne connait que la liste configuree ;
 *  - `isTestSourceSet`, qui ajoute la convention Gradle, un source set sous
 *    `src/` dont le nom contient « test ».
 *
 * Le commentaire de cette convention dit qu'une liste configuree « ne peut
 * jamais suivre » : les vrais projets livrent `savedAndroidTest`,
 * `screenshotTest`, `sharedTest`, et un `test<Flavor>` par variante.
 *
 * Les detecteurs de code mort utilisent le predicat complet. `buildAllowFilter`,
 * dont dependent le compte d'implementations des lenses, l'auto import et la
 * hierarchie de types, n'utilisait que l'etroit. Mesure sur un projet reel de
 * 3187 fichiers Kotlin : 29 fichiers de test, 26 sous `savedAndroidTest` et 3
 * sous `sharedTest`, etaient donc traites comme de la production. Le cas le
 * plus grave est l'auto import, qui pouvait proposer d'importer une classe
 * declaree dans un source set de test : le fichier ne compile plus.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { workspace } from './__mocks__/vscode';
import { buildAllowFilter } from '../../src/util/testFilter';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { mockDocument } from './helpers';
import { Position } from './__mocks__/vscode';
import { SymbolIndex } from '../../src/indexer/SymbolIndex';
import { parse } from '../../src/indexer/KotlinParser';
import { KotlinDefinitionProvider } from '../../src/providers/DefinitionProvider';
import { classifyFile } from '../../src/providers/FindUsagesPanel';
import { Range, CodeActionTriggerKind } from './__mocks__/vscode';
import { AutoImportProvider } from '../../src/providers/AutoImportProvider';

const DEFAUTS = ['test/java', 'test/kotlin', 'androidTest', 'jvmTest', 'commonTest'];
const PROD = '/p/app/src/main/java/com/x/Ecran.kt';

afterEach(() => vi.restoreAllMocks());

/** Les reglages tels que VS Code les rend : le defaut du schema s'applique. */
function avecDefauts() {
  vi.spyOn(workspace, 'getConfiguration').mockReturnValue({
    get: (cle: string, defaut: any) => (cle === 'testSourceSets' ? DEFAUTS : defaut),
    update: async () => {},
  } as any);
}

describe('depuis un fichier de production', () => {
  it('un source set de test configure est cache', () => {
    avecDefauts();
    const allow = buildAllowFilter(PROD);
    expect(allow('/p/app/src/androidTest/java/com/x/EcranTest.kt')).toBe(false);
    expect(allow('/p/app/src/test/java/com/x/EcranTest.kt')).toBe(false);
  });

  it('un source set de test NON configure l est aussi', () => {
    // `savedAndroidTest` et `sharedTest` existent sur un vrai projet et ne
    // figurent dans aucune liste par defaut.
    avecDefauts();
    const allow = buildAllowFilter(PROD);
    expect(allow('/p/replica/app/src/savedAndroidTest/java/ca/T.kt'),
      'savedAndroidTest est un source set de test').toBe(false);
    expect(allow('/p/core/ui/src/sharedTest/java/nuglif/T.kt'),
      'sharedTest aussi').toBe(false);
  });

  it('mais la production reste visible', () => {
    avecDefauts();
    const allow = buildAllowFilter(PROD);
    expect(allow('/p/core/ui/src/main/java/nuglif/Autre.kt')).toBe(true);
    // `src/testing/` n'est pas un source set : c'est du code de production
    // qui parle de tests. La convention Gradle vise `src/<nom>/`, et
    // `testing` contient bien « test »... donc il est traite comme un test.
    // Assume : mieux vaut cacher un peu trop que proposer un import qui
    // casse le build.
    expect(allow('/p/app/src/main/java/com/x/testing/Util.kt'),
      'un paquet nomme testing sous src/main reste de la production').toBe(true);
  });
});

describe('depuis un fichier de test', () => {
  it('tout est visible, test compris', () => {
    avecDefauts();
    const allow = buildAllowFilter('/p/app/src/androidTest/java/com/x/EcranTest.kt');
    expect(allow('/p/app/src/main/java/com/x/Ecran.kt')).toBe(true);
    expect(allow('/p/app/src/androidTest/java/com/x/Autre.kt')).toBe(true);
  });

  it('y compris depuis un source set non configure', () => {
    avecDefauts();
    const allow = buildAllowFilter('/p/replica/app/src/savedAndroidTest/java/ca/T.kt');
    expect(allow('/p/app/src/androidTest/java/com/x/Autre.kt'),
      'un test peut en voir un autre').toBe(true);
  });
});

/**
 * Les deux consommateurs que le correctif d'origine avait oublies.
 *
 * `buildAllowFilter` est passe au predicat complet, mais `DefinitionProvider`
 * ne l'appelait pas : il refaisait la meme regle a la main, avec `isTestPath`.
 * `FindUsagesPanel` classe ses fichiers avec le meme predicat etroit.
 *
 * Mesure sur le meme projet reel, 419 fichiers de production echantillonnes et
 * 65 161 clics : 327 cibles dans un source set de test sont correctement
 * ecartees, et 101 ne le sont pas. Cliquer `attributeStarts` depuis
 * `ParagraphBuilder.java` ouvrait `AttributeContainsTest.java`.
 */
describe('les autres consommateurs de la meme regle', () => {
  const TEST_NON_LISTE = '/p/app/src/savedAndroidTest/java/com/x/AideTest.kt';

  it('Go to Definition ne mene pas dans un source set de test non configure', async () => {
    avecDefauts();
    const NL = String.fromCharCode(10);
    const aide  = ['package com.x', '', 'class AideDeTest', '', 'fun brancherLeDouble() {}'].join(NL);
    const appel = ['package com.x', '', 'fun vrai() {', '    brancherLeDouble()', '}'].join(NL);

    const index = new SymbolIndex();
    index.add(parse('file://' + TEST_NON_LISTE, aide));
    index.add(parse('file://' + PROD, appel));
    index.finalize();

    vi.spyOn(workspace, 'openTextDocument').mockImplementation(async (u: any) => {
      const uri = typeof u === 'string' ? u : (u?.toString?.() ?? String(u));
      if (uri === 'file://' + TEST_NON_LISTE) return mockDocument(uri, aide) as any;
      if (uri === 'file://' + PROD) return mockDocument(uri, appel) as any;
      return null;
    });

    const r: any = await new KotlinDefinitionProvider(index).provideDefinition(
      mockDocument('file://' + PROD, appel) as any,
      new Position(3, 6) as any,
      { isCancellationRequested: false } as any,
    );
    const cibles = (Array.isArray(r) ? r : r ? [r] : []).map((l: any) => String(l.uri.path));
    expect(cibles, 'un fichier de production ne doit pas etre envoye dans un test').not.toContain(TEST_NON_LISTE);
  });

  it('Find Usages classe un source set de test non configure comme test', () => {
    expect(classifyFile(TEST_NON_LISTE, DEFAUTS)).toBe('test');
    expect(classifyFile('/p/app/src/sharedTest/java/com/x/Base.kt', DEFAUTS)).toBe('test');
  });

  it('et laisse la production et les apercus ou ils sont', () => {
    expect(classifyFile(PROD, DEFAUTS)).toBe('production');
    expect(classifyFile('/p/app/src/test/java/com/x/VraiTest.kt', DEFAUTS)).toBe('test');
    expect(classifyFile('/p/app/src/debug/java/com/x/EcranPreview.kt', DEFAUTS)).toBe('preview');
  });
});

/**
 * Le gardien : `isTestPath` seul ne doit plus decider, dans `src/`, si un
 * chemin est un test. C'est precisement la copie qui a derive. Les aiguilles
 * sont assemblees a l'execution pour que ce fichier ne se satisfasse pas
 * lui meme.
 */
describe('plus aucune copie etroite dans src/', () => {
  it('aucun fichier de src ne decide avec le predicat etroit', () => {
    const racine = path.resolve(__dirname, '..', '..', 'src');
    const aiguille = 'isTest' + 'Path(';
    const coupables: string[] = [];
    const visiter = (dir: string) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) { visiter(p); continue; }
        if (!e.name.endsWith('.ts')) continue;
        if (p.endsWith('/util/testPaths.ts') || p.endsWith('/util/testFilter.ts')) continue;
        if (fs.readFileSync(p, 'utf8').includes(aiguille)) coupables.push(p.slice(racine.length + 1));
      }
    };
    visiter(racine);
    expect(coupables, 'ces fichiers doivent passer par isTestSourceSet').toEqual([]);
  });
});

/**
 * L'auto import, que le correctif d'origine donnait comme le cas le plus grave
 * (« le fichier ne compile plus »), n'avait aucun test au niveau du
 * fournisseur. Preuve par mutation : un `buildAllowFilter` qui rend toujours
 * vrai ne faisait tomber que deux fichiers sur 391, et aucun des quatre
 * fournisseurs qui en dependent.
 */
describe("l'auto import n'offre pas ce qui ne compilerait pas", () => {
  const NL = String.fromCharCode(10);
  const AIDE = ['package com.aide', '', 'class AideDeTest'].join(NL);
  const USAGE = ['package com.y', '', 'fun go() {', '    val a = AideDeTest()', '}'].join(NL);
  const TEST_NON_LISTE = '/p/app/src/savedAndroidTest/java/com/aide/AideTest.kt';

  function propositions(depuis: string): string[] {
    avecDefauts();
    const index = new SymbolIndex();
    index.add(parse('file://' + TEST_NON_LISTE, AIDE));
    index.add(parse('file://' + depuis, USAGE));
    index.finalize();
    const doc = mockDocument('file://' + depuis, USAGE) as any;
    const col = USAGE.split(NL)[3].indexOf('AideDeTest');
    const actions = new AutoImportProvider(index).provideCodeActions(
      doc,
      new Range(new Position(3, col) as any, new Position(3, col) as any) as any,
      { triggerKind: CodeActionTriggerKind.Invoke, diagnostics: [] } as any,
      {} as any,
    );
    return (actions ?? []).map(a => String(a.title));
  }

  it('depuis la production, rien venu d un source set de test non configure', () => {
    expect(propositions(PROD)).toEqual([]);
  });

  it('mais depuis un fichier de test, la proposition revient', () => {
    expect(propositions('/p/app/src/androidTest/java/com/y/GoTest.kt'))
      .toEqual(["Add import 'com.aide.AideDeTest'"]);
  });
});
