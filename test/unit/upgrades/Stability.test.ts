import { describe, it, expect } from 'vitest';
import { isStable } from '../../../src/upgrades/gradleVersion';

/**
 * KJ-082, what counts as a stable version.
 *
 * A repository's `release` field is no signal: the Gradle plugin portal lists
 * `2.5.0-Beta2` as the release of the Kotlin Android plugin. So stability is
 * read from the version text, with the rule the gradle versions plugin
 * documents: a version made of digits, dots, commas, dashes and a leading v,
 * optionally followed by `-r`, `-jre` or `-android`, is stable; a version with
 * a whole part spelled release, final or ga is stable too. Everything else,
 * alpha, beta, rc, snapshot, dev, milestone, eap, is a preview. One tightening
 * over the plugin's rule: the keyword must be a whole part, so `1.0-omega` is
 * not stable because it happens to contain `ga`.
 */

describe('isStable', () => {
  it.each([
    '2.9.0', '2024.02.00', '33.5.0-android', '33.5.0-jre', '5.0.0.RELEASE', '2.2.21-2.0.5',
    '20240303', 'v1.2.3', '1.0-sp1', '1.0-FINAL', '2.0-ga', '7.0.0-r',
  ])('says %s is stable', v => {
    expect(isStable(v)).toBe(true);
  });

  it.each([
    '2.5.0-Beta2', '9.6.0-alpha01', '9.5.0-rc01', '1.0-SNAPSHOT', '0.1.0-dev15', '2.0.0-M1',
    '1.7.0-native-mt', '1.0-eap', '1.0-omega', '1.13.0-beta02', '2.4.21-RC', '',
  ])('says %s is a preview', v => {
    expect(isStable(v)).toBe(false);
  });
});
