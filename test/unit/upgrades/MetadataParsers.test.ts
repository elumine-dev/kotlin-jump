import { describe, it, expect } from 'vitest';
import {
  parseMavenMetadata, parseGoogleGroupIndex, parseGoogleMasterIndex, parseGradleCurrent,
  lastUpdatedToDate, looksLikeMetadataBody,
} from '../../../src/upgrades/metadataParsers';

/**
 * KJ-082, the metadata documents behind a version check.
 *
 * Four tiny machine written formats, read with regular expressions: Maven
 * Central's `maven-metadata.xml`, the Gradle plugin portal's marker metadata
 * (which carries a top level `<version>` before `<versioning>` that must not
 * be counted as a published version), Google Maven's `group-index.xml` and
 * `master-index.xml`, and `services.gradle.org/versions/current`. A document
 * that is not what it should be, an HTML captive portal page, a truncated
 * download, a group index of another group, yields `undefined` and never an
 * empty list: an empty list would be cached and would read as "no versions".
 */

const OKHTTP = `<?xml version="1.0" encoding="UTF-8"?>
<metadata>
  <groupId>com.squareup.okhttp3</groupId>
  <artifactId>okhttp</artifactId>
  <versioning>
    <latest>5.5.1</latest>
    <release>5.5.1</release>
    <versions>
      <version>3.0.0-RC1</version>
      <version>4.12.0</version>
      <version>5.0.0-alpha.1</version>
      <version>5.5.1</version>
    </versions>
    <lastUpdated>20261022124600</lastUpdated>
  </versioning>
</metadata>
`;

const PORTAL_KOTLIN_ANDROID = `<?xml version='1.0' encoding='US-ASCII'?>
<metadata>
      <groupId>org.jetbrains.kotlin.android</groupId>
      <artifactId>org.jetbrains.kotlin.android.gradle.plugin</artifactId>
      <version>2.5.0-Beta2</version>
      <versioning>
        <latest>2.5.0-Beta2</latest>
        <release>2.5.0-Beta2</release>
        <versions>
          <version>1.3.40</version>
          <version>2.2.21</version>
          <version>2.5.0-Beta2</version>
        </versions>
      </versioning>
</metadata>
`;

const COMPOSE_UI = `<?xml version='1.0' encoding='UTF-8'?>
<androidx.compose.ui>
  <ui versions="0.1.0-dev15,0.1.0-dev16,1.0.0-alpha01,1.6.2,1.9.0"/>
  <ui-tooling versions="1.6.2,1.9.0"/>
  <ui-text versions="1.9.0"></ui-text>
</androidx.compose.ui>
`;

const MASTER = `<?xml version='1.0' encoding='UTF-8'?>
<metadata>
  <android.arch.core/>
  <androidx.compose.ui/>
  <com.android.tools.build/>
  <com.google.devtools.ksp/>
</metadata>
`;

const GRADLE_CURRENT = '{"version":"9.8.2","buildTime":"20261019162926+0000","current":true,"snapshot":false,"nightly":false,"releaseNightly":false,"activeRc":false,"rcFor":"","milestoneFor":"","broken":false,"downloadUrl":"https://services.gradle.org/distributions/gradle-9.8.2-bin.zip","checksumUrl":"https://services.gradle.org/distributions/gradle-9.8.2-bin.zip.sha256","wrapperChecksumUrl":"https://services.gradle.org/distributions/gradle-9.8.2-wrapper.jar.sha256"}';

const CAPTIVE_PORTAL = '<!DOCTYPE html>\n<html><head><title>Sign in</title></head><body>Welcome to the lobby network</body></html>';

describe('parseMavenMetadata', () => {
  it('reads coordinates, latest, release, every version in order and lastUpdated from Maven Central', () => {
    const m = parseMavenMetadata(OKHTTP)!;
    expect(m.groupId).toBe('com.squareup.okhttp3');
    expect(m.artifactId).toBe('okhttp');
    expect(m.latest).toBe('5.5.1');
    expect(m.release).toBe('5.5.1');
    expect(m.versions).toEqual(['3.0.0-RC1', '4.12.0', '5.0.0-alpha.1', '5.5.1']);
    expect(m.lastUpdated).toBe('20261022124600');
  });

  it('does not count the plugin portal top level version as a published one, and returns release as written even when it is a Beta', () => {
    const m = parseMavenMetadata(PORTAL_KOTLIN_ANDROID)!;
    expect(m.versions).toEqual(['1.3.40', '2.2.21', '2.5.0-Beta2']);
    expect(m.release).toBe('2.5.0-Beta2');
    expect(m.latest).toBe('2.5.0-Beta2');
    expect(m.artifactId).toBe('org.jetbrains.kotlin.android.gradle.plugin');
  });

  it('ignores versions written inside an XML comment', () => {
    const xml = OKHTTP.replace('<version>4.12.0</version>', '<!-- <version>4.12.0</version> -->');
    expect(parseMavenMetadata(xml)!.versions).toEqual(['3.0.0-RC1', '5.0.0-alpha.1', '5.5.1']);
  });

  it('returns undefined, never an empty list, for an HTML page, a truncated document or an empty metadata element', () => {
    expect(parseMavenMetadata(CAPTIVE_PORTAL)).toBeUndefined();
    expect(parseMavenMetadata(OKHTTP.slice(0, OKHTTP.indexOf('<version>4.12.0')))).toBeUndefined();
    expect(parseMavenMetadata('<?xml version="1.0"?>\n<metadata/>\n')).toBeUndefined();
    expect(parseMavenMetadata('')).toBeUndefined();
  });
});

