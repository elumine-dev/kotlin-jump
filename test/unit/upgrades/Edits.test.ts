import { describe, it, expect } from 'vitest';
import type { Dependency } from '../../../src/upgrades/model';
import { applyEdits, bumpEdit, orderForApplying } from '../../../src/upgrades/edits';

/**
 * KJ-082, the edits a bump produces: the bare literal and nothing else.
 *
 * A quick fix that rewrites the line loses the quotes, the spacing and the
 * trailing comment; one that rewrites the file loses its formatting, which is
 * what version-catalog-update does and what people complain about. An edit
 * here is one span per site, and a batch is applied back to front so no span
 * shifts another.
 */

const TEXT = '[versions]\nretrofit = "2.9.0" # http\ngson = "2.10.1"\n';
const site = (text: string, literal: string): Dependency => {
  const start = text.indexOf(`"${literal}"`) + 1;
  return {
    kind: 'library', key: `versions:${literal}`, members: [{ group: 'com.example.kiosk', artifact: 'x' }], group: 'com.example.kiosk', artifact: 'x',
    currentVersion: literal, literal: 'exact', versionSite: { file: '/w/libs.versions.toml', start, end: start + literal.length, text: literal },
    range: { file: '/w/libs.versions.toml', start: start - 1, end: start + literal.length + 1 }, line: 1, source: 'toml-versions', name: 'x', sharedBy: [],
  };
};

describe('KJ-082 edits', () => {
  it('a bump replaces the bare literal only', () => {
    const e = bumpEdit(site(TEXT, '2.9.0'), '3.0.0')!;
    expect(e).toEqual({ file: '/w/libs.versions.toml', start: 23, end: 28, newText: '3.0.0' });
    expect(applyEdits(TEXT, [e])).toBe('[versions]\nretrofit = "3.0.0" # http\ngson = "2.10.1"\n');
  });

  it('no edit for the same version, for a site without a literal, or for a downgrade the caller asks by mistake', () => {
    expect(bumpEdit(site(TEXT, '2.9.0'), '2.9.0')).toBeUndefined();
    const noSite = { ...site(TEXT, '2.9.0'), versionSite: undefined, literal: 'none' as const };
    expect(bumpEdit(noSite, '3.0.0')).toBeUndefined();
  });

  it('several edits in one file apply back to front, so the first span never shifts the second', () => {
    const edits = [bumpEdit(site(TEXT, '2.9.0'), '3.0.0')!, bumpEdit(site(TEXT, '2.10.1'), '2.11.0')!];
    expect(orderForApplying(edits).map(e => e.start)).toEqual([edits[1].start, edits[0].start]);
    expect(applyEdits(TEXT, edits)).toBe('[versions]\nretrofit = "3.0.0" # http\ngson = "2.11.0"\n');
  });
});
