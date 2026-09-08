import { describe, it, expect, vi, afterEach } from 'vitest';
import { Uri, workspace } from './__mocks__/vscode';
import { SymbolIndex } from '../../src/indexer/SymbolIndex';
import { parse } from '../../src/indexer/KotlinParser';
import { FileWatcher } from '../../src/watcher/FileWatcher';
import { withoutUnappliedPlugins, declaresPublishing, declaresLibraryPlugin } from '../../src/indexer/ResourceCorpus';
import { findUnusedRemoteConfigKeys } from '../../src/providers/unusedRemoteConfigKeys';
import { buildWorkspaceNavigation } from '../../src/ui/ScreenFlowPanel';
import { gatherRouteConstants } from '../../src/indexer/NavigationIndex';
import { keepJdkEntry } from '../../src/jdk/JdkSourcesScanner';

// Audit 30 : régressions que nos propres correctifs des versions 1.42.27 à
// 1.42.30 avaient introduites, trouvées par la chasse adversariale.

afterEach(() => vi.restoreAllMocks());

describe('Un dossier ajouté ne tue pas le scan en cours', () => {
  it('addTree passe par scanFiles, qui n\'annule aucun scan', async () => {
    const index = new SymbolIndex();
    const calls: string[] = [];
    const scanner = {
      rescan: vi.fn(async () => { calls.push('rescan'); }),
      scanFiles: vi.fn(async () => { calls.push('scanFiles'); }),
    } as any;
    const watcher = new FileWatcher(scanner, index);
    const origFind = workspace.findFiles;
    workspace.findFiles = (async () => [Uri.parse('file:///proj/added/A.kt')]) as any;
    try {
      await watcher.addTree(Uri.parse('file:///proj/added') as any);
      // rescan() appelle freshToken(), qui invalide le scan initial.
      expect(calls).toEqual(['scanFiles']);
      expect(scanner.rescan).not.toHaveBeenCalled();
    } finally {
      workspace.findFiles = origFind;
      watcher.dispose();
    }
  });
});

describe('Plugins déclarés sans être appliqués', () => {
  const rootBuild = [
    'plugins {',
    '    alias(libs.plugins.android.application) apply false',
    '    alias(libs.plugins.android.library) apply false',
    '    alias(libs.plugins.maven.publish) apply false',
    '}',
  ].join('\n');

  it('la racine qui déclare les plugins n\'est ni une bibliothèque ni un module publié', () => {
    expect(withoutUnappliedPlugins(rootBuild).trim()).toBe('plugins {\n}');
    // Sans ce filtre, toute la racine passait pour de l'API publique et la
    // détection de code mort se taisait sur l'ensemble du workspace.
    expect(declaresPublishing(rootBuild)).toBe(false);
    expect(declaresLibraryPlugin(rootBuild)).toBe(false);
  });

  it('un module qui applique vraiment le plugin est reconnu', () => {
    const moduleBuild = 'plugins {\n    alias(libs.plugins.android.library)\n    alias(libs.plugins.maven.publish)\n}';
    expect(declaresLibraryPlugin(moduleBuild)).toBe(true);
    expect(declaresPublishing(moduleBuild)).toBe(true);
    expect(declaresPublishing('plugins { id("maven-publish") }')).toBe(true);
    expect(declaresPublishing('android { }')).toBe(false);
  });
});

describe('Lecture de toutes les clés Remote Config', () => {
  const defaults = '/proj/app/src/main/res/xml/remote_config_defaults.xml';
  const xml = '<defaults>\n<entry><key>feature_a</key><value>1</value></entry>\n</defaults>';
  const f = (path: string, text: string) => ({ path, text });

  it('un .all de la stdlib n\'éteint plus le détecteur', () => {
    const stdlibAll = [
      f(defaults, xml),
      f('/proj/app/src/main/kotlin/Check.kt',
        'package p\nimport com.google.firebase.remoteconfig.FirebaseRemoteConfig\nfun ok(items: List<String>) = items.all { it.isNotEmpty() }\n'),
    ];
    expect(findUnusedRemoteConfigKeys({ sources: stdlibAll }).map(k => k.name)).toEqual(['feature_a']);
  });

  it('une vraie lecture de toutes les clés éteint toujours le détecteur', () => {
    for (const call of ['rc.all.forEach { }', 'remoteConfig.all', 'firebaseRemoteConfig.getAll()']) {
      const sources = [f(defaults, xml), f('/proj/app/src/main/kotlin/Admin.kt', `package p\nfun dump() = ${call}\n`)];
      expect(findUnusedRemoteConfigKeys({ sources }), call).toEqual([]);
    }
  });
});

