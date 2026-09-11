/**
 * Le badge de dependances gardait son balayage projet apres sa mort.
 *
 * Les cinq fournisseurs qui balaient tout le projet partagent le meme plafond
 * (`MAX_SWEEP_FILES`). Trois ont reçu, en v1.42.180 a v1.42.187, la meme paire
 * de gardes : rien n est ecrit dans le cache si le reglage a ete coupe ou si le
 * fournisseur a ete detruit pendant le balayage, et `dispose()` relache ce qui
 * est deja la. Le badge de dependances est reste en dehors, alors qu il tient
 * exactement le meme genre de cache.
 *
 * Mesure sur /Users/kevin/Desktop/work/lapresse : 56 589 lignes `import` sur
 * 5 093 sources, soit environ 5,2 Mo de caracteres, plus l entete de chaque
 * chaine. Le balayage lit un fichier a la fois et dure plusieurs secondes, donc
 * fermer la fenetre ou couper le reglage pendant qu il tourne est le cas
 * courant, pas le cas limite.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import * as vscodeMock from './__mocks__/vscode';
import { DependencyUsageBadgeProvider } from '../../src/providers/DependencyUsageBadgeProvider';

const encode = (s: string) => new TextEncoder().encode(s);
const attendre = async () => { for (let i = 0; i < 8; i++) await new Promise<void>(r => setTimeout(r, 0)); };

afterEach(() => {
  vi.restoreAllMocks();
  (vscodeMock.window as any).activeTextEditor = undefined;
});

/** Balayage suspendu : rend la fonction qui le laisse se terminer. */
function balayageSuspendu(reglage: { actif: boolean }, ecouteurs?: ((e: any) => void)[]) {
  let relacher!: () => void;
  const barriere = new Promise<void>(r => { relacher = r; });
  vi.spyOn(vscodeMock.workspace, 'onDidChangeConfiguration')
    .mockImplementation(((cb: any) => { ecouteurs?.push(cb); return { dispose: () => {} }; }) as any);
  vi.spyOn(vscodeMock.workspace, 'findFiles').mockImplementation((async (motif: string) => (
    /versions\.toml/.test(String(motif)) ? [] : Array.from({ length: 3 }, (_, i) => ({
      toString: () => `file:///w/src/F${i}.kt`,
      fsPath: `/w/src/F${i}.kt`,
    }))
  )) as any);
  vi.spyOn(vscodeMock.workspace.fs as any, 'readFile').mockImplementation((async () => {
    await barriere;
    return encode('import a.b.C');
  }) as any);
  vi.spyOn(vscodeMock.workspace, 'getConfiguration').mockReturnValue({
    get: (cle: string, def: any) => (cle === 'dependencyUsageBadges' ? reglage.actif : def),
  } as any);
  return relacher;
}

/** L editeur d un fichier Gradle, seul contexte ou le badge travaille. */
function ouvrirGradle() {
  (vscodeMock.window as any).activeTextEditor = {
    document: {
      uri: { fsPath: '/w/app/build.gradle.kts', toString: () => 'file:///w/app/build.gradle.kts' },
      languageId: 'kotlin',
      lineCount: 1,
      lineAt: () => ({ text: '    implementation(libs.timber)' }),
      getText: () => '    implementation(libs.timber)',
    },
    setDecorations: vi.fn(),
  };
}

describe('DependencyUsageBadgeProvider - le cache du balayage projet', () => {
  it('le listing en vol ne revient pas dans un fournisseur mort', async () => {
    const relacher = balayageSuspendu({ actif: true });
    ouvrirGradle();
    const p: any = new DependencyUsageBadgeProvider();
    const enVol = p._workspaceImports();
    await attendre();
    expect(p._cache, 'le balayage est encore en vol').toBeUndefined();

    p.dispose();
    relacher();
    await enVol;
    await attendre();

    expect(p._cache, '56 589 imports ne doivent pas revenir').toBeUndefined();
  });

  it('le reglage coupe pendant le balayage relache aussi', async () => {
    const reglage = { actif: true };
    const relacher = balayageSuspendu(reglage);
    ouvrirGradle();
    const p: any = new DependencyUsageBadgeProvider();
    const enVol = p._workspaceImports();
    await attendre();

    reglage.actif = false;      // l utilisateur coupe le badge pendant le balayage
    relacher();
    await enVol;
    await attendre();

    expect(p._cache, 'personne n a plus besoin de ces imports').toBeUndefined();
    p.dispose();
  });

  it('dispose relache un cache deja rempli', async () => {
    const relacher = balayageSuspendu({ actif: true });
    ouvrirGradle();
    const p: any = new DependencyUsageBadgeProvider();
    relacher();
    await p._workspaceImports();
    await attendre();
    expect(p._cache, 'le balayage a bien abouti').toBeDefined();

    p.dispose();
    expect(p._cache, 'le fournisseur mort ne garde rien').toBeUndefined();
  });

  it('couper le reglage relache un cache deja rempli', async () => {
    // L autre moitie du geste : ici le balayage a deja abouti, et c est
    // l evenement de configuration qui doit rendre les megaoctets. Attendre le
    // prochain balayage pour les liberer les garde en memoire indefiniment,
    // puisque le badge eteint n en lance plus aucun.
    const reglage = { actif: true };
    const ecouteurs: ((e: any) => void)[] = [];
    const relacher = balayageSuspendu(reglage, ecouteurs);
    ouvrirGradle();
    const p: any = new DependencyUsageBadgeProvider();
    relacher();
    await p._workspaceImports();
    await attendre();
    expect(p._cache).toBeDefined();

    reglage.actif = false;
    for (const cb of ecouteurs) cb({ affectsConfiguration: () => true });
    await attendre();

    expect(p._cache, 'le badge eteint ne relancera plus rien pour le vider').toBeUndefined();
    p.dispose();
  });

  it('temoin : un balayage qui aboutit sur un fournisseur vivant remplit le cache', async () => {
    const relacher = balayageSuspendu({ actif: true });
    ouvrirGradle();
    const p: any = new DependencyUsageBadgeProvider();
    relacher();
    const r = await p._workspaceImports();
    await attendre();

    expect(r.imports).toContain('import a.b.C');
    expect(p._cache).toBeDefined();
    p.dispose();
  });
});
