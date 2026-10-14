import { describe, it, expect } from 'vitest';
import { importOrNull } from '../kj/harness';

/**
 * G58, un lecteur de toutes les cles dans une AUTRE application.
 *
 * Oracle : `7d356324a0` sur LaPresse (AND-2340) retire a la main 25 cles de
 * `rubicon/base/src/main/res/xml/remote_config_defaults.xml`. KJ les rendait
 * toutes `R4:every-key-read`, et le fichier qui eteignait la famille etait
 * `replica/app/.../adminV2/remoteconfig/RemoteConfigListScreen.kt` :
 *
 *   FirebaseRemoteConfig.getInstance().all
 *
 * Un ecran de replica ne lit jamais une cle de rubicon : autre application,
 * autre projet Firebase, autre fichier de valeurs par defaut empaquete.
 *
 * Regle voulue : un lecteur ne masque une cle que s il partage au moins une
 * application avec un fichier qui la declare. Le graphe vient des fichiers
 * Gradle (`settings.gradle(.kts)`, `project(":a:b")`, plugin d application).
 * Des que le graphe ne se lit pas, le coupe circuit garde sa portee d avant :
 * tout le depot.
 */

const rc: any = await importOrNull('src/providers/unusedRemoteConfigKeys');

type Src = { path: string; text: string };
const src = (path: string, ...lines: string[]): Src => ({ path: `/w/${path}`, text: lines.join('\n') });

const APP = 'plugins {\n    alias(libs.plugins.android.application)\n}\n';
const LIB = 'plugins {\n    alias(libs.plugins.android.library)\n}\n';

const settings = (extra = '') => src('settings.gradle.kts',
  'rootProject.name = "w"',
  'include(',
  '    ":replica:app",',
  '    ":replica:common",',
  '    ":rubicon:app",',
  '    ":rubicon:base",',
  ')',
  extra,
);

const MODULES: Src[] = [
  src('replica/app/build.gradle.kts', APP, 'dependencies {', '    implementation(project(":replica:common"))', '}'),
  src('replica/common/build.gradle.kts', LIB),
  src('rubicon/app/build.gradle.kts', APP, 'dependencies {', '    implementation(project(":rubicon:base"))', '}'),
  src('rubicon/base/build.gradle.kts', LIB),
];

const RUBICON_DEFAULTS = src('rubicon/base/src/main/res/xml/remote_config_defaults.xml',
  '<?xml version="1.0" encoding="utf-8"?>',
  '<defaults>',
  '    <entry>',
  '        <key>enable_dark_mode</key>',
  '        <value>false</value>',
  '    </entry>',
  '</defaults>',
);

const sweeper = (module: string) => src(`${module}/src/main/java/com/x/RemoteConfigListScreen.kt`,
  'package com.x',
  '',
  'import com.google.firebase.remoteconfig.FirebaseRemoteConfig',
  '',
  'fun rows() = FirebaseRemoteConfig.getInstance().all.map { (k, v) -> k to v.asString() }',
);

const dead = (sources: Src[]) => (rc.findUnusedRemoteConfigKeys({ sources }) as any[]).map(k => k.name);
const outcome = (sources: Src[]) =>
  (rc.explainRemoteConfigKeys({ sources }) as any[]).find(d => d.name === 'enable_dark_mode')?.outcome;

