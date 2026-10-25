import { describe, it, expect } from 'vitest';
import { classifyVersionLiteral } from '../../../src/upgrades/versionLiteral';

/**
 * KJ-082, what kind of version text a build wrote.
 *
 * Only an exact version can be compared with a repository and bumped. A
 * dynamic version such as `4.+` or `latest.release` moves on its own and
 * deserves a pin, not a bump. A range or a rich version (`strictly`,
 * `prefer`, `reject`) encodes a decision the tool cannot read, so it is left
 * alone, the way Renovate and version-catalog-update leave it alone. A
 * templated value (`$kotlinVersion`, `libs.versions.x.get()`) is not a
 * literal at all.
 */

describe('classifyVersionLiteral', () => {
  it.each(['2.9.0', '33.5.0-android', '1.0.0-SNAPSHOT', '2.5.0-Beta2', '2024.02.00', 'v1.2.3', '1.0.0_RC1'])(
    'reads %s as exact', text => { expect(classifyVersionLiteral(text)).toBe('exact'); });

  it.each(['1.+', '+', 'latest.release', 'latest.integration', '4.12.+'])(
    'reads %s as dynamic', text => { expect(classifyVersionLiteral(text)).toBe('dynamic'); });

  it.each(['[1.0, 2.0[', '(1.0, 2.0]', ']1.0, 2.0]', '[1.0,)'])(
    'reads %s as a range', text => { expect(classifyVersionLiteral(text)).toBe('range'); });

  it.each(['{ strictly = "1.2" }', '{ require = "[1.0, 2.0[", prefer = "1.5" }', 'version.strictly', '{ reject = ["1.1"] }', 'rejectAll = true'])(
    'reads %s as rich', text => { expect(classifyVersionLiteral(text)).toBe('rich'); });

  it.each(['$kotlinVersion', '${libs.versions.kotlin.get()}', 'libs.versions.x.get()', 'kotlinVersion', 'rootProject.ext.v'])(
    'reads %s as templated', text => { expect(classifyVersionLiteral(text)).toBe('templated'); });

  it('reads an empty text as none', () => {
    expect(classifyVersionLiteral('')).toBe('none');
    expect(classifyVersionLiteral('   ')).toBe('none');
  });
});
