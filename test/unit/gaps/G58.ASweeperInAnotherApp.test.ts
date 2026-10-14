import { describe, it, expect } from 'vitest';
import { importOrNull } from '../kj/harness';

/**
 * G58, un lecteur de toutes les cles dans une AUTRE application.
 *
 * Oracle : `7d356324a0` sur le projet de reference retire a la main 25 cles de
 * `saffron/base/src/main/res/xml/remote_config_defaults.xml`. KJ les rendait
 * toutes `R4:every-key-read`, et le fichier qui eteignait la famille etait
 * `juniper/app/.../adminV2/remoteconfig/ThrushPoplarRookScreen.kt` :
 *
 *   FirebaseRemoteConfig.getInstance().all
 *
 * Un ecran de juniper ne lit jamais une cle de saffron : autre application,
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
  '    ":juniper:app",',
  '    ":juniper:common",',
  '    ":saffron:app",',
  '    ":saffron:base",',
  ')',
  extra,
);

const MODULES: Src[] = [
  src('juniper/app/build.gradle.kts', APP, 'dependencies {', '    implementation(project(":juniper:common"))', '}'),
  src('juniper/common/build.gradle.kts', LIB),
  src('saffron/app/build.gradle.kts', APP, 'dependencies {', '    implementation(project(":saffron:base"))', '}'),
  src('saffron/base/build.gradle.kts', LIB),
];

const SAFFRON_DEFAULTS = src('saffron/base/src/main/res/xml/remote_config_defaults.xml',
  '<?xml version="1.0" encoding="utf-8"?>',
  '<defaults>',
  '    <entry>',
  '        <key>enable_dark_mode</key>',
  '        <value>false</value>',
  '    </entry>',
  '</defaults>',
);

const sweeper = (module: string) => src(`${module}/src/main/java/com/x/ThrushPoplarRookScreen.kt`,
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
  it('un lecteur de juniper ne masque pas une cle de saffron', () => {
    const sources = [settings(), ...MODULES, SAFFRON_DEFAULTS, sweeper('juniper/app')];
    expect(dead(sources)).toEqual(['enable_dark_mode']);
    expect(outcome(sources)).toBe('unreferenced');
  });

  it('meme chose depuis un module de bibliotheque que seul juniper embarque', () => {
    const sources = [settings(), ...MODULES, SAFFRON_DEFAULTS, sweeper('juniper/common')];
    expect(dead(sources)).toEqual(['enable_dark_mode']);
  });

  it('une cle declaree dans les deux applications : seule la declaration de saffron sort', () => {
    // La forme reelle de develop : 24 des 25 cles de l oracle etaient aussi
    // dans les trois variantes de juniper/app, et juger la cle d un bloc la
    // masquait entiere.
    const juniperDefaults = src('juniper/app/src/main/res/xml/remote_config_defaults.xml',
      '<?xml version="1.0" encoding="utf-8"?>',
      '<defaults>',
      '    <entry>',
      '        <key>enable_dark_mode</key>',
      '        <value>false</value>',
      '    </entry>',
      '</defaults>',
    );
    const sources = [settings(), ...MODULES, SAFFRON_DEFAULTS, juniperDefaults, sweeper('juniper/app')];
    const found = rc.findUnusedRemoteConfigKeys({ sources }) as any[];
    expect(found.map(k => k.name)).toEqual(['enable_dark_mode']);
    expect(found[0].declarations.map((d: any) => d.path)).toEqual([SAFFRON_DEFAULTS.path]);
    const rows = (rc.explainRemoteConfigKeys({ sources }) as any[]).filter(d => d.name === 'enable_dark_mode');
    expect(rows.find(r => r.path === SAFFRON_DEFAULTS.path)?.outcome).toBe('unreferenced');
    expect(rows.find(r => r.path === juniperDefaults.path)?.outcome).toMatch(/^R4:every-key-read:/);
  });

  it('garde : un lecteur de la meme application masque toujours la cle', () => {
    const sources = [settings(), ...MODULES, SAFFRON_DEFAULTS, sweeper('saffron/app')];
    expect(dead(sources)).toEqual([]);
    expect(outcome(sources)).toMatch(/^R4:every-key-read:.*saffron\/app/);
  });

  it('garde : un module partage par les deux applications masque la cle', () => {
    const shared = MODULES.map(m => m.path.endsWith('saffron/app/build.gradle.kts')
      ? src('saffron/app/build.gradle.kts', APP, 'dependencies {', '    implementation(project(":saffron:base"))', '    implementation(project(":juniper:common"))', '}')
      : m);
    const sources = [settings(), ...shared, SAFFRON_DEFAULTS, sweeper('juniper/common')];
    expect(dead(sources)).toEqual([]);
  });

  it('garde : sans settings.gradle, la portee reste tout le depot', () => {
    const sources = [...MODULES, SAFFRON_DEFAULTS, sweeper('juniper/app')];
    expect(dead(sources)).toEqual([]);
  });

  it('garde : un projectDir remappe rend le graphe illisible', () => {
    const sources = [settings('project(":saffron:base").projectDir = file("libs/base")'), ...MODULES, SAFFRON_DEFAULTS, sweeper('juniper/app')];
    expect(dead(sources)).toEqual([]);
  });

  it('garde : une dependance vers un module inconnu rend le graphe illisible', () => {
    const broken = MODULES.map(m => m.path.endsWith('juniper/app/build.gradle.kts')
      ? src('juniper/app/build.gradle.kts', APP, 'dependencies {', '    implementation(project(":ailleurs:lib"))', '}')
      : m);
    const sources = [settings(), ...broken, SAFFRON_DEFAULTS, sweeper('juniper/app')];
    expect(dead(sources)).toEqual([]);
  });

  it('garde : les accesseurs projects.x.y ne sont pas lus, portee tout le depot', () => {
    const typesafe = MODULES.map(m => m.path.endsWith('saffron/app/build.gradle.kts')
      ? src('saffron/app/build.gradle.kts', APP, 'dependencies {', '    implementation(projects.saffron.base)', '}')
      : m);
    const sources = [settings(), ...typesafe, SAFFRON_DEFAULTS, sweeper('juniper/app')];
    expect(dead(sources)).toEqual([]);
  });
});
