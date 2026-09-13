import { describe, it, expect, vi, afterEach } from 'vitest';
import * as vscodeMock from '../__mocks__/vscode';
import { removeTestOnlyCodeCommand } from '../../../src/commands/RemoveTestOnlyCode';

/**
 * Le compte rendu de la co-suppression compte ce qui est parti.
 *
 * Il lisait `scan.offered` et `scan.testFunctions`, deux comptes figes au
 * moment du scan, alors que la commande construit son edition APRES le clic et
 * ecarte a ce moment-la les fichiers qui ont bouge. Elle sait meme combien elle
 * en a ecartes, puisqu elle avertit juste en dessous.
 *
 * Le commentaire deux lignes au dessus de la phrase fautive enonce la regle :
 * ce qui est APPLIQUE est ce qui doit etre RAPPORTE. Le dialogue a ete mis
 * d accord avec elle il y a cinq versions, la phrase du dessous non.
 */

const SUJET1 = '/w/app/src/main/java/p/Sujet1.kt';
const SUJET2 = '/w/app/src/main/java/p/Sujet2.kt';
const SOURCES = [
  // Chaque fichier garde une classe vivante, sinon il serait vide et parti en
  // entier : la coupe par plage, celle qui peut etre refusee, n aurait pas lieu.
  { path: SUJET1, text: 'package p\n\nclass Sujet1 {\n    fun utilise() = 1\n}\n\nclass Garde1 {\n    fun g() = 1\n}\n' },
  { path: SUJET2, text: 'package p\n\nclass Sujet2 {\n    fun utilise() = 2\n}\n\nclass Garde2 {\n    fun g() = 2\n}\n' },
  { path: '/w/app/src/main/java/p/Main.kt', text: 'package p\n\nfun main() {\n    println(Garde1().g() + Garde2().g())\n}\n' },
  { path: '/w/app/build.gradle', text: "plugins { id 'com.android.application' }\n" },
  {
    path: '/w/app/src/test/java/p/Sujet1Test.kt',
    text: 'package p\n\nimport org.junit.Test\n\nclass Sujet1Test {\n    @Test\n    fun premier() {\n        Sujet1().utilise()\n    }\n}\n',
  },
  {
    path: '/w/app/src/test/java/p/Sujet2Test.kt',
    text: 'package p\n\nimport org.junit.Test\n\nclass Sujet2Test {\n    @Test\n    fun second() {\n        Sujet2().utilise()\n    }\n}\n',
  },
];

afterEach(() => vi.restoreAllMocks());

async function lanceAvec(sources: { path: string; text: string }[]) {
  return lanceSur(sources, false);
}

async function lance(bougeSujet2: boolean) {
  return lanceSur(SOURCES, bougeSujet2);
}

