import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { collectBuildFileDependencies } from '../../../src/upgrades/buildFileDependencies';
import type { Dependency } from '../../../src/upgrades/model';

/**
 * KJ-082, versions written in build files.
 *
 * A catalog is not the only place a version lives: `implementation("g:a:v")`,
 * `classpath 'g:a:v'`, `id("x") version "y"` and `kotlin("jvm") version "y"`
 * carry literals the catalog never sees. Each literal becomes a dependency
 * whose version site is the bare version in the ORIGINAL text, so a bump
 * rewrites exactly that and nothing else. Comments are blanked with their
 * offsets kept, so a commented out line yields nothing and a line below a
 * long comment keeps its true position. A `$` makes a literal templated, a
 * trailing `+` dynamic, a two part coordinate has no version at all.
 */

const FILE = '/w/app/build.gradle.kts';
const collect = (text: string, kind: 'build' | 'settings' = 'build', file = FILE) => collectBuildFileDependencies(text, file, kind);
const byKey = (deps: Dependency[], key: string) => deps.find(d => d.key === key)!;
const siteText = (text: string, d: Dependency) => text.slice(d.versionSite!.start, d.versionSite!.end);

describe('coordinate literals in dependency blocks, Kotlin DSL', () => {
  const text = `
plugins {
    kotlin("jvm") version "1.9.24"
}
dependencies {
    implementation("com.squareup.retrofit2:retrofit:2.9.0")
    api("com.example.kiosk:core:1.0.0")
    testImplementation("junit:junit:4.13.2")
    implementation(platform("androidx.compose:compose-bom:2024.02.00"))
    implementation("com.example.portal:dyn:1.+")
    implementation("com.example.portal:tmpl:$v")
    implementation("com.example.portal:tmpl2:\${libs.versions.x.get()}")
    implementation(libs.gson)
    testRuntimeOnly("org.junit.platform:junit-platform-launcher")
}
`;
  const deps = collect(text);

  it('reads an exact literal with its bare version site, range with quotes, line and name', () => {
    const d = byKey(deps, 'library:com.squareup.retrofit2:retrofit');
    expect(d.kind).toBe('library');
    expect(d.group).toBe('com.squareup.retrofit2');
    expect(d.artifact).toBe('retrofit');
    expect(d.members).toEqual([{ group: 'com.squareup.retrofit2', artifact: 'retrofit' }]);
    expect(d.currentVersion).toBe('2.9.0');
    expect(d.literal).toBe('exact');
    expect(siteText(text, d)).toBe('2.9.0');
    expect(d.versionSite!.text).toBe('2.9.0');
    expect(text.slice(d.range.start, d.range.end)).toBe('"com.squareup.retrofit2:retrofit:2.9.0"');
    expect(d.line).toBe(5);
    expect(d.source).toBe('build-literal');
    expect(d.name).toBe('com.squareup.retrofit2:retrofit');
    expect(d.sharedBy).toEqual([]);
  });

  it('reads api and testImplementation the same way', () => {
    expect(byKey(deps, 'library:com.example.kiosk:core').currentVersion).toBe('1.0.0');
    expect(byKey(deps, 'library:junit:junit').currentVersion).toBe('4.13.2');
  });

  it('treats a platform() BOM as a library', () => {
    const d = byKey(deps, 'library:androidx.compose:compose-bom');
    expect(d.currentVersion).toBe('2024.02.00');
    expect(d.literal).toBe('exact');
  });

  it('marks a trailing plus as dynamic and keeps the site so a pin can rewrite it', () => {
    const d = byKey(deps, 'library:com.example.portal:dyn');
    expect(d.literal).toBe('dynamic');
    expect(d.currentVersion).toBe('1.+');
    expect(siteText(text, d)).toBe('1.+');
  });

  it('marks a version with a dollar as templated, without a version site', () => {
    expect(byKey(deps, 'library:com.example.portal:tmpl').literal).toBe('templated');
    expect(byKey(deps, 'library:com.example.portal:tmpl').versionSite).toBeUndefined();
    expect(byKey(deps, 'library:com.example.portal:tmpl2').literal).toBe('templated');
  });

  it('ignores a catalog accessor, and gives a two part coordinate no version', () => {
    expect(deps.some(d => d.key.includes('gson'))).toBe(false);
    const launcher = byKey(deps, 'library:org.junit.platform:junit-platform-launcher');
    expect(launcher.literal).toBe('none');
    expect(launcher.currentVersion).toBeUndefined();
    expect(launcher.versionSite).toBeUndefined();
  });
});

