import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as vscodeMock from '../__mocks__/vscode';
import { ResourceCorpus } from '../../../src/indexer/ResourceCorpus';

/**
 * Le corpus workspace partagé par KJ-029, KJ-031 et KJ-032.
 *
 * Le piège que ces tests verrouillent : le PLAFOND de fichiers doit
 * s'appliquer APRÈS l'exclusion. Sur un projet déjà compilé, `build/` peut
 * contenir plus de fichiers que le plafond entier ; les ramener puis les
 * filtrer fait croire à un corpus tronqué, ce qui désactive silencieusement
 * tous les détecteurs qui raisonnent sur l'absence.
 */

function stub(byGlob: (glob: string, exclude: string | undefined) => string[]) {
  vi.spyOn(vscodeMock.workspace, 'getConfiguration').mockReturnValue({
    get: (k: string, d?: unknown) => d,
  } as any);
  const seen: { glob: string; exclude: string | undefined }[] = [];
  vi.spyOn(vscodeMock.workspace, 'findFiles').mockImplementation(((glob: any, exclude: any, max: any) => {
    seen.push({ glob: String(glob), exclude: exclude === undefined ? undefined : String(exclude) });
    return Promise.resolve(byGlob(String(glob), exclude === undefined ? undefined : String(exclude))
      .slice(0, max)
      .map(p => ({ fsPath: p, toString: () => `file://${p}` })));
  }) as any);
  (vscodeMock.workspace as any).fs = {
    readFile: () => Promise.resolve(new TextEncoder().encode('')),
  };
  return seen;
}

beforeEach(() => vi.restoreAllMocks());

describe('ResourceCorpus — exclusion et troncature', () => {
  it('passe les excludePatterns à findFiles, pour que le plafond vienne après', async () => {
    const seen = stub(() => []);
    await new ResourceCorpus().get();
    expect(seen.length).toBeGreaterThan(0);
    for (const call of seen) {
      expect(call.exclude, `glob sans exclusion: ${call.glob}`).toBeDefined();
      expect(call.exclude).toContain('**/build/**');
    }
  });

  it('un projet compilé ne se déclare PAS tronqué à cause de build/', async () => {
    // 20000 fichiers sous build/, 10 vrais fichiers. Sans exclusion au niveau
    // du glob, le plafond de 10000 serait atteint et tout le corpus voidé.
    stub((glob, exclude) => {
      const all = [
        ...Array.from({ length: 20000 }, (_, i) => `/w/app/build/generated/G${i}.xml`),
        ...Array.from({ length: 10 }, (_, i) => `/w/app/src/main/kotlin/A${i}.kt`),
      ];
      if (!glob.includes('kt,kts')) return [];
      // le mock honore l'exclusion, comme le fait VS Code
      return exclude?.includes('build') ? all.filter(p => !p.includes('/build/')) : all;
    });
    const corpus = await new ResourceCorpus().get();
    expect(corpus.sourcesTruncated).toBe(false);
    expect(corpus.sources).toHaveLength(10);
  });

  it('mais un vrai dépassement du plafond reste signalé', async () => {
    stub(glob => (glob.includes('kt,kts')
      ? Array.from({ length: 10000 }, (_, i) => `/w/app/src/main/kotlin/A${i}.kt`)
      : []));
    const corpus = await new ResourceCorpus().get();
    expect(corpus.sourcesTruncated).toBe(true);
  });

  it('le plafond des ressources ne tronque PAS le côté sources', async () => {
    // KJ-032 raisonne sur des symboles Kotlin : un projet avec 12000 fichiers
    // sous res/ ne doit pas le désactiver.
    stub(glob => (glob.includes('res/')
      ? Array.from({ length: 10000 }, (_, i) => `/w/app/src/main/res/drawable/d${i}.png`)
      : ['/w/app/src/main/kotlin/A.kt']));
    const corpus = await new ResourceCorpus().get();
    expect(corpus.truncated).toBe(true);        // vrai pour les consommateurs historiques
    expect(corpus.sourcesTruncated).toBe(false); // mais KJ-032 peut travailler
  });
});
