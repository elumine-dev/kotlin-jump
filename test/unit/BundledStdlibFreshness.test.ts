/**
 * `bundled/kotlin-stdlib-<v>-index.json` is a committed build artefact: the
 * stdlib sources JAR pre parsed once, shipped inside the VSIX, loaded as is by
 * BundledStdlibProvider. Nothing invalidates it. Its `schemaVersion` guards the
 * FORMAT, and SNAPSHOT_VERSION never reaches it, so a parser fix leaves it
 * frozen on the reading it had the day someone last ran the build script.
 *
 * It was last built at v1.22.0 and audited at v1.42.100, 120 releases later:
 * 238 of its 326 files disagreed with the parser. 210 declarations were
 * missing, `Enum.name` and `Enum.ordinal` and the companions of Boolean, Char
 * and the primitives among them, and 206 supertype lists had swallowed the
 * type argument, so `List` inherited from `E` and `Boolean` from itself.
 *
 * The asset carries every source it indexed, so freshness is checkable without
 * the JAR: reparse and compare. When this fails, run
 * `npm run build:bundled-stdlib-index` and commit the result.
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { parse } from '../../src/indexer/KotlinParser';
import { buildSnapshotFile } from '../../src/indexer/SnapshotFormat';

const BUNDLED_DIR = path.resolve(__dirname, '..', '..', 'bundled');
const RE_ASSET = /^kotlin-stdlib-(.+)-index\.json$/;

interface Asset {
  schemaVersion: number;
  bundledVersion: string;
  symbols: Record<string, unknown>;
  sources: Record<string, string>;
}

function locate(): { chemin: string; version: string } {
  const noms = fs.readdirSync(BUNDLED_DIR).filter(n => RE_ASSET.test(n));
  expect(noms, 'exactly one bundled stdlib index expected in bundled/').toHaveLength(1);
  return { chemin: path.join(BUNDLED_DIR, noms[0]), version: RE_ASSET.exec(noms[0])![1] };
}

describe('bundled stdlib index is not frozen on an older parser', () => {
  const { chemin, version } = locate();
  const asset = JSON.parse(fs.readFileSync(chemin, 'utf8')) as Asset;

  it('indexes exactly the files it carries the sources of', () => {
    expect(Object.keys(asset.symbols).sort()).toEqual(Object.keys(asset.sources).sort());
    expect(Object.keys(asset.sources).length).toBeGreaterThan(300);
  });

  it('holds the reading the current parser produces, file by file', () => {
    // Same call the build script makes: mtime 0, no size, module name derived
    // from the version in the file name.
    const moduleName = `kotlin-stdlib:${version} (bundled)`;
    const desaccords: string[] = [];
    for (const [nom, source] of Object.entries(asset.sources)) {
      const p = parse(`kotlin-stdlib-jar:/${nom}`, source);
      const frais = buildSnapshotFile(p.symbols, p.packageName, moduleName, 0, undefined, p.imports);
      if (JSON.stringify(frais) !== JSON.stringify(asset.symbols[nom])) desaccords.push(nom);
    }
    expect(
      desaccords,
      `${desaccords.length} file(s) in ${path.basename(chemin)} no longer match the parser `
        + `(${desaccords.slice(0, 3).join(', ')}). Run: npm run build:bundled-stdlib-index`,
    ).toEqual([]);
  });
});
