import { plural } from '../util/plural';

/**
 * KJ-055: a directory under `src/` that Gradle never compiles.
 *
 * Android Gradle builds one source set per variant, and the names follow an
 * algebra: `main`, `test`, `androidTest`, then one per build type, one per
 * product flavour, one per flavour combination, one per variant, each with a
 * `test` and an `androidTest` sibling. A directory whose name the algebra
 * cannot produce is read by nothing. The compiler never sees it, the runner
 * never runs it, and a refactor never updates it.
 *
 * WHY A DEAD CODE TOOL CARES. Every usage scan counts what it reads, and an
 * orphan source set is code, so it votes. On the reference project the
 * `savedAndroidTest` directories hold 149 files that no Gradle task compiles,
 * and their mentions were the only thing keeping seven production
 * declarations alive: a method on a shared builder, a helper on a fragment
 * manager, a geometry helper, an enum entry. Each looked like code a test
 * still needs. None of it was.
 *
 * That is the same shape as a dead island one level up: the island rule asks
 * whether a group of declarations is reachable, this asks whether a whole
 * source set is. The reference branch resolved it by hand, deleting the
 * production declarations and leaving the orphan files pointing at nothing,
 * which compiles because nothing compiles them.
 *
 * THE DETECTOR ERRS TOWARD SILENCE. A name it cannot explain is not reported
 * unless nothing in the whole project could explain it:
 *
 *   flavours, dimensions and build types are pooled from EVERY build file in
 *   the project, not the module's own, so a convention plugin that adds a
 *   flavour in one module protects the same name everywhere;
 *
 *   any `src/<name>/` written as a string in any build file is legal, which
 *   covers the hand wired source sets (`src/sharedTest/java` added to `test`
 *   by `srcDirs`);
 *
 *   a module whose build file it cannot read, or that applies the Kotlin
 *   Multiplatform plugin (whose source sets are named by target, not by
 *   variant), is skipped whole.
 */

export interface OrphanSourceSet {
  /** Absolute path of the orphan directory, `…/variant/app/src/savedAndroidTest`. */
  path: string;
  /** Directory name, the source set Gradle would have to know about. */
  name: string;
  /** The module directory holding it. */
  module: string;
  /** Source files inside, for the report and for the removal plan. */
  files: string[];
  /** Why the algebra cannot produce this name, for the report. */
  reason: string;
}

export interface OrphanSourceSetScanInput {
  sources: readonly { path: string; text: string }[];
  /** Module directories, as `ResourceCorpus` reports them. */
  moduleDirs: readonly string[];
  /** An incomplete corpus cannot prove a name is unexplained. */
  truncated?: boolean;
}

/** Source sets AGP creates for every Android module, whatever it declares. */
const ALWAYS = ['main', 'test', 'androidTest', 'testFixtures'];
/** Build types AGP creates without being asked. */
const IMPLICIT_BUILD_TYPES = ['debug', 'release'];
/**
 * Directories that sit under `src/` without being source sets. `src/main` is
 * the source set; a project that puts `src/proto` or `src/schemas` next to it
 * is not declaring a variant, and flagging those would be noise.
 */
const NOT_A_SOURCE_SET = new Set(['proto', 'schemas', 'sqldelight', 'graphql', 'generated', 'build']);

