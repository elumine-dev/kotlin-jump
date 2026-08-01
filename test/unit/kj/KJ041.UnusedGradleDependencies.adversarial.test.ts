import { describe, it, expect } from 'vitest';
import {
  findUnusedGradleDependencies,
  catalogRootOf,
} from '../../../src/providers/unusedGradleDependencies';
import { parseCatalog, resolveAccessor, aliasSegments } from '../../../src/indexer/VersionCatalogIndex';

/**
 * KJ-041 — les alias de catalogue que rien ne référence.
 *
 * Premier détecteur qui lit le BUILD plutôt que le code.
 *
 * Le périmètre est volontairement étroit. Le détecteur « déclare une
 * dépendance sans jamais l'importer » a été mesuré puis écarté : sur un vrai
 * monorepo, `com.jakewharton.threetenabp` ne fournit que la classe
 * `AndroidThreeTen`, importée par 2 modules, tandis que 27 autres utilisent
 * `org.threeten.bp.*` venant d'une TRANSITIVE. Les signaler et agir dessus
 * retire `org.threeten.bp` de leur classpath : le build casse. Une coordonnée
 * Maven ne dit pas quels packages elle apporte.
 *
 * Le niveau catalogue n'a pas ce problème parce qu'il ne parle jamais de
 * packages : ou bien le nom apparaît dans un fichier de build, ou bien non.
 */

const f = (path: string, text: string) => ({ path, text });
const TOML = 'gradle/libs.versions.toml';

const toml = (...lines: string[]) => f(TOML, lines.join('\n') + '\n');
const build = (text: string) => f('app/build.gradle.kts', text);

const find = (sources: { path: string; text: string }[], extra: Record<string, unknown> = {}) =>
  findUnusedGradleDependencies({ sources, ...extra });
const names = (sources: any[], extra: Record<string, unknown> = {}) =>
  find(sources, extra).map((a: any) => a.name);

describe('le cas de base', () => {
  it('un alias qu’aucun fichier de build ne nomme est signalé', () => {
    const sources = [
      toml('[libraries]',
        'androidx-browser = { module = "androidx.browser:browser", version = "1.0" }',
        'dead-lib = { module = "com.x:dead", version = "1.0" }'),
      build('dependencies {\n    implementation(libs.androidx.browser)\n}'),
    ];
    expect(names(sources)).toEqual(['dead-lib']);
  });

  it('le format `module = "g:a"` est lu', () => {
    // L'ancien parseur ne connaissait que `group` + `name`, et rendait ZÉRO
    // library sur un catalogue écrit entièrement en `module =`.
    const catalog = parseCatalog('[libraries]\nx = { module = "com.a:b", version = "1" }\n');
    expect(catalog.aliases[0].coordinate).toBe('com.a:b');
  });

  it('les trois formes de coordonnée sont équivalentes', () => {
    const catalog = parseCatalog([
      '[libraries]',
      'a = { module = "g:one", version = "1" }',
      'b = { group = "g", name = "two", version = "1" }',
      'c = "g:three:1"',
    ].join('\n'));
    expect(catalog.aliases.map(x => x.coordinate)).toEqual(['g:one', 'g:two', 'g:three']);
  });
});

describe('la résolution d’accesseur', () => {
  const catalog = parseCatalog([
    '[libraries]',
    'foo = { module = "g:foo", version = "1" }',
    'foo-bar = { module = "g:foobar", version = "1" }',
    'androidx-browser = { module = "androidx.browser:browser", version = "1" }',
  ].join('\n'));

  it('les tirets deviennent des points', () => {
    expect(resolveAccessor(catalog.aliases, 'libraries', ['androidx', 'browser'])?.raw)
      .toBe('androidx-browser');
  });

  it('un accesseur plus long qu’un alias le résout quand même', () => {
    // `libs.androidx.browser.get()` : la chaîne capturée dépasse l'alias.
    expect(resolveAccessor(catalog.aliases, 'libraries', ['androidx', 'browser', 'get'])?.raw)
      .toBe('androidx-browser');
  });

  it('le plus LONG gagne quand deux alias se chevauchent', () => {
    // `libs.foo.bar` désigne `foo-bar`, pas `foo`. Un `startsWith` naïf
    // maintiendrait `foo` en vie et perdrait la trouvaille.
    expect(resolveAccessor(catalog.aliases, 'libraries', ['foo', 'bar'])?.raw).toBe('foo-bar');
    expect(resolveAccessor(catalog.aliases, 'libraries', ['foo'])?.raw).toBe('foo');
  });

  it('et le scan en tire la bonne conclusion', () => {
    const sources = [
      toml('[libraries]',
        'foo = { module = "g:foo", version = "1" }',
        'foo-bar = { module = "g:foobar", version = "1" }'),
      build('dependencies {\n    implementation(libs.foo.bar)\n}'),
    ];
    expect(names(sources)).toEqual(['foo']);
  });

  it('les séparateurs `-`, `_` et `.` sont interchangeables', () => {
    expect(aliasSegments('a-b')).toEqual(['a', 'b']);
    expect(aliasSegments('a_b')).toEqual(['a', 'b']);
    expect(aliasSegments('a.b')).toEqual(['a', 'b']);
  });
});