describe('Le pré-filtre de la carte des écrans', () => {
  // Le filtre ajouté pour éviter le gel ne connaissait que `const val` : un
  // Screen.kt en hiérarchie scellée, la forme la plus répandue, était écarté
  // et ses écrans revenaient en « dynamic route » sur la carte.
  const SCREENS = [
    'package app.nav',
    '',
    'sealed class Screen(val route: String) {',
    '    object Home : Screen("home")',
    '    object Detail : Screen("detail/{id}")',
    '}',
  ].join('\n');
  const GRAPH = [
    'package app.nav',
    '',
    'fun NavGraphBuilder.graph(nc: NavHostController) {',
    '    composable(Screen.Home.route) { HomeScreen(onOpen = { nc.navigate(Screen.Detail.route) }) }',
    '    composable(Screen.Detail.route) { DetailScreen() }',
    '}',
  ].join('\n');

  it('résout les routes déclarées dans un fichier sans const val ni navigation', async () => {
    const files: Record<string, string> = {
      'file:///proj/Screen.kt': SCREENS,
      'file:///proj/Graph.kt': GRAPH,
      'file:///proj/Repo.kt': 'package app\nclass Repo { fun load() = 1 }',
    };
    const origFind = workspace.findFiles;
    const origRead = workspace.fs.readFile;
    workspace.findFiles = (async (pattern: any) =>
      (typeof pattern === 'string' && pattern.startsWith('**/res') ? [] : Object.keys(files).map(u => Uri.parse(u)))) as any;
    workspace.fs.readFile = (async (u: any) => Buffer.from(files[u.toString()] ?? '')) as any;
    try {
      const nav = await buildWorkspaceNavigation();
      expect(nav.nodes.map(n => n.route).sort()).toEqual(['detail/{id}', 'home']);
      expect(nav.nodes.some(n => n.dynamic)).toBe(false);
      expect(nav.edges).toEqual([{ from: 'home', to: 'detail/{id}' }]);
    } finally {
      workspace.findFiles = origFind;
      workspace.fs.readFile = origRead;
    }
  });
});

describe('Routes dont le chemin porte un paramètre', () => {
  it('une accolade dans la route n\'ouvre pas un bloc', () => {
    const kt = [
      'package app.nav',
      '',
      'sealed class Screen(val route: String) {',
      '    object Home : Screen("home")',
      '    object Detail : Screen("detail/{id}")',
      '    object Profile : Screen("profile")',
      '}',
    ].join('\n');
    const c = gatherRouteConstants(kt);
    // `detail/{id}` passait pour l'ouverture d'un bloc : Detail devenait son
    // propre parent, et tout écran déclaré ensuite perdait son nom qualifié.
    expect(c.get('Screen.Detail.route')).toBe('detail/{id}');
    expect(c.get('Screen.Home.route')).toBe('home');
    expect(c.get('Screen.Profile.route')).toBe('profile');
  });
});

describe('Modules du JDK indexés', () => {
  it('garde ce qu\'on ouvre vraiment et écarte le reste', () => {
    for (const kept of [
      'java.base/java/lang/String.java',
      'java.base/java/util/ArrayList.java',
      'java.sql/java/sql/Connection.java',
      'java/lang/String.java',              // JDK 8 : pas de préfixe de module
    ]) expect(keepJdkEntry(kept), kept).toBe(true);

    for (const dropped of [
      'java.desktop/javax/swing/JButton.java',
      'jdk.compiler/com/sun/tools/javac/Main.java',
      'jdk.jshell/jdk/jshell/JShell.java',
      'java.management/sun/management/Agent.java',
    ]) expect(keepJdkEntry(dropped), dropped).toBe(false);
  });
});
