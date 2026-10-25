import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { collectCatalogDependencies } from '../../../src/upgrades/catalogDependencies';

/**
 * KJ-082, the catalog side of dependency upgrades: one dependency per VERSION
 * SITE, not per library.
 *
 * A `[versions]` entry shared by four libraries is one site with four members:
 * bumping it moves all four, and a candidate has to exist for every one of
 * them. The parser the hover already uses (`parseCatalog`) knows the aliases
 * but not where the version text sits, so this module adds the exact offsets
 * of the bare literal, quotes excluded, which is what a quick fix replaces.
 * Inline versions and `"group:artifact:version"` shorthands get a site of
 * their own; a library without a version is managed by a BOM and says so; a
 * rich version is left alone; `# @pin` and the ignore marker hold an entry
 * back. On the demo catalog, 25 version keys and 5 plugin ids yield 23 sites.
 */

const DEMO = fs.readFileSync(path.join(__dirname, '../../kotlin-jump-demo/gradle/libs.versions.toml'), 'utf8');
const FILE = '/w/gradle/libs.versions.toml';

const collect = (text: string) => collectCatalogDependencies(text, FILE);
const byName = (text: string, name: string) => collect(text).dependencies.find(d => d.name === name)!;

describe('KJ-082 catalog dependencies: one site, its members', () => {
  it('reads a shared [versions] entry as one dependency with every library that references it', () => {
    const compose = byName(DEMO, 'compose');
    expect(compose.kind).toBe('library');
    expect(compose.key).toBe('versions:compose');
    expect(compose.currentVersion).toBe('1.6.2');
    expect(compose.literal).toBe('exact');
    expect(compose.source).toBe('toml-versions');
    expect(compose.members.map(m => `${m.group}:${m.artifact}`).sort()).toEqual([
      'androidx.compose.foundation:foundation',
      'androidx.compose.ui:ui',
      'androidx.compose.ui:ui-tooling',
      'androidx.compose.ui:ui-tooling-preview',
    ]);
    expect(compose.sharedBy.map(s => s.alias).sort()).toEqual(['compose-foundation', 'compose-ui', 'compose-ui-tooling', 'compose-ui-tooling-preview']);
    expect(compose.line).toBe(15);
  });

  it('points the version site at the bare literal, quotes excluded, so a replacement keeps the quotes', () => {
    const compose = byName(DEMO, 'compose');
    expect(DEMO.slice(compose.versionSite!.start, compose.versionSite!.end)).toBe('1.6.2');
    expect(DEMO[compose.versionSite!.start - 1]).toBe('"');
    expect(DEMO[compose.versionSite!.end]).toBe('"');
    expect(DEMO.slice(compose.range.start, compose.range.end)).toBe('"1.6.2"');
  });

  it('keeps offsets right with CRLF line endings', () => {
    const crlf = DEMO.replace(/\n/g, '\r\n');
    const compose = collectCatalogDependencies(crlf, FILE).dependencies.find(d => d.name === 'compose')!;
    expect(crlf.slice(compose.versionSite!.start, compose.versionSite!.end)).toBe('1.6.2');
    expect(compose.line).toBe(15);
  });

  it('a plugin member is its marker artifact, and a site read only by plugins is a plugin site', () => {
    const kotlin = byName(DEMO, 'kotlin');
    expect(kotlin.kind).toBe('plugin');
    expect(kotlin.members.map(m => `${m.group}:${m.artifact}`)).toContain('org.jetbrains.kotlin.jvm:org.jetbrains.kotlin.jvm.gradle.plugin');
    expect(kotlin.members).toHaveLength(3);
  });

  it('the Android Gradle plugin ids make an agp site', () => {
    const agp = byName(DEMO, 'agp');
    expect(agp.kind).toBe('agp');
    expect(agp.currentVersion).toBe('8.2.0');
    expect(agp.members.map(m => m.group).sort()).toEqual(['com.android.application', 'com.android.library']);
  });

  it('a site read by a library and a plugin at once is a library site with both as members', () => {
    const hilt = byName(DEMO, 'hilt');
    expect(hilt.kind).toBe('library');
    expect(hilt.members.map(m => `${m.group}:${m.artifact}`).sort()).toEqual([
      'com.google.dagger.hilt.android:com.google.dagger.hilt.android.gradle.plugin',
      'com.google.dagger:hilt-android',
      'com.google.dagger:hilt-android-compiler',
    ]);
  });

  it('a [versions] entry nothing references is not a dependency', () => {
    const text = '[versions]\nlost = "1.0.0"\nused = "2.0.0"\n\n[libraries]\nk = { module = "com.example.kiosk:core", version.ref = "used" }\n';
    expect(collect(text).dependencies.map(d => d.name)).toEqual(['used']);
  });
});

