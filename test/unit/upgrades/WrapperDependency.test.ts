import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { bumpWrapperUrl, collectWrapperDependency, distributionType, hasChecksum } from '../../../src/upgrades/wrapperDependency';

/**
 * KJ-082, the Gradle wrapper as a dependency.
 *
 * `gradle/wrapper/gradle-wrapper.properties` names the Gradle version inside
 * an escaped URL: `distributionUrl=https\://services.gradle.org/distributions/gradle-9.2.1-bin.zip`.
 * The reader unescapes `\:`, keeps the distribution type, and points the
 * version site at the bare version so a bump rewrites nothing else. When the
 * file pins a `distributionSha256Sum`, a bump without the new checksum would
 * break the next build, so the edit is refused until the caller supplies it.
 */

const WRAPPER = [
  'distributionBase=GRADLE_USER_HOME',
  'distributionPath=wrapper/dists',
  'distributionUrl=https\\://services.gradle.org/distributions/gradle-9.2.1-bin.zip',
  'networkTimeout=10000',
  'zipStoreBase=GRADLE_USER_HOME',
].join('\n');
const FILE = '/w/gradle/wrapper/gradle-wrapper.properties';

describe('collectWrapperDependency', () => {
  it('reads the version out of the escaped URL and the type of the distribution', () => {
    const dep = collectWrapperDependency(WRAPPER, FILE)!;
    expect(dep.kind).toBe('wrapper');
    expect(dep.key).toBe('wrapper');
    expect(dep.currentVersion).toBe('9.2.1');
    expect(dep.literal).toBe('exact');
    expect(dep.members).toEqual([{ group: 'org.gradle', artifact: 'gradle' }]);
    expect(dep.name).toBe('Gradle');
    expect(dep.source).toBe('wrapper');
    expect(dep.sharedBy).toEqual([]);
    expect(dep.line).toBe(2);
    expect(distributionType(WRAPPER)).toBe('bin');
  });

  it('points the version site at the bare version in the original text, and the range at the whole value', () => {
    const dep = collectWrapperDependency(WRAPPER, FILE)!;
    const site = dep.versionSite!;
    expect(WRAPPER.slice(site.start, site.end)).toBe('9.2.1');
    expect(site.text).toBe('9.2.1');
    expect(site.file).toBe(FILE);
    expect(WRAPPER.slice(dep.range.start, dep.range.end)).toBe('https\\://services.gradle.org/distributions/gradle-9.2.1-bin.zip');
  });

  it('reads the all distribution, a release candidate, a milestone and a nightly as exact literals', () => {
    const at = (v: string, type = 'all') => collectWrapperDependency(`distributionUrl=https\\://services.gradle.org/distributions/gradle-${v}-${type}.zip\n`, FILE)!;
    expect(at('9.9.0').currentVersion).toBe('9.9.0');
    expect(distributionType(`distributionUrl=https\\://services.gradle.org/distributions/gradle-9.9.0-all.zip\n`)).toBe('all');
    expect(at('9.9.0-rc-1').currentVersion).toBe('9.9.0-rc-1');
    expect(at('9.9.0-milestone-1').currentVersion).toBe('9.9.0-milestone-1');
    expect(at('9.9.0-20261001000000+0000', 'bin').currentVersion).toBe('9.9.0-20261001000000+0000');
    expect(at('9.9.0-rc-1').literal).toBe('exact');
  });

  it('accepts an unescaped URL as well', () => {
    const dep = collectWrapperDependency('distributionUrl=https://services.gradle.org/distributions/gradle-8.13-bin.zip\n', FILE)!;
    expect(dep.currentVersion).toBe('8.13');
  });

  it('returns nothing without a distributionUrl, or for a distribution that is not Gradle\'s own', () => {
    expect(collectWrapperDependency('distributionBase=GRADLE_USER_HOME\n', FILE)).toBeUndefined();
    expect(collectWrapperDependency('distributionUrl=https\\://mirror.example.com/gradle-9.2.1-bin.zip\n', FILE)).toBeUndefined();
    expect(collectWrapperDependency('distributionUrl=https\\://services.gradle.org/distributions/other-9.2.1-bin.zip\n', FILE)).toBeUndefined();
  });
});

describe('hasChecksum and bumpWrapperUrl', () => {
  const PINNED = WRAPPER + '\ndistributionSha256Sum=0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

  it('knows when a checksum line pins the distribution', () => {
    expect(hasChecksum(WRAPPER)).toBe(false);
    expect(hasChecksum(PINNED)).toBe(true);
  });

  it('bumps only the version, keeping the escaping and the distribution type', () => {
    const { text, edits } = bumpWrapperUrl(WRAPPER, '9.8.2');
    expect(text).toContain('distributionUrl=https\\://services.gradle.org/distributions/gradle-9.8.2-bin.zip');
    expect(text.split('\n').length).toBe(WRAPPER.split('\n').length);
    expect(edits).toHaveLength(1);
    expect(WRAPPER.slice(edits[0].start, edits[0].end)).toBe('9.2.1');
    expect(edits[0].newText).toBe('9.8.2');
  });

  it('refuses to bump a pinned distribution without the new checksum', () => {
    const { text, edits } = bumpWrapperUrl(PINNED, '9.8.2');
    expect(edits).toEqual([]);
    expect(text).toBe(PINNED);
  });

  it('rewrites the checksum together with the version when the caller supplies it', () => {
    const sha = 'fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210';
    const { text, edits } = bumpWrapperUrl(PINNED, '9.8.2', sha);
    expect(edits).toHaveLength(2);
    expect(text).toContain('gradle-9.8.2-bin.zip');
    expect(text).toContain(`distributionSha256Sum=${sha}`);
    expect(text).not.toContain('0123456789abcdef');
  });

  it('does nothing on a file without a wrapper URL', () => {
    const { text, edits } = bumpWrapperUrl('distributionBase=GRADLE_USER_HOME\n', '9.8.2');
    expect(edits).toEqual([]);
    expect(text).toBe('distributionBase=GRADLE_USER_HOME\n');
  });
});

describe('the demo fixture wrapper', () => {
  it('reads 9.2.1 on its third line', () => {
    const file = path.join(__dirname, '../../kotlin-jump-demo/gradle/wrapper/gradle-wrapper.properties');
    const dep = collectWrapperDependency(fs.readFileSync(file, 'utf8'), file)!;
    expect(dep.currentVersion).toBe('9.2.1');
    expect(dep.line).toBe(2);
  });
});