const MULTIPLATFORM_RE = /kotlin\s*\(\s*["']multiplatform["']\s*\)|id\s*\(?\s*["']org\.jetbrains\.kotlin\.multiplatform["']|kotlin\.multiplatform\b/;

/** The braces that open at `from`, balanced; undefined when they never close. */
function balanced(text: string, from: number): string | undefined {
  let depth = 0;
  for (let i = from; i < text.length; i++) {
    if (text[i] === '{') depth++;
    else if (text[i] === '}' && --depth === 0) return text.slice(from + 1, i);
  }
  return undefined;
}

/** The block `name { … }` opens, matched on braces, or undefined when absent. */
function blockOf(text: string, name: string): string | undefined {
  const head = new RegExp(`\\b${name}\\s*(?:\\+=|=)?\\s*\\{`, 'g');
  const m = head.exec(text);
  if (!m) return undefined;
  return balanced(text, m.index + m[0].length - 1);
}

/**
 * The block belonging to a name DECLARED inside another, in the four spellings
 * the two DSLs allow. `blockOf` alone looked for `variant {` and found nothing
 * in `create("variant") { dimension = "app" }`, so every flavour read as
 * dimensionless and no flavour combination was produced: `variantexampleappRelease`
 * was reported as an orphan source set, which is the one mistake this detector
 * must never make.
 */
function subBlock(block: string, name: string): string | undefined {
  const head = new RegExp(
    `(?:\\b(?:create|register|maybeCreate|getByName)\\s*(?:<[^>]*>)?\\s*\\(\\s*["']${name}["']\\s*\\)|(?:^|\\n)[ \\t]*${name})\\s*\\{`, 'g');
  const m = head.exec(block);
  if (!m) return undefined;
  return balanced(block, m.index + m[0].length - 1);
}

/**
 * Names declared inside a `productFlavors` or `buildTypes` block, in all four
 * spellings the two DSLs allow: `create("x")`, `register("x")`,
 * `getByName("x")` and the bare `x { … }` an extension property permits.
 */
function declaredNames(block: string): string[] {
  const out: string[] = [];
  for (const m of block.matchAll(/\b(?:create|register|maybeCreate|getByName)\s*(?:<[^>]*>)?\s*\(\s*["']([A-Za-z][\w]*)["']/g)) out.push(m[1]);
  for (const m of block.matchAll(/^[ \t]*([a-z][\w]*)\s*\{/gm)) out.push(m[1]);
  return out;
}

/** Flavour dimensions in declaration order: what decides how names concatenate. */
function dimensionsOf(text: string): string[] {
  const out: string[] = [];
  // `flavorDimensions += listOf("app", "brand")`, `flavorDimensions "app"`,
  // `flavorDimensions = ["app"]`, `flavorDimensions += "brand"`.
  for (const m of text.matchAll(/flavorDimensions[^\n]*/g)) {
    for (const q of m[0].matchAll(/["']([\w]+)["']/g)) if (!out.includes(q[1])) out.push(q[1]);
  }
  return out;
}

interface Algebra {
  /** Flavour name -> its dimension, `''` when the flavour declares none. */
  flavourDimension: Map<string, string>;
  dimensions: string[];
  buildTypes: Set<string>;
  /** `src/<name>/` written in a build file: hand wired, therefore legal. */
  wired: Set<string>;
  /** Modules to skip: unreadable build file, or source sets named by target. */
  skip: Set<string>;
}

/** Everything every build file of the project declares, pooled. */
export function readAlgebra(
  sources: readonly { path: string; text: string }[],
  moduleDirs: readonly string[],
): Algebra {
  const algebra: Algebra = {
    flavourDimension: new Map(), dimensions: [], buildTypes: new Set(IMPLICIT_BUILD_TYPES),
    wired: new Set(), skip: new Set(),
  };
  const seen = new Set<string>();
  for (const src of sources) {
    if (!/[\\/](?:build|settings)\.gradle(?:\.kts)?$/.test(src.path)) continue;
    const dir = src.path.replace(/[\\/](?:build|settings)\.gradle(?:\.kts)?$/, '');
    seen.add(dir);
    if (MULTIPLATFORM_RE.test(src.text)) algebra.skip.add(dir);

    for (const d of dimensionsOf(src.text)) if (!algebra.dimensions.includes(d)) algebra.dimensions.push(d);

    const flavours = blockOf(src.text, 'productFlavors');
    if (flavours !== undefined) {
      for (const name of declaredNames(flavours)) {
        // The flavour's own `dimension = "app"`, read from its block. Without
        // it a flavour still counts, in every dimension: a name the algebra
        // can produce is a name this detector must not flag.
        const own = subBlock(flavours, name);
        const dim = own !== undefined ? /dimension\s*=?\s*["']([\w]+)["']/.exec(own)?.[1] : undefined;
        if (!algebra.flavourDimension.has(name) || dim !== undefined) algebra.flavourDimension.set(name, dim ?? '');
      }
    }
    const types = blockOf(src.text, 'buildTypes');
    if (types !== undefined) for (const name of declaredNames(types)) algebra.buildTypes.add(name);

    // A hand wired source set: `srcDirs(… "src/sharedTest/java")`, or any
    // `src/<name>` the script mentions. The `/` is required, so a bare word
    // cannot claim a directory.
    for (const m of src.text.matchAll(/["']?src[\\/]([A-Za-z][\w]*)[\\/]/g)) algebra.wired.add(m[1]);
  }
  // A module with no readable build file is a module whose variants are
  // unknown, and an unknown variant explains any name.
  for (const dir of moduleDirs) if (!seen.has(dir)) algebra.skip.add(dir);
  return algebra;
}

/** `variant` + `exampleapp` -> `variantexampleapp`, AGP's own concatenation. */
function join(parts: readonly string[]): string {
  return parts.map((p, i) => (i === 0 ? p : p.charAt(0).toUpperCase() + p.slice(1))).join('');
}

/** Every combination of one flavour per dimension, plus each flavour alone. */
function flavourNames(algebra: Algebra): string[] {
  const byDimension = new Map<string, string[]>();
  for (const [name, dim] of algebra.flavourDimension) {
    (byDimension.get(dim) ?? byDimension.set(dim, []).get(dim)!).push(name);
  }
  // Ordered by the declared dimensions, then any dimension the flavours name
  // that `flavorDimensions` did not, then the dimensionless ones.
  // Declared order first, then any dimension the flavours name that
  // `flavorDimensions` did not, then the dimensionless ones LAST. A flavour
  // with no dimension AGP would reject, so reading one means the parse missed
  // it; combining it anyway only widens the legal set, which is the safe side.
  const order = [...algebra.dimensions.filter(d => byDimension.has(d)),
    ...[...byDimension.keys()].filter(d => d !== '' && !algebra.dimensions.includes(d)),
    ...(byDimension.has('') ? [''] : [])];
  let combos: string[][] = [[]];
  for (const dim of order) {
    const next: string[][] = [];
    for (const combo of combos) for (const f of byDimension.get(dim)!) next.push([...combo, f]);
    // A dimension may also be absent from a source set name, so keep the
    // shorter combinations: `src/variant` exists next to `src/variantexampleapp`.
    combos = [...combos, ...next];
  }
  const out = new Set<string>();
  for (const combo of combos) if (combo.length > 0) out.add(combo.join(''));
  for (const f of algebra.flavourDimension.keys()) out.add(f);
  return [...out];
}

/** Every source set name Gradle can build for a module of this project. */
export function legalSourceSetNames(algebra: Algebra): Set<string> {
  const out = new Set<string>(ALWAYS);
  const bases = [...flavourNames(algebra)];
  const types = [...algebra.buildTypes];
  const variants = [...bases];
  for (const b of bases) for (const t of types) variants.push(join([b, t]));
  for (const t of types) variants.push(t);
  for (const v of variants) {
    out.add(v);
    // AGP's test source sets: `test<Variant>` and `androidTest<Variant>`.
    out.add(`test${v}`);
    out.add(`androidTest${v}`);
    out.add(`testFixtures${v}`);
    out.add(`test${v.charAt(0).toUpperCase()}${v.slice(1)}`);
    out.add(`androidTest${v.charAt(0).toUpperCase()}${v.slice(1)}`);
    out.add(`testFixtures${v.charAt(0).toUpperCase()}${v.slice(1)}`);
  }
  for (const w of algebra.wired) out.add(w);
  return out;
}

const SOURCE_RE = /\.(kt|kts|java)$/;

export function findOrphanSourceSets(input: OrphanSourceSetScanInput): OrphanSourceSet[] {
  if (input.truncated) return [];

  const algebra = readAlgebra(input.sources, input.moduleDirs);
  const legal = legalSourceSetNames(algebra);
  // Longest module path first: a nested module claims its own `src/`.
  const modules = [...input.moduleDirs].sort((a, b) => b.length - a.length);

  const byDirectory = new Map<string, { module: string; name: string; files: string[] }>();
  for (const src of input.sources) {
    if (!SOURCE_RE.test(src.path)) continue;
    const p = src.path.replace(/\\/g, '/');
    const module = modules.find(m => p.startsWith(`${m.replace(/\\/g, '/')}/`));
    if (module === undefined || algebra.skip.has(module)) continue;
    const rest = p.slice(module.length + 1);
    const m = /^src\/([^/]+)\//.exec(rest);
    if (!m) continue;
    const name = m[1];
    if (legal.has(name) || NOT_A_SOURCE_SET.has(name)) continue;
    const dir = `${module}/src/${name}`;
    const hit = byDirectory.get(dir) ?? byDirectory.set(dir, { module, name, files: [] }).get(dir)!;
    hit.files.push(src.path);
  }

  const out: OrphanSourceSet[] = [];
  for (const [dir, hit] of byDirectory) {
    out.push({
      path: dir, name: hit.name, module: hit.module, files: hit.files.sort(),
      reason: reasonFor(hit.name, algebra),
    });
  }
  return out.sort((a, b) => (a.path < b.path ? -1 : 1));
}

/**
 * What the name would need to be legal. Naming the missing piece is what turns
 * the finding into something a reader can check in one look: on the reference
 * project every one of them reads "AGP spells it `androidTest<Variant>`", and
 * a glance at the build file confirms no variant is named `saved`.
 */
function reasonFor(name: string, algebra: Algebra): string {
  const known = [...algebra.flavourDimension.keys(), ...algebra.buildTypes];
  const lower = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);
  // AGP puts the fixed word FIRST: `androidTestvariantexampleappDebug`. A name
  // carrying it anywhere else is no shape the algebra has, whatever follows.
  const inside = /^(.+?)(AndroidTest|TestFixtures|Test)(.*)$/.exec(name);
  if (inside) {
    return `AGP spells this \`${lower(inside[2])}<Variant>\`, never \`<name>${inside[2]}\`,`
      + ` and no variant is named \`${lower(inside[1])}\``;
  }
  const prefix = /^(androidTest|testFixtures|test)(?=[A-Z])/.exec(name)?.[1];
  const wanted = prefix ? lower(name.slice(prefix.length)) : name;
  const near = known.find(k => wanted.startsWith(k) || k.startsWith(wanted));
  if (prefix) {
    return near
      ? `\`${prefix}\` builds only for a variant named \`${wanted}\`, and \`${near}\` is not it`
      : `no flavour, build type or variant named \`${wanted}\`, so \`${prefix}\` has nothing to test`;
  }
  return `no flavour or build type named \`${wanted}\``;
}

/**
 * The corpus without the files Gradle never compiles, and the orphan source
 * sets that were taken out.
 *
 * WHY EXCLUDING THEM IS NOT A REMOVAL. Every detector counts what it reads,
 * and the scan already refuses to read two kinds of file for the same reason
 * this one is added: build output (`isBuildArtifactPath`) and generated
 * sources (`isGeneratedSource`). Both are code, neither is a source of truth
 * about what the project needs. A source set no Gradle task compiles belongs
 * with them: its mentions cannot keep a production declaration alive, because
 * nothing ever resolves them.
 *
 * Nothing is deleted here. The files stay on disk and the orphan directories
 * are REPORTED, so the reader decides what to do with 150 files that no task
 * builds. What changes is only that the production code they name is now
 * findable.
 */
export function withoutOrphanSourceSets(
  input: OrphanSourceSetScanInput,
): { sources: readonly { path: string; text: string }[]; orphans: OrphanSourceSet[] } {
  const orphans = findOrphanSourceSets(input);
  if (orphans.length === 0) return { sources: input.sources, orphans };
  const drop = new Set(orphans.flatMap(o => o.files));
  return { sources: input.sources.filter(s => !drop.has(s.path)), orphans };
}

/** The one line a report ends on. Exported for the witness. */
export function orphanSummary(orphans: readonly OrphanSourceSet[]): string {
  if (orphans.length === 0) return 'No orphan source set: every directory under src/ belongs to a variant.';
  const files = orphans.reduce((n, o) => n + o.files.length, 0);
  return `${plural(orphans.length, 'orphan source set')} Gradle never compiles, ${plural(files, 'file')}.`;
}