async function lanceSur(SOURCES: { path: string; text: string }[], bougeSujet2: boolean) {
  (vscodeMock.workspace as any).workspaceFolders = [{ uri: vscodeMock.Uri.file('/w'), path: '/w' }];
  vi.spyOn(vscodeMock.workspace, 'getConfiguration').mockReturnValue({ get: (_k: string, d: any) => d } as any);
  let repondu = false;
  // Un document OUVERT, parce que la garde de peremption ne sait comparer que
  // ceux-la : un fichier ferme change sur disque lui est invisible, ce qui est
  // une limite assumee ailleurs. Son texte change apres la reponse.
  const texteOuvert = () => (bougeSujet2 && repondu
    ? `// une ligne arrivee entre temps\n${SOURCES.find(s => s.path === SUJET2)!.text}`
    : SOURCES.find(s => s.path === SUJET2)!.text);
  const ouvert = {
    uri: vscodeMock.Uri.file(SUJET2),
    getText: texteOuvert,
    positionAt: (offset: number) => {
      const avant = texteOuvert().slice(0, offset).split('\n');
      return new vscodeMock.Position(avant.length - 1, avant[avant.length - 1].length);
    },
  };
  vi.spyOn(vscodeMock.workspace, 'textDocuments', 'get').mockReturnValue([ouvert] as any);
  (vscodeMock.workspace as any).fs = {
    readFile: async (uri: any) => {
      const p = uri.fsPath ?? String(uri);
      const src = SOURCES.find(s => s.path === p);
      if (!src) return Buffer.from('', 'utf8');
      return Buffer.from(src.text, 'utf8');
    },
  };
  const editions: any[] = [];
  (vscodeMock.workspace as any).applyEdit = async (e: any) => { editions.push(e); return true; };
  const messages: string[] = [];
  vi.spyOn(vscodeMock.window, 'showInformationMessage').mockImplementation((async (m: string, o?: any, ...items: string[]) => {
    if (o?.modal) { repondu = true; return items[0]; }
    messages.push(m);
    return undefined;
  }) as any);
  vi.spyOn(vscodeMock.window, 'showWarningMessage').mockImplementation((async (m: string) => {
    messages.push(`AVERTISSEMENT ${m}`);
    return undefined;
  }) as any);
  const corpus: any = {
    get: async () => ({
      sources: SOURCES, index: null, modulesWithCode: ['/w/app'], libraryModules: [],
      truncated: false, sourcesTruncated: false, moduleDirs: ['/w/app'],
    }),
    invalidate: () => {},
  };
  await removeTestOnlyCodeCommand(corpus);
  const e = editions[0];
  return {
    messages: messages.join(' | '),
    operations: e ? e._entries.length + e._fileDeletes.length : 0,
  };
}

describe('KJ-047 le rapport compte ce qui est parti', () => {
  it('temoin : rien ne bouge, les deux sujets partent et sont annonces', async () => {
    const r = await lance(false);
    expect(r.messages).toContain('2 declarations');
    expect(r.messages).not.toContain('AVERTISSEMENT');
  });

  it('un sujet dont le fichier a bouge ne figure plus au rapport', async () => {
    const r = await lance(true);
    expect(r.messages).toContain('AVERTISSEMENT');
    expect(r.messages).toContain('1 declaration ');
    expect(r.messages).not.toContain('2 declarations');
  });

  it('une declaration dont le fichier part en entier compte quand meme', async () => {
    // Rien ne survit dans Solo.kt, donc il est supprime en bloc et sa
    // declaration ne passe par aucune edition de plage. Elle part pourtant.
    const r = await lanceAvec([
      { path: '/w/app/src/main/java/p/Solo.kt', text: 'package p\n\nclass Solo {\n    fun utilise() = 1\n}\n' },
      {
        path: '/w/app/src/test/java/p/SoloTest.kt',
        text: 'package p\n\nimport org.junit.Test\n\nclass SoloTest {\n    @Test\n    fun premier() {\n        Solo().utilise()\n    }\n}\n',
      },
    ]);
    expect(r.messages).toContain('1 declaration ');
    expect(r.messages).not.toContain('0 declaration');
  });

  it('un import devenu inutile n est pas compte comme un test', async () => {
    // Le test vit dans un autre paquet, donc il IMPORTE le sujet. Retirer le
    // sujet orpheline cet import, qui est une coupe de plus mais pas un test.
    const r = await lanceAvec([
      { path: '/w/app/src/main/java/p/Croise.kt', text: 'package p\n\nclass Croise {\n    fun utilise() = 1\n}\n' },
      { path: '/w/app/src/main/java/p/Vivant.kt', text: 'package p\n\nclass Vivant {\n    fun v() = 1\n}\n' },
      {
        path: '/w/app/src/test/java/q/CroiseTest.kt',
        text: 'package q\n\nimport org.junit.Test\nimport p.Croise\n\nclass CroiseTest {\n    @Test\n    fun premier() {\n        Croise().utilise()\n    }\n\n    @Test\n    fun garde() {\n        println(1)\n    }\n}\n',
      },
    ]);
    expect(r.messages).toContain('1 test');
    expect(r.messages).not.toContain('2 tests');
  });
});