describe('plugin versions', () => {
  const text = `
plugins {
    kotlin("jvm") version "1.9.24"
    kotlin("plugin.serialization") version "1.9.24"
    id("org.jetbrains.compose") version "1.6.11" apply false
    id("com.android.application") version "8.2.0" apply false
    id("com.android.library") version "8.2.0" apply false
    alias(libs.plugins.hilt)
    id("com.example.convention")
}
`;
  const deps = collect(text);

  it('maps kotlin("jvm") to its plugin id and the plugin marker artifact', () => {
    const d = byKey(deps, 'plugin:org.jetbrains.kotlin.jvm');
    expect(d.kind).toBe('plugin');
    expect(d.members).toEqual([{ group: 'org.jetbrains.kotlin.jvm', artifact: 'org.jetbrains.kotlin.jvm.gradle.plugin' }]);
    expect(d.currentVersion).toBe('1.9.24');
    expect(siteText(text, d)).toBe('1.9.24');
    expect(d.source).toBe('build-plugin');
    expect(d.name).toBe('org.jetbrains.kotlin.jvm');
    expect(d.line).toBe(2);
    expect(byKey(deps, 'plugin:org.jetbrains.kotlin.plugin.serialization').currentVersion).toBe('1.9.24');
  });

  it('keeps a plugin declared with apply false', () => {
    const d = byKey(deps, 'plugin:org.jetbrains.compose');
    expect(d.currentVersion).toBe('1.6.11');
    expect(text.slice(d.range.start, d.range.end)).toBe('"1.6.11"');
  });

  it('reads an Android Gradle plugin id as the agp dependency, one key per site', () => {
    const agp = deps.filter(d => d.kind === 'agp');
    expect(agp.map(d => d.key)).toEqual(['agp', 'agp#2']);
    expect(agp[0].currentVersion).toBe('8.2.0');
    expect(agp[0].name).toBe('com.android.application');
    expect(agp[0].members).toEqual([{ group: 'com.android.application', artifact: 'com.android.application.gradle.plugin' }]);
  });

  it('ignores an alias and a plugin without a version', () => {
    expect(deps.some(d => d.key.includes('hilt'))).toBe(false);
    expect(deps.some(d => d.key.includes('convention'))).toBe(false);
  });
});

