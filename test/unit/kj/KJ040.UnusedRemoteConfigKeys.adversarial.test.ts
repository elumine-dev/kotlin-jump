import { describe, it, expect } from 'vitest';
import {
  findUnusedRemoteConfigKeys,
  isRemoteConfigDefaults,
} from '../../../src/providers/unusedRemoteConfigKeys';

/**
 * KJ-040 — les clés de Remote Config que personne ne lit.
 *
 * Un défaut ne sert que si le client demande la clé. Une clé posée dans le
 * fichier de defaults que rien ne nomme est donc morte SANS avoir à interroger
 * la console Firebase : quoi que le serveur en dise, cette app ne regarde pas.
 *
 * C'est ce qui rend la question vérifiable. « Cette clé est-elle encore
 * servie ? » demande un appel réseau et un identifiant ; « cette app la
 * lit-elle encore ? » ne demande que l'espace de travail, et c'est la question
 * qui décide si la déclaration peut partir.
 */

const f = (path: string, text: string) => ({ path, text });
const defaults = (path: string, ...keys: string[]) => f(path, [
  '<?xml version="1.0" encoding="UTF-8"?>',
  '<defaults>',
  ...keys.flatMap(k => [
    '    <entry>',
    `        <key>${k}</key>`,
    '        <value>v</value>',
    '    </entry>',
  ]),
  '</defaults>',
].join('\n'));

const find = (sources: { path: string; text: string }[], extra: Record<string, unknown> = {}) =>
  findUnusedRemoteConfigKeys({ sources, ...extra });
const names = (sources: any[], extra: Record<string, unknown> = {}) =>
  find(sources, extra).map((k: any) => k.name);

const MAIN = '/w/app/src/main/res/xml/remote_config_defaults.xml';

describe('le cas de base', () => {
  it('une clé que rien ne nomme est signalée', () => {
    const reader = f('/w/app/src/main/kotlin/Cfg.kt',
      'package a\n\nprivate const val KEY = "used_key"\n');
    expect(names([defaults(MAIN, 'used_key', 'dead_key'), reader])).toEqual(['dead_key']);
  });

  it('une clé lue par une constante est vivante', () => {
    const reader = f('/w/app/src/main/kotlin/Cfg.kt', [
      'package a',
      '',
      'private const val PRIVACY = "settings_privacy_url"',
      '',
      'class Cfg {',
      '    fun url() = remoteConfig.getString(PRIVACY)',
      '}',
    ].join('\n'));
    expect(names([defaults(MAIN, 'settings_privacy_url'), reader])).toEqual([]);
  });

  it('une clé lue en littéral au point d’appel est vivante', () => {
    const reader = f('/w/app/src/main/kotlin/Cfg.kt',
      'package a\n\nclass Cfg {\n    fun on() = remoteConfig.getBoolean("feature_on")\n}\n');
    expect(names([defaults(MAIN, 'feature_on')], )).toEqual(['feature_on']);
    expect(names([defaults(MAIN, 'feature_on'), reader])).toEqual([]);
  });
});

describe('les variantes de build', () => {
  const DEBUG = '/w/app/src/debug/res/xml/remote_config_defaults.xml';
  const RELEASE = '/w/app/src/release/res/xml/remote_config_defaults.xml';

  it('une clé déclarée dans trois variantes est UNE trouvaille', () => {
    // 333 déclarations pour 92 clés sur un vrai projet. Rapporter par
    // déclaration transformerait 29 clés mortes en 84 lignes redondantes.
    const found = find([
      defaults(MAIN, 'dead_key'),
      defaults(DEBUG, 'dead_key'),
      defaults(RELEASE, 'dead_key'),
    ]);
    expect(found.map(k => k.name)).toEqual(['dead_key']);
    expect(found[0].declarations).toHaveLength(3);
  });

  it('et la copie d’une variante ne fait pas vivre l’autre', () => {
    // Sans exclure les fichiers de defaults du décompte, chaque variante
    // servirait de mention aux autres et rien ne serait jamais signalé.
    expect(names([defaults(MAIN, 'dead_key'), defaults(DEBUG, 'dead_key')])).toEqual(['dead_key']);
  });

  it('une clé lue reste muette même déclarée partout', () => {
    const reader = f('/w/app/src/main/kotlin/Cfg.kt', 'package a\n\nval k = "shared_key"\n');
    expect(names([defaults(MAIN, 'shared_key'), defaults(DEBUG, 'shared_key'), reader])).toEqual([]);
  });
});