describe('les espaces de noms', () => {
  const sources = (buildText: string) => [
    toml('[versions]', 'kotlinV = "2.0"',
      '[libraries]', 'shared = { module = "g:a", version.ref = "kotlinV" }',
      '[plugins]', 'shared = { id = "org.x.shared", version.ref = "kotlinV" }'),
    build(buildText),
  ];

  it('une library et un plugin homonymes ne se maintiennent pas l’un l’autre', () => {
    expect(names(sources('plugins {\n    alias(libs.plugins.shared)\n}'))).toEqual(['shared']);
    expect(find(sources('plugins {\n    alias(libs.plugins.shared)\n}'))[0].namespace)
      .toBe('libraries');
  });

  it('`apply false` reste une référence', () => {
    expect(names(sources('plugins {\n    alias(libs.plugins.shared) apply false\n    implementation(libs.shared)\n}')))
      .toEqual([]);
  });

  it('`libs.versions.x.get()` maintient une version en vie', () => {
    const src = [
      toml('[versions]', 'composeCompiler = "1.5"'),
      build('composeOptions {\n    kotlinCompilerExtensionVersion = libs.versions.composeCompiler.get()\n}'),
    ];
    // Une `[versions]` n'est jamais signalée seule, mais elle ne doit pas non
    // plus être considérée morte : le test vérifie que rien n'est rapporté.
    expect(names(src)).toEqual([]);
  });
});

describe('les bundles', () => {
  it('un membre d’un bundle vivant reste vivant', () => {
    const sources = [
      toml('[libraries]',
        'retrofit = { module = "g:retrofit", version = "1" }',
        'okhttp = { module = "g:okhttp", version = "1" }',
        '[bundles]', 'network = ["retrofit", "okhttp"]'),
      build('dependencies {\n    implementation(libs.bundles.network)\n}'),
    ];
    expect(names(sources)).toEqual([]);
  });

  it('un bundle que rien ne référence est LA trouvaille, pas ses membres', () => {
    const sources = [
      toml('[libraries]',
        'retrofit = { module = "g:retrofit", version = "1" }',
        '[bundles]', 'network = ["retrofit"]'),
      build('dependencies {\n    implementation(libs.retrofit)\n}'),
    ];
    expect(names(sources)).toEqual(['network']);
  });

  it('un bundle écrit sur plusieurs lignes est lu correctement', () => {
    const catalog = parseCatalog([
      '[bundles]',
      'network = [',
      '    "retrofit",',
      '    "okhttp",',
      ']',
    ].join('\n'));
    expect(catalog.aliases[0].bundleMembers).toEqual(['retrofit', 'okhttp']);
    expect(catalog.unparsed).toBe(false);
  });
});

describe('les plugins de convention', () => {
  it('`findLibrary` dans build-logic maintient un alias en vie', () => {
    // La cause première des faux « alias mort » : l'alias n'est utilisé que
    // par un plugin de convention. Ces fichiers sont exclus du SIGNALEMENT,
    // jamais de la LECTURE.
    const sources = [
      toml('[libraries]', 'okhttp = { module = "g:okhttp", version = "1" }'),
      f('build-logic/src/main/kotlin/Conventions.kt',
        'val dep = libs.findLibrary("okhttp").get()'),
    ];
    expect(names(sources)).toEqual([]);
  });

  it('un alias trouvé par son nom exact seulement, pas par préfixe', () => {
    // `findLibrary("foo")` ne doit pas maintenir `foo-bar` en vie.
    const sources = [
      toml('[libraries]',
        'foo = { module = "g:foo", version = "1" }',
        'foo-bar = { module = "g:foobar", version = "1" }'),
      f('build-logic/src/main/kotlin/C.kt', 'libs.findLibrary("foo")'),
    ];
    expect(names(sources)).toEqual(['foo-bar']);
  });
});