describe('G58, la portee d un lecteur de toutes les cles', () => {
  it('un lecteur de replica ne masque pas une cle de rubicon', () => {
    const sources = [settings(), ...MODULES, RUBICON_DEFAULTS, sweeper('replica/app')];
    expect(dead(sources)).toEqual(['enable_dark_mode']);
    expect(outcome(sources)).toBe('unreferenced');
  });

  it('meme chose depuis un module de bibliotheque que seul replica embarque', () => {
    const sources = [settings(), ...MODULES, RUBICON_DEFAULTS, sweeper('replica/common')];
    expect(dead(sources)).toEqual(['enable_dark_mode']);
  });

  it('une cle declaree dans les deux applications : seule la declaration de rubicon sort', () => {
    // La forme reelle de develop : 24 des 25 cles de l oracle etaient aussi
    // dans les trois variantes de replica/app, et juger la cle d un bloc la
    // masquait entiere.
    const replicaDefaults = src('replica/app/src/main/res/xml/remote_config_defaults.xml',
      '<?xml version="1.0" encoding="utf-8"?>',
      '<defaults>',
      '    <entry>',
      '        <key>enable_dark_mode</key>',
      '        <value>false</value>',
      '    </entry>',
      '</defaults>',
    );
    const sources = [settings(), ...MODULES, RUBICON_DEFAULTS, replicaDefaults, sweeper('replica/app')];
    const found = rc.findUnusedRemoteConfigKeys({ sources }) as any[];
    expect(found.map(k => k.name)).toEqual(['enable_dark_mode']);
    expect(found[0].declarations.map((d: any) => d.path)).toEqual([RUBICON_DEFAULTS.path]);
    const rows = (rc.explainRemoteConfigKeys({ sources }) as any[]).filter(d => d.name === 'enable_dark_mode');
    expect(rows.find(r => r.path === RUBICON_DEFAULTS.path)?.outcome).toBe('unreferenced');
    expect(rows.find(r => r.path === replicaDefaults.path)?.outcome).toMatch(/^R4:every-key-read:/);
  });

  it('garde : un lecteur de la meme application masque toujours la cle', () => {
    const sources = [settings(), ...MODULES, RUBICON_DEFAULTS, sweeper('rubicon/app')];
    expect(dead(sources)).toEqual([]);
    expect(outcome(sources)).toMatch(/^R4:every-key-read:.*rubicon\/app/);
  });

  it('garde : un module partage par les deux applications masque la cle', () => {
    const shared = MODULES.map(m => m.path.endsWith('rubicon/app/build.gradle.kts')
      ? src('rubicon/app/build.gradle.kts', APP, 'dependencies {', '    implementation(project(":rubicon:base"))', '    implementation(project(":replica:common"))', '}')
      : m);
    const sources = [settings(), ...shared, RUBICON_DEFAULTS, sweeper('replica/common')];
    expect(dead(sources)).toEqual([]);
  });

  it('garde : sans settings.gradle, la portee reste tout le depot', () => {
    const sources = [...MODULES, RUBICON_DEFAULTS, sweeper('replica/app')];
    expect(dead(sources)).toEqual([]);
  });

  it('garde : un projectDir remappe rend le graphe illisible', () => {
    const sources = [settings('project(":rubicon:base").projectDir = file("libs/base")'), ...MODULES, RUBICON_DEFAULTS, sweeper('replica/app')];
    expect(dead(sources)).toEqual([]);
  });

  it('garde : une dependance vers un module inconnu rend le graphe illisible', () => {
    const broken = MODULES.map(m => m.path.endsWith('replica/app/build.gradle.kts')
      ? src('replica/app/build.gradle.kts', APP, 'dependencies {', '    implementation(project(":ailleurs:lib"))', '}')
      : m);
    const sources = [settings(), ...broken, RUBICON_DEFAULTS, sweeper('replica/app')];
    expect(dead(sources)).toEqual([]);
  });

  it('garde : les accesseurs projects.x.y ne sont pas lus, portee tout le depot', () => {
    const typesafe = MODULES.map(m => m.path.endsWith('rubicon/app/build.gradle.kts')
      ? src('rubicon/app/build.gradle.kts', APP, 'dependencies {', '    implementation(projects.rubicon.base)', '}')
      : m);
    const sources = [settings(), ...typesafe, RUBICON_DEFAULTS, sweeper('replica/app')];
    expect(dead(sources)).toEqual([]);
  });
});