describe('KJ-082 catalog dependencies: inline versions, shorthands, BOMs, rich versions', () => {
  const TEXT = [
    '[versions]',
    'okio = { strictly = "3.9.0" }',
    'okhttp = "4.+"',
    '',
    '[libraries]',
    'portal-net = { module = "com.example.portal:net", version = "2.3.4" }',
    'portal-json = "com.example.portal:json:1.2.0"',
    'kiosk-ui = { module = "com.example.kiosk:ui" }',
    'kiosk-bom = { group = "com.example.kiosk", name = "bom", version = "2024.02.00" }',
    'okio-lib = { module = "com.squareup.okio:okio", version.ref = "okio" }',
    'okhttp-lib = { module = "com.squareup.okhttp3:okhttp", version.ref = "okhttp" }',
    'strict-lib = { module = "com.example.kiosk:strict", version = { strictly = "1.0" } }',
    '',
  ].join('\n');

  it('an inline version is a site of its own, at the literal inside the inline table', () => {
    const net = byName(TEXT, 'portal-net');
    expect(net.key).toBe('library:com.example.portal:net');
    expect(net.source).toBe('toml-inline');
    expect(net.currentVersion).toBe('2.3.4');
    expect(TEXT.slice(net.versionSite!.start, net.versionSite!.end)).toBe('2.3.4');
    expect(net.sharedBy).toEqual([]);
    expect(net.members).toEqual([{ group: 'com.example.portal', artifact: 'net' }]);
  });

  it('a "group:artifact:version" shorthand is a site at its third field', () => {
    const json = byName(TEXT, 'portal-json');
    expect(json.source).toBe('toml-shorthand');
    expect(json.currentVersion).toBe('1.2.0');
    expect(TEXT.slice(json.versionSite!.start, json.versionSite!.end)).toBe('1.2.0');
  });

  it('a library without a version is managed elsewhere: no literal, nothing to bump', () => {
    const ui = byName(TEXT, 'kiosk-ui');
    expect(ui.literal).toBe('none');
    expect(ui.currentVersion).toBeUndefined();
    expect(ui.versionSite).toBeUndefined();
    expect(TEXT.slice(ui.range.start, ui.range.end)).toBe('kiosk-ui');
  });

  it('a rich version is reported as rich, whether on the [versions] entry or inline', () => {
    expect(byName(TEXT, 'okio').literal).toBe('rich');
    expect(byName(TEXT, 'strict-lib').literal).toBe('rich');
  });

  it('a dynamic version keeps its site, so a pin can replace it', () => {
    const okhttp = byName(TEXT, 'okhttp');
    expect(okhttp.literal).toBe('dynamic');
    expect(TEXT.slice(okhttp.versionSite!.start, okhttp.versionSite!.end)).toBe('4.+');
  });
});

describe('KJ-082 catalog dependencies: pins, markers, unreadable catalogs', () => {
  const TEXT = [
    '[versions]',
    'glide = "4.16.0" # @pin',
    'coil = "2.5.0"',
    'room = "2.6.1" # @keep',
    '',
    '[libraries]',
    'glide-core = { module = "com.github.bumptech.glide:glide", version.ref = "glide" }',
    'coil-core = { module = "io.coil-kt:coil", version.ref = "coil" } # @pin',
    'room-runtime = { module = "androidx.room:room-runtime", version.ref = "room" }',
    '',
  ].join('\n');

  it('# @pin on the [versions] line pins the site', () => {
    expect(byName(TEXT, 'glide').pin).toBe('pin-comment');
  });

  it('# @pin on an alias that reads a shared entry pins that entry', () => {
    expect(byName(TEXT, 'coil').pin).toBe('pin-comment');
  });

  it('# @keep is not a pin', () => {
    expect(byName(TEXT, 'room').pin).toBeUndefined();
  });

  it('a line holding only the ignore marker holds the whole file back', () => {
    const marked = `# kotlin-jump:ignore dependency-upgrade\n${TEXT}`;
    for (const d of collect(marked).dependencies) expect(d.pin).toBe('ignore-marker');
  });

  it('an unreadable catalog yields nothing, and says so', () => {
    const broken = '[versions]\nkotlin = "1.9.22"\n\n[libraries]\nbad = { module = "com.example.kiosk:core", version.ref = "kotlin"\n';
    const r = collect(broken);
    expect(r.unparsed).toBe(true);
    expect(r.dependencies).toEqual([]);
  });
});
