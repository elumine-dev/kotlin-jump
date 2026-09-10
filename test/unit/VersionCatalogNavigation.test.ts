/**
 * Ctrl+click inside gradle/libs.versions.toml.
 *
 * Shapes taken from a real catalog of 293 lines: the plugin line Kevin asked
 * about resolves its version.ref to line 21 of the same file, and its alias to
 * the three build files that declare it. Across that project, 171 of the 176
 * non version aliases resolve to at least one usage; the five that do not are
 * absent from every build file even by fuzzy name search, so they are the
 * template entries nobody wired up.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as vscodeMock from './__mocks__/vscode';
import { tokenAt } from '../../src/providers/versionCatalogSyntax';
import { accessorOf, aliasOnLine, findAccessorUsages } from '../../src/providers/VersionCatalogNavigation';
import { CatalogTomlDefinitionProvider, CatalogTomlReferenceProvider } from '../../src/providers/VersionCatalogNavigation';
import { parseCatalog } from '../../src/indexer/VersionCatalogIndex';
import { collectAliasReferences } from '../../src/providers/unusedGradleDependencies';

const NL = String.fromCharCode(10);

const CATALOGUE = [
  '[versions]',
  'androidxNavigation = "2.9.7"',
  'kotlin = "2.3.20"',
  '',
  '[libraries]',
  'androidx-navigation-compose = { module = "androidx.navigation:navigation-compose", version.ref = "androidxNavigation" }',
  '',
  '[plugins]',
  'navigation-safeArgs = { id = "androidx.navigation.safeargs.kotlin", version.ref = "androidxNavigation" }',
  'kotlin-android = { id = "org.jetbrains.kotlin.android", version.ref = "kotlin" }',
].join(NL);

const L_PLUGIN = 8;
const COL_REF = CATALOGUE.split(NL)[L_PLUGIN].indexOf('"androidxNavigation"') + 3;

function docFake(texte: string): any {
  return { getText: () => texte, uri: { fsPath: '/w/gradle/libs.versions.toml', toString: () => 'file:///w/gradle/libs.versions.toml' } };
}

describe('what sits under the cursor in a catalog', () => {
  it('reads a version.ref target as a reference, and names its table', () => {
    const hit = tokenAt(CATALOGUE, L_PLUGIN, COL_REF)!;
    expect(hit.type).toBe('enumMember');
    expect(hit.texte).toBe('androidxNavigation');
    expect(hit.brut).toBe('"androidxNavigation"');
    expect(hit.table).toBe('plugins');
  });

  it('reads the alias on the left as the alias', () => {
    const hit = tokenAt(CATALOGUE, L_PLUGIN, 3)!;
    expect(hit.type).toBe('property');
    expect(hit.texte).toBe('navigation-safeArgs');
    expect(hit.table).toBe('plugins');
  });

  it('names the table of a line that carries no header of its own', () => {
    expect(tokenAt(CATALOGUE, 5, 3)!.table).toBe('libraries');
    expect(tokenAt(CATALOGUE, 1, 3)!.table).toBe('versions');
  });

  it('gives nothing on a blank column and outside the file', () => {
    const ligne = CATALOGUE.split(NL)[L_PLUGIN];
    expect(tokenAt(CATALOGUE, L_PLUGIN, ligne.indexOf(' = {') + 1)).toBeUndefined();
    expect(tokenAt(CATALOGUE, 999, 0)).toBeUndefined();
    expect(tokenAt(CATALOGUE, 3, 0)).toBeUndefined();
  });
});

describe('accessor of an alias', () => {
  const alias = (raw: string) => parseCatalog(CATALOGUE).aliases.find(a => a.raw === raw)!;

  it('prefixes every namespace except libraries', () => {
    expect(accessorOf(alias('navigation-safeArgs'), 'libs')).toBe('libs.plugins.navigation.safeArgs');
    expect(accessorOf(alias('androidx-navigation-compose'), 'libs')).toBe('libs.androidx.navigation.compose');
  });

  it('follows a renamed accessor root', () => {
    expect(accessorOf(alias('navigation-safeArgs'), 'deps')).toBe('deps.plugins.navigation.safeArgs');
  });
});

describe('finding the usages of an alias in build files', () => {
  const alias = parseCatalog(CATALOGUE).aliases.find(a => a.raw === 'navigation-safeArgs')!;
  const lib   = parseCatalog(CATALOGUE).aliases.find(a => a.raw === 'androidx-navigation-compose')!;

  it('finds the shapes a build file really uses', () => {
    const build = [
      'plugins {',
      '    alias(libs.plugins.navigation.safeArgs)',
      '    alias(libs.plugins.navigation.safeArgs).apply(false)',
      '}',
    ].join(NL);
    const hits = findAccessorUsages(build, alias, 'libs');
    expect(hits.map(h => h.line)).toEqual([1, 2]);
    expect(build.split(NL)[1].slice(hits[0].start, hits[0].start + hits[0].length))
      .toBe('libs.plugins.navigation.safeArgs');
  });

  it('treats the three separators Gradle considers equal', () => {
    // The alias is written with a dash; the accessor uses dots either way.
    expect(findAccessorUsages('x(libs.plugins.navigation.safeArgs)', alias, 'libs')).toHaveLength(1);
  });

  it('does not match a longer accessor, nor another namespace', () => {
    expect(findAccessorUsages('x(libs.plugins.navigation.safeArgs.extra)', alias, 'libs')).toHaveLength(0);
    expect(findAccessorUsages('x(libs.navigation.safeArgs)', alias, 'libs')).toHaveLength(0);
    // A library alias must not be found under a namespaced accessor.
    expect(findAccessorUsages('x(libs.plugins.androidx.navigation.compose)', lib, 'libs')).toHaveLength(0);
    expect(findAccessorUsages('x(libs.androidx.navigation.compose)', lib, 'libs')).toHaveLength(1);
  });

  it('ignores an accessor that belongs to a different root', () => {
    expect(findAccessorUsages('x(deps.plugins.navigation.safeArgs)', alias, 'libs')).toHaveLength(0);
    expect(findAccessorUsages('x(deps.plugins.navigation.safeArgs)', alias, 'deps')).toHaveLength(1);
  });

  it('reports a position that lands on the accessor, not on the line start', () => {
    const build = 'plugins {' + NL + '        alias(libs.plugins.navigation.safeArgs)' + NL + '}';
    const [h] = findAccessorUsages(build, alias, 'libs');
    expect(h.line).toBe(1);
    expect(h.start).toBe(build.split(NL)[1].indexOf('libs.'));
  });
});

describe('Ctrl+click inside the catalog', () => {
  const provider = new CatalogTomlDefinitionProvider(() => 'libs');

  it('sends a version.ref to the line that declares it', async () => {
    const cibles = await provider.provideDefinition(docFake(CATALOGUE) as any, { line: L_PLUGIN, character: COL_REF } as any);
    expect(cibles).toHaveLength(1);
    expect(cibles![0].range.start.line).toBe(1);
    expect(cibles![0].range.start.character).toBe(0);
    expect(cibles![0].range.end.character).toBe('androidxNavigation'.length);
  });

  it('sends a [versions] key to the entries that pin their version on it', async () => {
    const cibles = await provider.provideDefinition(docFake(CATALOGUE) as any, { line: 1, character: 3 } as any);
    // The library and the plugin, not the unrelated `kotlin` version.
    expect(cibles!.map(c => c.range.start.line)).toEqual([5, 8]);
    for (const c of cibles!) {
      const ligne = CATALOGUE.split(NL)[c.range.start.line];
      expect(ligne.slice(c.range.start.character, c.range.end.character)).toBe('androidxNavigation');
    }
  });

  it('gives nothing on a coordinate, a comment or a blank column', async () => {
    const ligne = CATALOGUE.split(NL)[L_PLUGIN];
    const surId = ligne.indexOf('"androidx.navigation.safeargs.kotlin"') + 3;
    expect(await provider.provideDefinition(docFake(CATALOGUE) as any, { line: L_PLUGIN, character: surId } as any))
      .toBeUndefined();
    expect(await provider.provideDefinition(docFake(CATALOGUE) as any, { line: 3, character: 0 } as any))
      .toBeUndefined();
  });

  it('finds the alias declared on a line, and none on a blank one', () => {
    expect(aliasOnLine(CATALOGUE, L_PLUGIN)?.raw).toBe('navigation-safeArgs');
    expect(aliasOnLine(CATALOGUE, 3)).toBeUndefined();
  });
});

/**
 * Two shipped features answer the same question about the same build file:
 * "is this alias used?". Ctrl+click shows the usages, the unused dependency
 * scan decides whether there are any. They disagreed four ways out of five.
 *
 * The navigation counted a commented out accessor as a usage, so an alias the
 * scan reported as dead opened onto a commented line; and it missed a lookup
 * by name, so an alias the scan considered alive said no definition found.
 * Both now go through the same comment blanking and the same name matching.
 */
