import { describe, it, expect, vi, afterEach } from 'vitest';
import { Uri, workspace } from './__mocks__/vscode';
import { SymbolIndex } from '../../src/indexer/SymbolIndex';
import { parse } from '../../src/indexer/KotlinParser';
import { FileWatcher } from '../../src/watcher/FileWatcher';
import { withoutUnappliedPlugins, declaresPublishing, declaresLibraryPlugin } from '../../src/indexer/ResourceCorpus';
import { findUnusedRemoteConfigKeys } from '../../src/providers/unusedRemoteConfigKeys';

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
