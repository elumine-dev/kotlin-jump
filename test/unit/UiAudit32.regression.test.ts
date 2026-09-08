import { describe, it, expect } from 'vitest';
import { Uri, workspace } from './__mocks__/vscode';
import { parseNavigation, routeMatches, gatherRouteConstants } from '../../src/indexer/NavigationIndex';
import { buildWorkspaceNavigation, renderHtml } from '../../src/ui/ScreenFlowPanel';

// Audit 32 : la carte des écrans traçait des flèches vers un écran arbitraire.

describe('Cible de navigation entièrement inconnue', () => {
  it('un segment joker seul ne correspond à aucun écran déclaré', () => {
    // Avant : `{dest}` prenait le premier écran d'un seul segment.
    expect(routeMatches('{dest}', 'home')).toBe(false);
    expect(routeMatches('{a}/{b}', 'orders/{id}')).toBe(false);
    // Une cible qui garde un segment littéral reste résolue.
    expect(routeMatches('detail/{x}', 'detail/{id}')).toBe(true);
    expect(routeMatches('{x}/edit', 'profile/edit')).toBe(true);
    expect(routeMatches('home', 'home')).toBe(true);
    expect(routeMatches('{x}', '{x}')).toBe(true);
  });

  it('navigate(dest) ne trace pas de flèche vers un écran choisi au hasard', () => {
    const kt = [
      'fun graph(nc: NavHostController) {',
      '    composable("home") { Home(onGo = { dest: String -> nc.navigate(dest) }) }',
      '    composable("profile/{userId}") { Profile() }',
      '    composable("orders/{orderId}") { Orders() }',
      '}',
    ].join('\n');
    const nav = parseNavigation(kt, new Map());
    // Avant : une flèche home -> profile/{userId}, choisie parce que ce
    // composable était déclaré en premier.
    expect(nav.edges.filter(e => e.to === 'profile/{userId}')).toEqual([]);
    expect(nav.edges.filter(e => e.to === 'orders/{orderId}')).toEqual([]);
  });
});

describe('Interpolation dont le préfixe est une route connue', () => {
  it('la partie connue de la cible est conservée', () => {
    const constants = new Map([['Screen.Profile.route', 'profile']]);
    const kt = [
      'fun graph(nc: NavHostController) {',
      '    composable("home") { Home(onOpen = { id: String -> nc.navigate("${Screen.Profile.route}/$id") }) }',
      '    composable("profile/{userId}") { Profile() }',
      '    composable("orders/{orderId}") { Orders() }',
      '}',
    ].join('\n');
    const nav = parseNavigation(kt, constants);
    // Avant : la cible devenait {Screen.Profile.route}/{id}, sans aucun
    // segment littéral, et l'arête partait vers le premier écran à deux
    // segments, donc potentiellement orders.
    expect(nav.edges).toEqual([{ from: 'home', to: 'profile/{userId}' }]);
  });

  it('une interpolation inconnue reste un joker', () => {
    const kt = 'fun graph(nc: NavHostController) {\n    composable("home") { Home(go = { nc.navigate("${unknownRoute}") }) }\n    composable("settings") { Settings() }\n}';
    const nav = parseNavigation(kt, new Map());
    expect(nav.edges.filter(e => e.to === 'settings')).toEqual([]);
  });
});

describe('Constante de route déclarée dans deux modules', () => {
  const A = 'package a\n\nobject Routes {\n    const val MAIN = "home"\n}\nfun g(nc: NavHostController) {\n    composable(Routes.MAIN) { Home(go = { nc.navigate(MAIN) }) }\n}';
  const B = 'package b\n\nobject OtherRoutes {\n    const val MAIN = "checkout/{cartId}"\n}';

  it('un nom non qualifié qui vaut deux choses ne vaut plus rien', async () => {
    expect(gatherRouteConstants(A).get('MAIN')).toBe('home');
    expect(gatherRouteConstants(B).get('MAIN')).toBe('checkout/{cartId}');
    const files: Record<string, string> = { 'file:///proj/A.kt': A, 'file:///proj/B.kt': B };
    const origFind = workspace.findFiles;
    const origRead = workspace.fs.readFile;
    workspace.findFiles = (async (pattern: any) =>
      (typeof pattern === 'string' && pattern.startsWith('**/res') ? [] : Object.keys(files).map(u => Uri.parse(u)))) as any;
    workspace.fs.readFile = (async (u: any) => Buffer.from(files[u.toString()] ?? '')) as any;
    try {
      const nav = await buildWorkspaceNavigation();
      // Avant : MAIN valait la valeur du dernier fichier lu, donc une flèche
      // de home vers l'écran de paiement d'un autre module.
      expect(nav.edges.filter(e => e.to.startsWith('checkout'))).toEqual([]);
    } finally {
      workspace.findFiles = origFind;
      workspace.fs.readFile = origRead;
    }
  });
});

describe('Légende du panneau', () => {
  it('ne compte que les flèches réellement tracées', () => {
    const nav: any = {
      nodes: [
        { route: 'home', file: 'file:///A.kt', line: 1 },
        { route: 'detail', file: 'file:///A.kt', line: 2 },
      ],
      edges: [
        { from: 'home', to: 'detail' },
        { from: '«global»', to: 'detail' },
        { from: 'home', to: 'jamais-declare' },
      ],
      deepLinks: [],
      startDestinations: [],
      graphs: [],
    };
    const html = renderHtml(nav);
    // Avant : « 3 navigations » alors que le dessin n'en montrait qu'une.
    expect(html).toContain('1 navigations');
    expect((html.match(/<line /g) ?? []).length).toBe(1);
  });
});
