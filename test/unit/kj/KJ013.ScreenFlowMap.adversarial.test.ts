import { describe, it, expect } from 'vitest';
import {
  parseNavigation,
  parseNavigationXml,
  findOrphans,
  gatherRouteConstants,
} from '../../../src/indexer/NavigationIndex';
import { fixture } from './harness';

/** KJ-013 — tentatives de casse au-delà du contrat. */

const NO_CONSTANTS = new Map<string, string>();

describe('KJ-013 adversarial — parseNavigation', () => {
  it('navigate() dans un commentaire : ignoré', () => {
    const text = `
      NavHost(nc, startDestination = "a") {
        composable("a") { /* nc.navigate("ghost") */ Screen() }
        // nc.navigate("ghost2")
        composable("ghost") { G() }
      }`;
    const parsed = parseNavigation(text, NO_CONSTANTS);
    expect(parsed.edges).toEqual([]);
    expect(findOrphans(parsed)).toContain('ghost');
  });

  it('plusieurs deeplinks sur le même écran', () => {
    const text = `
      composable(
        route = "battle",
        deepLinks = listOf(
          navDeepLink { uriPattern = "app://battle" },
          navDeepLink { uriPattern = "https://x.dev/battle" },
        ),
      ) { B() }`;
    const parsed = parseNavigation(text, NO_CONSTANTS);
    expect(parsed.deepLinks).toHaveLength(2);
  });

  it('auto-navigation (retry) : arête vers soi-même', () => {
    const text = `
      composable("battle") { B(onRetry = { nc.navigate("battle") }) }`;
    const parsed = parseNavigation(text, NO_CONSTANTS);
    expect(parsed.edges).toEqual([{ from: 'battle', to: 'battle' }]);
  });

  it('arêtes dédupliquées (deux navigate identiques)', () => {
    const text = `
      composable("a") {
        A(one = { nc.navigate("b") }, two = { nc.navigate("b") })
      }
      composable("b") { B() }`;
    const parsed = parseNavigation(text, NO_CONSTANTS);
    expect(parsed.edges).toHaveLength(1);
  });

  it('constante inconnue → nœud dynamic, pas de crash', () => {
    const text = `composable(Routes.MYSTERY) { M() }`;
    const parsed = parseNavigation(text, NO_CONSTANTS);
    expect(parsed.nodes[0].dynamic).toBe(true);
  });

  it('popBackStack ne crée jamais d’arête', () => {
    const text = `composable("a") { A(back = { nc.popBackStack() }) }`;
    expect(parseNavigation(text, NO_CONSTANTS).edges).toEqual([]);
  });

  it('fichier sans navigation → structure vide', () => {
    const parsed = parseNavigation('class Foo { fun bar() = 1 }', NO_CONSTANTS);
    expect(parsed.nodes).toEqual([]);
    expect(parsed.edges).toEqual([]);
  });

  it('BUG-HUNT-11 : « composable( » cité dans une STRING ne crée pas de nœud fantôme', () => {
    const text = 'val doc = "exemple: composable(\\"ghost\\") crée un écran"\nval x = 1';
    const parsed = parseNavigation(text, NO_CONSTANTS);
    expect(parsed.nodes).toEqual([]);
  });

  it('renavigate() ne matche pas navigate()', () => {
    const text = `composable("a") { A(x = { renavigate("b") }) }`;
    expect(parseNavigation(text, NO_CONSTANTS).edges).toEqual([]);
  });
});

describe('KJ-013 — nav graphs XML (apps legacy à fragments, fixture réelle)', () => {
  const parsed = () => parseNavigationXml(fixture('src/main/res/navigation/graph_kj_legacy.xml'));

  it('fragments, dialogs et activities deviennent des nœuds avec leur classe', () => {
    const feed = parsed().nodes.find(n => n.route === 'legacy_feed');
    expect(feed?.composable).toBe('FeedFragment');
    expect(parsed().nodes.some(n => n.route === 'legacy_subscription')).toBe(true);
  });

  it('les <action app:destination> deviennent des arêtes', () => {
    const edges = parsed().edges.map(e => `${e.from}→${e.to}`);
    expect(edges).toContain('legacy_feed→legacy_article');
    expect(edges).toContain('legacy_article→legacy_gallery');
    expect(edges).toContain('legacy_settings_home→legacy_settings_about');
  });

  it('deepLink rattaché à son fragment', () => {
    expect(parsed().deepLinks).toContainEqual({ pattern: 'newsdemo://feed', route: 'legacy_feed' });
  });

  it('graphe imbriqué étiqueté, startDestinations collectés', () => {
    const home = parsed().nodes.find(n => n.route === 'legacy_settings_home');
    expect(home?.graph).toBe('legacy_settings');
    expect(parsed().startDestinations).toEqual(
      expect.arrayContaining(['legacy_feed', 'legacy_settings_home']),
    );
  });

  it('action GLOBALE : la cible n’est pas orpheline', () => {
    const orphans = findOrphans(parsed());
    expect(orphans).not.toContain('legacy_subscription');
    expect(orphans).toContain('legacy_dead_end');
    expect(orphans).not.toContain('legacy_feed');
  });

  it('un graphe legacy réaliste (multi-fragments + activity) se parse sans crash', () => {
    const newsappShaped = `<?xml version="1.0"?>
      <navigation xmlns:android="http://schemas.android.com/apk/res/android"
          xmlns:app="http://schemas.android.com/apk/res-auto"
          android:id="@+id/navigation"
          app:startDestination="@+id/navigation_space_main_feed">
        <fragment android:id="@+id/navigation_space_showcase"
            android:name="com.example.news.feed.showcase.ui.ShowcaseFragment">
          <action android:id="@+id/a1" app:destination="@id/navigation_space_main_feed" />
        </fragment>
        <fragment android:id="@+id/navigation_space_main_feed"
            android:name="com.example.news.feed.main.MainFeedFragment" />
        <activity android:id="@+id/navigation_menu_subsection"
            android:name="com.example.news.menu.search.view.SubsectionSearchActivity">
        </activity>
      </navigation>`;
    const p = parseNavigationXml(newsappShaped);
    expect(p.nodes).toHaveLength(3);
    expect(p.edges).toContainEqual({
      from: 'navigation_space_showcase',
      to: 'navigation_space_main_feed',
    });
  });
});

describe('KJ-013 adversarial — gatherRouteConstants', () => {
  it('objects imbriqués : le propriétaire direct gagne', () => {
    const text = `
      object Routes {
        const val HOME = "home"
        object Nested {
          const val DEEP = "deep"
        }
      }`;
    const c = gatherRouteConstants(text);
    expect(c.get('Routes.HOME')).toBe('home');
    expect(c.get('Nested.DEEP')).toBe('deep');
    expect(c.get('DEEP')).toBe('deep');
  });

  it('val sans const ignoré (peut être dynamique)', () => {
    const c = gatherRouteConstants('object R { val x = "not-const" }');
    expect(c.size).toBe(0);
  });
});
