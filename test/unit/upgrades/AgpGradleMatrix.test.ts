import { describe, it, expect } from 'vitest';
import matrix from '../../../src/data/agp-gradle-matrix.json';
import { compareVersions } from '../../../src/upgrades/gradleVersion';
import { agpLines, minimumGradleOf } from '../../../scripts/refresh-agp-gradle-matrix';

/**
 * KJ-082, the bundled AGP to Gradle table and the script that refreshes it.
 *
 * There is no single page listing which Gradle each Android Gradle plugin
 * needs; each release notes page carries one Compatibility row, and the 8.7
 * page even wraps its cells in literal quotes. The table is produced by the
 * script, never typed by hand, and the rail that reads it stays silent on a
 * line it does not know. These tests pin the shape of the table and the two
 * readers of the script against real excerpts.
 */

describe('KJ-082 agp-gradle-matrix.json', () => {
  it('has a date, a source and one Gradle minimum per AGP line, non decreasing along the AGP lines', () => {
    expect(matrix.asOf).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(matrix.source).toContain('release-notes');
    const lines = Object.keys(matrix.minGradle);
    expect(lines.length).toBeGreaterThanOrEqual(19);
    for (const line of lines) {
      expect(line).toMatch(/^\d+\.\d+$/);
      expect(matrix.minGradle[line as keyof typeof matrix.minGradle]).toMatch(/^\d+(\.\d+)+$/);
    }
    const sorted = [...lines].sort((a, b) => compareVersions(a, b));
    for (let i = 1; i < sorted.length; i++) {
      const prev = matrix.minGradle[sorted[i - 1] as keyof typeof matrix.minGradle];
      const next = matrix.minGradle[sorted[i] as keyof typeof matrix.minGradle];
      expect(compareVersions(next, prev)).toBeGreaterThanOrEqual(0);
    }
    expect(matrix.minGradle['9.4']).toBe('9.6.0');
    expect(matrix.minGradle['8.13']).toBe('8.13');
  });
});

describe('KJ-082 refresh-agp-gradle-matrix readers', () => {
  it('lists the stable AGP lines of the Google group index from a given line, previews excluded', () => {
    const xml = '<com.android.tools.build><gradle versions="7.4.2,8.0.0,8.0.2,8.1.0-alpha01,8.1.0,9.0.0,9.5.0-rc01"/></com.android.tools.build>';
    expect(agpLines(xml, '8.0')).toEqual(['8.0', '8.1', '9.0']);
    expect(agpLines(xml, '7.0')).toEqual(['7.4', '8.0', '8.1', '9.0']);
  });

  it('reads the Gradle minimum from a Compatibility row, quoted cells included', () => {
    const plain = '<tr><td>Gradle</td><td>9.6.0</td><td>9.6.0</td><td>To learn more, see <a href="#">updating Gradle</a>.</td></tr>';
    expect(minimumGradleOf(plain)).toBe('9.6.0');
    const quoted = '<td align="right">"Gradle"</td> <td align="center">8.9</td> <td align="center">8.9</td> <td align="left">"To learn more, see <a href="/x">updating Gradle</a>."</td>';
    expect(minimumGradleOf(quoted)).toBe('8.9');
    expect(minimumGradleOf('<p>Android Gradle 外掛程式 8.0.0 版</p>')).toBeUndefined();
  });
});