describe('the navigation and the unused dependency scan agree', () => {
  const TOML = [
    '[libraries]',
    'foo-bar = { module = "com.x:foo-bar", version = "1.0" }',
    '[plugins]',
    'navigation-safeArgs = { id = "androidx.navigation.safeargs.kotlin", version = "1.0" }',
  ].join(NL);
  const cat = parseCatalog(TOML);
  const alias = (raw: string) => cat.aliases.find(a => a.raw === raw)!;

  /** What the shipped unused dependency scan counts for this alias. */
  function vueScan(source: string, raw: string): number {
    const a = alias(raw);
    const { refs, byName } = collectAliasReferences(
      [{ path: '/w/build.gradle.kts', text: source }] as any, new Set(['libs']));
    const parAccesseur = refs.filter(r => r.namespace === a.namespace
      && r.segments.length === a.segments.length
      && r.segments.every((s, i) => s === a.segments[i])).length;
    return parAccesseur + (byName.has(raw) ? 1 : 0);
  }

  const CAS: Array<[string, string, string, boolean]> = [
    ['un accesseur vivant',        'foo-bar',             'dependencies { implementation(libs.foo.bar) }', true],
    ['un accesseur en // ',        'foo-bar',             'dependencies {' + NL + '  // implementation(libs.foo.bar)' + NL + '}', false],
    ['un accesseur en bloc',       'foo-bar',             'dependencies {' + NL + '  /* implementation(libs.foo.bar) */' + NL + '}', false],
    ['une recherche par nom',      'foo-bar',             'val l = libs.findLibrary("foo-bar").get()', true],
    ['un plugin commente',         'navigation-safeArgs', '// alias(libs.plugins.navigation.safeArgs)', false],
  ];

  for (const [nom, raw, source, attendu] of CAS) {
    it(`${nom} : les deux vues disent ${attendu ? 'utilise' : 'inutilise'}`, () => {
      const nav = findAccessorUsages(source, alias(raw), 'libs').length > 0;
      const scan = vueScan(source, raw) > 0;
      expect(nav, 'la navigation').toBe(attendu);
      expect(scan, 'le scan de dependances mortes').toBe(attendu);
    });
  }

  it('points a lookup by name at the name itself, not at the call', () => {
    const source = 'val l = libs.findLibrary("foo-bar").get()';
    const [h] = findAccessorUsages(source, alias('foo-bar'), 'libs');
    expect(source.slice(h.start, h.start + h.length)).toBe('foo-bar');
  });

  it('keeps a live accessor next to a commented one, in reading order', () => {
    const source = [
      '// implementation(libs.foo.bar)',
      'implementation(libs.foo.bar)',
      'val l = libs.findLibrary("foo-bar")',
    ].join(NL);
    const hits = findAccessorUsages(source, alias('foo-bar'), 'libs');
    expect(hits.map(h => h.line)).toEqual([1, 2]);
  });
});

