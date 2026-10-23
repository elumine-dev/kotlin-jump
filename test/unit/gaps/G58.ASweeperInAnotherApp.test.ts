import { describe, it, expect } from 'vitest';
import { importOrNull } from '../kj/harness';

/**
 * G58, un lecteur de toutes les cles dans une AUTRE application.
 *
 * Oracle : `7d356324a0` sur le projet de reference retire a la main 25 cles de
 * `portal/base/src/main/res/xml/remote_config_defaults.xml`. KJ les rendait
 * toutes `R4:every-key-read`, et le fichier qui eteignait la famille etait
 * `kiosk/app/.../adminV2/remoteconfig/RemoteConfigListScreen.kt` :
 *
 *   FirebaseRemoteConfig.getInstance().all
 *
 * Un ecran de kiosk ne lit jamais une cle de portal : autre application,
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
  '    ":kiosk:app",',
  '    ":kiosk:common",',
  '    ":portal:app",',
  '    ":portal:base",',
  ')',
  extra,
);

const MODULES: Src[] = [
  src('kiosk/app/build.gradle.kts', APP, 'dependencies {', '    implementation(project(":kiosk:common"))', '}'),
  src('kiosk/common/build.gradle.kts', LIB),
  src('portal/app/build.gradle.kts', APP, 'dependencies {', '    implementation(project(":portal:base"))', '}'),
  src('portal/base/build.gradle.kts', LIB),
];

const PORTAL_DEFAULTS = src('portal/base/src/main/res/xml/remote_config_defaults.xml',
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
  it('un lecteur de kiosk ne masque pas une cle de portal', () => {
    const sources = [settings(), ...MODULES, PORTAL_DEFAULTS, sweeper('kiosk/app')];
    expect(dead(sources)).toEqual(['enable_dark_mode']);
    expect(outcome(sources)).toBe('unreferenced');
  });

  it('meme chose depuis un module de bibliotheque que seul kiosk embarque', () => {
    const sources = [settings(), ...MODULES, PORTAL_DEFAULTS, sweeper('kiosk/common')];
    expect(dead(sources)).toEqual(['enable_dark_mode']);
  });

  it('une cle declaree dans les deux applications : seule la declaration de portal sort', () => {
    // La forme reelle de develop : 24 des 25 cles de l oracle etaient aussi
    // dans les trois variantes de kiosk/app, et juger la cle d un bloc la
    // masquait entiere.
    const kioskDefaults = src('kiosk/app/src/main/res/xml/remote_config_defaults.xml',
      '<?xml version="1.0" encoding="utf-8"?>',
      '<defaults>',
      '    <entry>',
      '        <key>enable_dark_mode</key>',
      '        <value>false</value>',
      '    </entry>',
      '</defaults>',
    );
    const sources = [settings(), ...MODULES, PORTAL_DEFAULTS, kioskDefaults, sweeper('kiosk/app')];
    const found = rc.findUnusedRemoteConfigKeys({ sources }) as any[];
    expect(found.map(k => k.name)).toEqual(['enable_dark_mode']);
    expect(found[0].declarations.map((d: any) => d.path)).toEqual([PORTAL_DEFAULTS.path]);
    const rows = (rc.explainRemoteConfigKeys({ sources }) as any[]).filter(d => d.name === 'enable_dark_mode');
    expect(rows.find(r => r.path === PORTAL_DEFAULTS.path)?.outcome).toBe('unreferenced');
    expect(rows.find(r => r.path === kioskDefaults.path)?.outcome).toMatch(/^R4:every-key-read:/);
  });

  it('garde : un lecteur de la meme application masque toujours la cle', () => {
    const sources = [settings(), ...MODULES, PORTAL_DEFAULTS, sweeper('portal/app')];
    expect(dead(sources)).toEqual([]);
    expect(outcome(sources)).toMatch(/^R4:every-key-read:.*portal\/app/);
  });

  it('garde : un module partage par les deux applications masque la cle', () => {
    const shared = MODULES.map(m => m.path.endsWith('portal/app/build.gradle.kts')
      ? src('portal/app/build.gradle.kts', APP, 'dependencies {', '    implementation(project(":portal:base"))', '    implementation(project(":kiosk:common"))', '}')
      : m);
    const sources = [settings(), ...shared, PORTAL_DEFAULTS, sweeper('kiosk/common')];
    expect(dead(sources)).toEqual([]);
  });

  it('garde : sans settings.gradle, la portee reste tout le depot', () => {
    const sources = [...MODULES, PORTAL_DEFAULTS, sweeper('kiosk/app')];
    expect(dead(sources)).toEqual([]);
  });

  it('garde : un projectDir remappe rend le graphe illisible', () => {
    const sources = [settings('project(":portal:base").projectDir = file("libs/base")'), ...MODULES, PORTAL_DEFAULTS, sweeper('kiosk/app')];
    expect(dead(sources)).toEqual([]);
  });

  it('garde : une dependance vers un module inconnu rend le graphe illisible', () => {
    const broken = MODULES.map(m => m.path.endsWith('kiosk/app/build.gradle.kts')
      ? src('kiosk/app/build.gradle.kts', APP, 'dependencies {', '    implementation(project(":ailleurs:lib"))', '}')
      : m);
    const sources = [settings(), ...broken, PORTAL_DEFAULTS, sweeper('kiosk/app')];
    expect(dead(sources)).toEqual([]);
  });

  it('garde : les accesseurs projects.x.y ne sont pas lus, portee tout le depot', () => {
    const typesafe = MODULES.map(m => m.path.endsWith('portal/app/build.gradle.kts')
      ? src('portal/app/build.gradle.kts', APP, 'dependencies {', '    implementation(projects.portal.base)', '}')
      : m);
    const sources = [settings(), ...typesafe, PORTAL_DEFAULTS, sweeper('kiosk/app')];
    expect(dead(sources)).toEqual([]);
  });
});