describe('la reconnaissance du fichier, par forme et non par nom', () => {
  it('un fichier nommé autrement compte s’il a la bonne forme', () => {
    // `setDefaultsAsync(R.xml.<n’importe quoi>)` : le nom est une convention.
    const odd = defaults('/w/app/src/main/res/xml/firebase_defaults.xml', 'dead_key');
    expect(names([odd])).toEqual(['dead_key']);
  });

  it('un XML de res/xml sans <defaults> n’en est pas un', () => {
    const prefs = f('/w/app/src/main/res/xml/prefs.xml',
      '<PreferenceScreen><Preference key="dead_key" /></PreferenceScreen>');
    expect(names([prefs])).toEqual([]);
    expect(isRemoteConfigDefaults(prefs.path, prefs.text)).toBe(false);
  });

  it('un fichier hors res/xml n’en est pas un', () => {
    const elsewhere = defaults('/w/app/config/remote_config_defaults.xml', 'dead_key');
    expect(names([elsewhere])).toEqual([]);
  });
});

describe('ce qui compte comme une lecture', () => {
  it('une mention dans un test compte', () => {
    // Une clé que seul un test lit est lue, et aucun correctif ne pourrait
    // la retirer en laissant ce test compiler.
    const test = f('/w/app/src/test/kotlin/CfgTest.kt',
      'package a\n\nclass CfgTest {\n    val k = "tested_key"\n}\n');
    expect(names([defaults(MAIN, 'tested_key'), test])).toEqual([]);
  });

  it('une mention dans un script Gradle compte', () => {
    const gradle = f('/w/app/build.gradle.kts', 'buildConfigField("String", "K", "gated_key")');
    expect(names([defaults(MAIN, 'gated_key'), gradle])).toEqual([]);
  });

  it('mais un .json ne compte PAS, et c’est délibéré', () => {
    // R8 écrit tous les noms du build dans un .json : en lire un marquerait
    // le projet entier vivant. La famille partage cette exclusion, s'en
    // écarter ici serait pire que la limite.
    const json = f('/w/app/config/flags.json', '{ "json_key": true }');
    expect(names([defaults(MAIN, 'json_key'), json])).toEqual(['json_key']);
  });

  it('un commentaire ne compte PAS', () => {
    const code = f('/w/app/src/main/kotlin/Cfg.kt',
      'package a\n\n// removed_key was read here once\nclass Cfg\n');
    expect(names([defaults(MAIN, 'removed_key'), code])).toEqual(['removed_key']);
  });
});

describe('le contrat', () => {
  it('un corpus tronqué ne produit rien', () => {
    expect(names([defaults(MAIN, 'dead_key')])).toEqual(['dead_key']);
    expect(names([defaults(MAIN, 'dead_key')], { truncated: true })).toEqual([]);
  });

  it('le marqueur inline tait le fichier', () => {
    const marked = f(MAIN, [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<!-- kotlin-jump:ignore unused-remote-config-key -->',
      '<defaults>',
      '    <entry><key>dead_key</key><value>v</value></entry>',
      '</defaults>',
    ].join('\n'));
    expect(names([marked])).toEqual([]);
  });

  it('les noms ignorés acceptent des globs', () => {
    const src = [defaults(MAIN, 'exp_alpha', 'exp_beta', 'real_key')];
    expect(names(src, { ignoreNames: ['exp_*'] })).toEqual(['real_key']);
  });
});

describe('l’étendue de suppression', () => {
  it('couvre l’élément <entry> entier, pas seulement la clé', () => {
    const src = defaults(MAIN, 'dead_key');
    const [found] = find([src]);
    const removed = src.text.slice(found.declarations[0].removeStart, found.declarations[0].removeEnd);
    expect(removed).toContain('<entry>');
    expect(removed).toContain('</entry>');
    expect(removed).toContain('dead_key');
  });

  it('et retirer l’étendue laisse un XML sans la clé', () => {
    const src = defaults(MAIN, 'keep_me', 'dead_key');
    const reader = f('/w/app/src/main/kotlin/A.kt', 'package a\n\nval k = "keep_me"\n');
    const [found] = find([src, reader]);
    const d = found.declarations[0];
    const after = src.text.slice(0, d.removeStart) + src.text.slice(d.removeEnd);
    expect(after).not.toContain('dead_key');
    expect(after).toContain('keep_me');
    expect(after).toContain('</defaults>');
  });
});