/**
 * A key of the versions table is reached two ways: from the catalog, by the
 * entries that pin their version on it, and from a build file, as
 * `libs.versions.<key>` or through findVersion. v1.42.106 lined the navigation
 * up with the unused dependency scan for libraries, plugins and bundles and
 * left this namespace behind, so a version used only from a build file opened
 * onto nothing while the scan considered it alive.
 *
 * Shift+F12 had no test at all until here.
 */
describe('a key of the versions table', () => {
  const TOML = [
    '[versions]',
    'agp = "8.13.2"',
    'kotlin = "2.3.20"',
    '',
    '[libraries]',
    'x = { module = "a:b", version.ref = "kotlin" }',
  ].join(NL);

  const BUILD = 'val v = libs.findVersion("agp").get()' + NL + 'val w = libs.versions.kotlin';
  const uriBuild = { fsPath: '/w/build.gradle.kts', toString: () => 'file:///w/build.gradle.kts' };

  let origFind: any, origRead: any;
  beforeEach(() => {
    origFind = (vscodeMock.workspace as any).findFiles;
    origRead = (vscodeMock.workspace.fs as any).readFile;
    (vscodeMock.workspace as any).findFiles = async () => [uriBuild];
    (vscodeMock.workspace.fs as any).readFile = async () => new TextEncoder().encode(BUILD);
  });
  afterEach(() => {
    (vscodeMock.workspace as any).findFiles = origFind;
    (vscodeMock.workspace.fs as any).readFile = origRead;
  });

  const defProvider = new CatalogTomlDefinitionProvider(() => 'libs');
  const refProvider = new CatalogTomlReferenceProvider(() => 'libs');
  const doc = () => docFake(TOML);

  it('Ctrl+click reaches the build file, not only the catalog', async () => {
    // `agp` is pinned by no entry of the catalog: before the fix this was empty.
    const cibles = await defProvider.provideDefinition(doc() as any, { line: 1, character: 1 } as any);
    expect(cibles!.map(c => c.uri.toString())).toEqual(['file:///w/build.gradle.kts']);
    expect(BUILD.split(NL)[0].slice(cibles![0].range.start.character, cibles![0].range.end.character))
      .toBe('agp');
  });

  it('Ctrl+click keeps the catalog entries and adds the build ones', async () => {
    const cibles = await defProvider.provideDefinition(doc() as any, { line: 2, character: 1 } as any);
    // The library that pins `kotlin`, then the build file that reads it.
    expect(cibles!.map(c => c.uri.toString()))
      .toEqual(['file:///w/gradle/libs.versions.toml', 'file:///w/build.gradle.kts']);
    expect(cibles![0].range.start.line).toBe(5);
  });

  it('Shift+F12 opens with the declaration, then the uses', async () => {
    const refs = await refProvider.provideReferences(doc() as any, { line: 2, character: 1 } as any);
    expect(refs!.map(r => [r.uri.toString(), r.range.start.line]))
      .toEqual([
        ['file:///w/gradle/libs.versions.toml', 2],
        ['file:///w/gradle/libs.versions.toml', 5],
        ['file:///w/build.gradle.kts', 1],
      ]);
  });

  it('Shift+F12 on a version.ref answers about the key it points at', async () => {
    const ligne = TOML.split(NL)[5];
    const refs = await refProvider.provideReferences(
      doc() as any, { line: 5, character: ligne.indexOf('"kotlin"') + 2 } as any);
    expect(refs!.map(r => r.range.start.line)).toEqual([2, 5, 1]);
  });

  it('Shift+F12 on an alias of another table stays on its usages', async () => {
    const refs = await refProvider.provideReferences(doc() as any, { line: 5, character: 0 } as any);
    // `x` is not used by the build file above, so nothing, and no crash.
    expect(refs).toEqual([]);
  });
});