describe('la racine d’accesseur', () => {
  it('un catalogue renommé dans settings change la racine', () => {
    // `versionCatalogs { create("deps") }` : un scan codé sur `libs.` ne
    // trouverait aucune référence et sortirait tous les alias d'un coup.
    const settings = f('settings.gradle.kts',
      'dependencyResolutionManagement {\n  versionCatalogs {\n    create("deps")\n  }\n}');
    expect(catalogRootOf(TOML, [settings.text])).toBe('deps');

    const sources = [
      settings,
      toml('[libraries]', 'okhttp = { module = "g:okhttp", version = "1" }'),
      build('dependencies {\n    implementation(deps.okhttp)\n}'),
    ];
    expect(names(sources)).toEqual([]);
  });

  it('un catalogue construit en Kotlin met le scan en silence', () => {
    const settings = 'versionCatalogs {\n  create("libs") {\n    library("x", "g:a:1")\n  }\n}';
    expect(catalogRootOf(TOML, [settings])).toBeUndefined();
  });

  it('sans settings, la racine vient du nom de fichier', () => {
    expect(catalogRootOf(TOML, [])).toBe('libs');
    expect(catalogRootOf('gradle/testLibs.versions.toml', [])).toBe('testLibs');
  });
});

describe('la cascade des versions', () => {
  it('une version référencée uniquement par un alias mort part avec lui', () => {
    const sources = [
      toml('[versions]', 'deadV = "1.0"',
        '[libraries]', 'dead = { module = "g:a", version.ref = "deadV" }'),
      build('dependencies {\n}'),
    ];
    const [found] = find(sources);
    expect(found.name).toBe('dead');
    expect(found.orphanedVersion?.name).toBe('deadV');
  });

  it('une version partagée avec un alias vivant n’est jamais touchée', () => {
    const sources = [
      toml('[versions]', 'sharedV = "1.0"',
        '[libraries]',
        'alive = { module = "g:a", version.ref = "sharedV" }',
        'dead = { module = "g:b", version.ref = "sharedV" }'),
      build('dependencies {\n    implementation(libs.alive)\n}'),
    ];
    const [found] = find(sources);
    expect(found.name).toBe('dead');
    expect(found.orphanedVersion).toBeUndefined();
  });

  it('une version n’est jamais signalée toute seule', () => {
    const sources = [
      toml('[versions]', 'orphan = "1.0"', '[libraries]'),
      build('dependencies {\n}'),
    ];
    expect(names(sources)).toEqual([]);
  });
});

describe('le contrat', () => {
  const dead = [
    toml('[libraries]', 'dead = { module = "g:a", version = "1" }'),
    build('dependencies {\n}'),
  ];

  it('un corpus tronqué ne produit rien', () => {
    expect(names(dead)).toEqual(['dead']);
    expect(names(dead, { truncated: true })).toEqual([]);
  });

  it('un commentaire TOML n’est pas une référence', () => {
    // La ligne réelle d'un vrai catalogue : `x = "1.0" # À Retirer - dead`
    const sources = [
      toml('[libraries]',
        'dead = { module = "g:a", version = "1" } # garder dead pour plus tard'),
      build('dependencies {\n}'),
    ];
    expect(names(sources)).toEqual(['dead']);
  });

  it('un commentaire dans un fichier de build n’est pas une référence', () => {
    const sources = [
      toml('[libraries]', 'dead = { module = "g:a", version = "1" }'),
      build('dependencies {\n    // implementation(libs.dead)\n}'),
    ];
    expect(names(sources)).toEqual(['dead']);
  });

  it('une ligne illisible met tout le catalogue en silence', () => {
    const sources = [
      toml('[libraries]',
        'ok = { module = "g:a", version = "1" }',
        'broken = { module = ',
        'dead = { module = "g:b", version = "1" }'),
      build('dependencies {\n}'),
    ];
    expect(names(sources)).toEqual([]);
  });

  it('les noms ignorés acceptent des globs', () => {
    const sources = [
      toml('[libraries]',
        'exp-alpha = { module = "g:a", version = "1" }',
        'real = { module = "g:b", version = "1" }'),
      build('dependencies {\n}'),
    ];
    expect(names(sources, { ignoreNames: ['exp-*'] })).toEqual(['real']);
  });

  it('le marqueur inline tait le catalogue', () => {
    const sources = [
      toml('# kotlin-jump:ignore unused-gradle-dependency',
        '[libraries]', 'dead = { module = "g:a", version = "1" }'),
      build('dependencies {\n}'),
    ];
    expect(names(sources)).toEqual([]);
  });
});

describe('l’étendue de suppression', () => {
  it('couvre l’entrée entière, table inline multi-lignes comprise', () => {
    const src = toml('[libraries]',
      'dead = {',
      '    module = "g:a",',
      '    version = "1"',
      '}');
    const [found] = find([src, build('dependencies {\n}')]);
    const removed = src.text.slice(found.removeStart, found.removeEnd);
    expect(removed).toContain('dead');
    expect(removed).toContain('}');
    // Et ce qui reste est un TOML sans l'entrée.
    const after = src.text.slice(0, found.removeStart) + src.text.slice(found.removeEnd);
    expect(after).not.toContain('dead');
    expect(after).toContain('[libraries]');
  });
});