describe('Groovy DSL and settings files', () => {
  it('reads single quoted and parenthesis free forms, and classpath of the Android plugin as agp', () => {
    const text = `
buildscript {
    dependencies {
        classpath 'com.android.tools.build:gradle:8.2.0'
        classpath "org.jetbrains.kotlin:kotlin-gradle-plugin:1.9.22"
    }
}
plugins { id 'org.jetbrains.kotlin.android' version '1.9.22' }
dependencies {
    implementation 'com.squareup.okhttp3:okhttp:4.12.0'
    kapt "com.google.dagger:hilt-compiler:2.50"
    annotationProcessor 'androidx.room:room-compiler:2.6.1'
}
`;
    const deps = collect(text, 'build', '/w/app/build.gradle');
    const agp = byKey(deps, 'agp');
    expect(agp.kind).toBe('agp');
    expect(agp.group).toBe('com.android.tools.build');
    expect(agp.artifact).toBe('gradle');
    expect(agp.currentVersion).toBe('8.2.0');
    expect(siteText(text, agp)).toBe('8.2.0');
    expect(byKey(deps, 'library:org.jetbrains.kotlin:kotlin-gradle-plugin').currentVersion).toBe('1.9.22');
    expect(byKey(deps, 'plugin:org.jetbrains.kotlin.android').currentVersion).toBe('1.9.22');
    expect(byKey(deps, 'library:com.squareup.okhttp3:okhttp').currentVersion).toBe('4.12.0');
    expect(byKey(deps, 'library:com.google.dagger:hilt-compiler').currentVersion).toBe('2.50');
    expect(byKey(deps, 'library:androidx.room:room-compiler').currentVersion).toBe('2.6.1');
  });

  it('reads pluginManagement plugins in a settings file as settings plugins', () => {
    const text = `
pluginManagement {
    repositories { gradlePluginPortal() }
    plugins {
        id("org.jetbrains.kotlin.jvm") version "1.9.24"
        kotlin("android") version "1.9.24"
    }
}
`;
    const deps = collect(text, 'settings', '/w/settings.gradle.kts');
    expect(deps.map(d => d.key).sort()).toEqual(['plugin:org.jetbrains.kotlin.android', 'plugin:org.jetbrains.kotlin.jvm']);
    expect(deps.every(d => d.source === 'settings-plugin')).toBe(true);
  });
});

describe('comments, offsets and pins', () => {
  it('yields nothing for a commented out line and keeps true offsets below a comment', () => {
    const text = `// implementation("com.example.kiosk:old:0.1.0") and a "quoted" word
/* block
   implementation("com.example.kiosk:older:0.0.1") */
dependencies {
    implementation("com.example.kiosk:core:1.0.0")
}
`;
    const deps = collect(text);
    expect(deps.map(d => d.key)).toEqual(['library:com.example.kiosk:core']);
    expect(siteText(text, deps[0])).toBe('1.0.0');
    expect(deps[0].line).toBe(4);
  });

  it('reads a pin comment on the line and the ignore marker on the line above', () => {
    const text = `
dependencies {
    implementation("com.example.kiosk:core:1.0.0") // @pin
    // kotlin-jump:ignore dependency-upgrade
    implementation("com.example.kiosk:ui:2.0.0")
    implementation("com.example.kiosk:free:3.0.0")
}
`;
    const deps = collect(text);
    expect(byKey(deps, 'library:com.example.kiosk:core').pin).toBe('pin-comment');
    expect(byKey(deps, 'library:com.example.kiosk:ui').pin).toBe('ignore-marker');
    expect(byKey(deps, 'library:com.example.kiosk:free').pin).toBeUndefined();
  });

  it('numbers a repeated coordinate so keys stay unique within the file', () => {
    const text = `
dependencies {
    implementation("com.example.kiosk:core:1.0.0")
    testImplementation("com.example.kiosk:core:1.0.0")
}
`;
    expect(collect(text).map(d => d.key)).toEqual(['library:com.example.kiosk:core', 'library:com.example.kiosk:core#2']);
  });
});

describe('the demo fixture build file', () => {
  it('yields its two literal plugin versions and the versionless launcher, nothing else', () => {
    const file = path.join(__dirname, '../../kotlin-jump-demo/build.gradle.kts');
    const text = fs.readFileSync(file, 'utf8');
    const deps = collectBuildFileDependencies(text, file, 'build');
    expect(deps.map(d => `${d.key}=${d.currentVersion ?? ''}`).sort()).toEqual([
      'library:org.junit.platform:junit-platform-launcher=',
      'plugin:org.jetbrains.compose=1.6.11',
      'plugin:org.jetbrains.kotlin.jvm=1.9.24',
    ]);
    const kotlin = byKey(deps, 'plugin:org.jetbrains.kotlin.jvm');
    expect(text.slice(kotlin.versionSite!.start, kotlin.versionSite!.end)).toBe('1.9.24');
  });
});