describe('parseGoogleGroupIndex', () => {
  it('reads every artifact of the group with its versions in document order', () => {
    expect(parseGoogleGroupIndex(COMPOSE_UI, 'androidx.compose.ui')).toEqual({
      'ui': ['0.1.0-dev15', '0.1.0-dev16', '1.0.0-alpha01', '1.6.2', '1.9.0'],
      'ui-tooling': ['1.6.2', '1.9.0'],
      'ui-text': ['1.9.0'],
    });
  });

  it('refuses a document whose root is another group, a truncated document and an HTML page', () => {
    expect(parseGoogleGroupIndex(COMPOSE_UI, 'androidx.compose.foundation')).toBeUndefined();
    expect(parseGoogleGroupIndex(COMPOSE_UI.slice(0, COMPOSE_UI.indexOf('<ui-tooling')), 'androidx.compose.ui')).toBeUndefined();
    expect(parseGoogleGroupIndex(CAPTIVE_PORTAL, 'androidx.compose.ui')).toBeUndefined();
  });

  it('reads the Android Gradle plugin tail, previews included, from the tools build group', () => {
    const xml = `<?xml version='1.0' encoding='UTF-8'?>\n<com.android.tools.build>\n  <gradle versions="8.13.0,9.5.0-rc01,9.6.0-alpha01"/>\n</com.android.tools.build>\n`;
    expect(parseGoogleGroupIndex(xml, 'com.android.tools.build')).toEqual({ gradle: ['8.13.0', '9.5.0-rc01', '9.6.0-alpha01'] });
  });
});

describe('parseGoogleMasterIndex', () => {
  it('lists the group ids of the master index', () => {
    expect(parseGoogleMasterIndex(MASTER)).toEqual(['android.arch.core', 'androidx.compose.ui', 'com.android.tools.build', 'com.google.devtools.ksp']);
  });

  it('refuses an HTML page, a truncated index and a metadata element with no group', () => {
    expect(parseGoogleMasterIndex(CAPTIVE_PORTAL)).toBeUndefined();
    expect(parseGoogleMasterIndex(MASTER.slice(0, MASTER.indexOf('<com.android')))).toBeUndefined();
    expect(parseGoogleMasterIndex('<metadata></metadata>')).toBeUndefined();
  });
});

describe('parseGradleCurrent', () => {
  it('reads the current Gradle version, and the release candidate when there is one', () => {
    expect(parseGradleCurrent(GRADLE_CURRENT)).toEqual({ current: '9.8.2' });
    expect(parseGradleCurrent(GRADLE_CURRENT, '{ }')).toEqual({ current: '9.8.2' });
    expect(parseGradleCurrent(GRADLE_CURRENT, '{"version":"9.9.0-rc-1","current":false,"activeRc":true}')).toEqual({ current: '9.8.2', rc: '9.9.0-rc-1' });
  });

  it('refuses a page that is not the JSON document', () => {
    expect(parseGradleCurrent(CAPTIVE_PORTAL)).toBeUndefined();
    expect(parseGradleCurrent('{"broken":true}')).toBeUndefined();
    expect(parseGradleCurrent('')).toBeUndefined();
  });
});

describe('lastUpdatedToDate', () => {
  it('turns the yyyyMMddHHmmss stamp into a date, and refuses anything else', () => {
    expect(lastUpdatedToDate('20261022124600')).toBe('2026-10-22');
    expect(lastUpdatedToDate('2026')).toBeUndefined();
    expect(lastUpdatedToDate('')).toBeUndefined();
  });
});

describe('looksLikeMetadataBody', () => {
  it('accepts the four document shapes and refuses HTML, with or without an XML declaration in front', () => {
    expect(looksLikeMetadataBody(OKHTTP)).toBe(true);
    expect(looksLikeMetadataBody(COMPOSE_UI)).toBe(true);
    expect(looksLikeMetadataBody(MASTER)).toBe(true);
    expect(looksLikeMetadataBody(GRADLE_CURRENT)).toBe(true);
    expect(looksLikeMetadataBody('﻿' + OKHTTP)).toBe(true);
    expect(looksLikeMetadataBody(CAPTIVE_PORTAL)).toBe(false);
    expect(looksLikeMetadataBody('<?xml version="1.0"?>\n<html><body>portal</body></html>')).toBe(false);
    expect(looksLikeMetadataBody('')).toBe(false);
    expect(looksLikeMetadataBody('Not Found')).toBe(false);
  });
});
