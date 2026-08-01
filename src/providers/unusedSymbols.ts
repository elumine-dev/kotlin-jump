import { parse, RawSymbol, SymbolKind } from '../indexer/KotlinParser';
import { parseJava } from '../indexer/JavaParser';
import {
  CONVENTION_FUN_NAMES,
  FILE_SUPPRESS_RE,
  REFLECTIVE_SUPERTYPES,
  buildLineStarts,
  collectAnnotationTargets,
  matchBrace,
  offsetToPos,
  sanitizeForUsageScan,
  suppressesDiagnostic,
  UNUSED_DECLARATION,
} from '../util/kotlinScan';
import { declarationSpan } from '../util/declarationSpan';
import { isTestSourceSet } from '../util/testPaths';
import { isBuildArtifactPath, isGeneratedSource } from '../util/resourceAllowlists';
import { stripKotlinComments, stripXmlComments } from '../util/xmlRefs';

/**
 * KJ-032: top-level Kotlin declarations that nothing in the workspace
 * references. The family's first cross-file detector.
 *
 * The contract, as everywhere else in the family:
 *
 *   A finding means NO TEXTUAL REFERENCE TO THIS SYMBOL EXISTS IN WHAT WE CAN
 *   READ. It does not mean the build has no other consumer.
 *
 * ## Why this harvests instead of calling FindUsagesEngine
 *
 * `scanForUsagesWithTarget` answers "show me the usages of what I'm looking
 * at", which is a different question from "prove nothing uses this":
 *   - `fileCouldReference` returns false when two wildcard imports both
 *     declare the simple name, and that branch only fires for depth 0, i.e.
 *     exactly this population. It discards a file that DOES reference us.
 *   - it reads only .kt/.java, so a layout, a manifest, a nav graph, a .pro
 *     or a .gradle.kts reference is invisible.
 *   - it skips import lines, so `import p.Bar as Baz` + `Baz()` yields zero.
 * Each of those is a false positive that deletes compiling code.
 *
 * So: one pass over the corpus, harvest every token mentioned anywhere, then
 * subtract. Cost is O(corpus text), independent of the candidate count.
 *
 * ## What the harvest costs, stated plainly
 *
 * The token bag is a whole-word multiset with NO attribution. `Foo` in module
 * A and `Foo` in module B are the same token; a local variable named `mapper`
 * keeps a top-level `fun mapper` alive; a class named `Result` is alive
 * forever. Every one of those is a FALSE NEGATIVE, never a false positive.
 * That is the correct direction and the same trade KJ-031 makes.
 */

export type UnusedSymbolKind = Extract<
  SymbolKind,
  'class' | 'interface' | 'object' | 'enum' | 'dataClass' | 'sealedClass' | 'fun' | 'composable' | 'val' | 'var'
>;

export type UnusedSymbolVerdict = 'unreferenced' | 'testOnly';

export interface SymbolSource {
  path: string;
  text: string;
}

export interface UnusedSymbolScanInput {
  sources: readonly SymbolSource[];
  testSourceSets: readonly string[];
  /** Modules whose API is consumed off-workspace (maven-publish). */
  publishedModules?: readonly string[];
  libraryModules?: readonly string[];
  /** An incomplete corpus cannot prove absence, so it produces nothing. */
  truncated?: boolean;
  ignoreNames?: readonly string[];
  ignorePaths?: readonly string[];
  includeTestOnly?: boolean;
  /** Set false to disable the conventional-name belt (F7b). */
  frameworkNameSuffixes?: boolean;
}

export interface UnusedSymbol {
  name: string;
  kind: UnusedSymbolKind;
  verdict: UnusedSymbolVerdict;
  path: string;
  /** 0-based position of the name token. */
  line: number;
  character: number;
  /** Whole-declaration extent, or -1 when it could not be delimited. */
  removeStart: number;
  removeEnd: number;
  testMentions: number;
  isDeprecated: boolean;
  isLibraryModule: boolean;
  /**
   * Other files whose ONLY mention of this name is an `import` line. Removing
   * the declaration without removing these stops the workspace compiling, so
   * they are part of the fix, not a nicety.
   */
  staleImports: StaleImport[];
  /**
   * True when the declaring file holds nothing but package, imports, file
   * annotations and comments once this declaration is gone: delete the FILE
   * rather than leave an empty shell.
   */
  fileBecomesEmpty: boolean;
}

export interface StaleImport {
  path: string;
  /** 0-based line of the `import` statement, re-verified before any edit. */
  line: number;
}

/** Kinds this detector reasons about. `typealias` and `annotation` are v2. */
const CANDIDATE_KINDS = new Set<string>([
  'class', 'interface', 'object', 'enum', 'dataClass', 'sealedClass',
  'fun', 'composable', 'val', 'var',
]);

/**
 * Annotations that do NOT make a top-level declaration reachable. Everything
 * else does, which is the point: an ALLOWLIST covers DI, serialization, Room,
 * WorkManager, Hilt, Dagger and every framework nobody has thought of yet.
 *
 * `@Preview` is absent on purpose (the preview renderer calls the function, so
 * it is an entry point). `@Deprecated` is present on purpose: deprecated AND
 * unreferenced is the best finding this detector produces.
 */
export const BENIGN_TOPLEVEL_ANNOTATIONS = new Set([
  'Composable', 'Deprecated', 'JvmOverloads', 'Throws', 'OptIn', 'RequiresApi', 'SuppressLint',
  // `@Suppress` addresses the compiler, never a framework, so it cannot make a
  // declaration reachable. Whether it opts OUT of this detector is decided by
  // the diagnostic it names, which `optsOutUnused` carries.
  'Suppress', 'SuppressWarnings',
  // Compose contract annotations: they promise something about the type's
  // behaviour, they do not make it reachable from anywhere.
  'Stable', 'Immutable', 'NonRestartableComposable', 'ReadOnlyComposable',
]);

/** Supertypes whose instances the framework creates; nothing names the class. */
export const FRAMEWORK_SUPERTYPES = new Set([
  'Application', 'Activity', 'AppCompatActivity', 'ComponentActivity', 'FragmentActivity',
  'Fragment', 'DialogFragment', 'BottomSheetDialogFragment', 'PreferenceFragmentCompat',
  'Service', 'JobService', 'TileService', 'IntentService', 'JobIntentService',
  'BroadcastReceiver', 'ContentProvider', 'FileProvider',
  'Worker', 'CoroutineWorker', 'ListenableWorker', 'RemoteViewsService',
  'Initializer', 'Plugin', 'DefaultTask', 'Task', 'TransformAction', 'Runner',
  'Runnable', 'Thread', 'TimerTask', 'RecyclerView', 'View', 'ViewGroup',
]);

/**
 * Name suffixes that conventionally mark a framework-instantiated type. A
 * belt for the case where the base class lives outside the corpus, so the
 * supertype walk cannot reach the framework type.
 */
const FRAMEWORK_NAME_SUFFIXES = [
  'Activity', 'Fragment', 'Service', 'Receiver', 'Provider', 'Application',
  'Worker', 'Module', 'Entity', 'Dao', 'Interceptor',
];

/**
 * Java constructs that make a whole FILE reachable without any Kotlin or Java
 * caller naming its types:
 *   - `public static void main(String[])` is named by a manifest or a Gradle
 *     `mainClass` property, and it lives at depth 1 so it is never a candidate
 *     itself. Its enclosing class is what we must not report.
 *   - a `native` method is bound to a C symbol (`Java_com_pkg_Foo_bar`) in a
 *     source file this corpus has no extension for.
 *   - a `@Test` method makes its class a runner entry point even when the
 *     class itself carries no annotation, which JUnit 5 allows.
 */
const JAVA_ENTRY_POINT_RE =
  /\bstatic\s+(?:final\s+)?void\s+main\s*\(|\bnative\s+[\w<>[\]]+\s+\w+\s*\(|@(?:Test|ParameterizedTest|RepeatedTest)\b/;

const IGNORE_MARKER = 'kotlin-jump:ignore unused-symbol';

interface Candidate {
  sym: RawSymbol;
  name: string;
  kind: UnusedSymbolKind;
  path: string;
  /** Mentions of this name inside its own declaration extent. */
  selfInSpan: number;
  /** Mentions anywhere in its declaring file (comments stripped). */
  selfInFile: number;
  removeStart: number;
  removeEnd: number;
  /** Simple annotation names attached to this declaration. */
  annoNames: string[];
  /** `@Suppress("unused")` on the declaration itself: an explicit opt-out. */
  optsOutUnused: boolean;
}

export interface Harvest {
  main: Map<string, number>;
  test: Map<string, number>;
  /** Names an aliased import mentions: alive unconditionally (H10). */
  aliased: Set<string>;
  /** name -> the import lines that would dangle if the name went away. */
  importPostings: Map<string, StaleImport[]>;
}

const WORD_RE = /[A-Za-z_][A-Za-z0-9_]*/g;

function bump(bag: Map<string, number>, name: string, wanted: ReadonlySet<string>): void {
  if (!wanted.has(name)) return;
  bag.set(name, (bag.get(name) ?? 0) + 1);
}

export function countWord(text: string, name: string): number {
  let n = 0;
  WORD_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = WORD_RE.exec(text)) !== null) if (m[0] === name) n++;
  return n;
}

export function matchesGlob(path: string, pattern: string): boolean {
  const re = new RegExp(
    '^' + pattern
      .replace(/[.+^${}()|[\]\\]/g, '\\$&')
      .replace(/\*\*/g, ' ')
      .replace(/\*/g, '[^/]*')
      .replace(/ /g, '.*') + '$',
  );
  return re.test(path);
}

export function isUnder(path: string, dir: string): boolean {
  return path === dir || path.startsWith(`${dir}/`) || path.startsWith(`${dir}\\`);
}

/**
 * Import lines never keep a symbol alive on their own. The harvest drops them
 * from its bag, so `selfInFile` has to drop them too: `mainMentions -
 * selfInFile` only isolates EXTERNAL mentions when both sides count the same
 * way. Counting an import on one side and not the other understates the
 * residue, which is the direction that manufactures a finding.
 */
export function stripImportLines(text: string): string {
  return text.split('\n').map(l => (/^\s*import\s/.test(l) ? '' : l)).join('\n');
}

/** Java sees a top-level `val x` as `FileKt.getX()` (H9). */
export function accessorNames(name: string): string[] {
  const cap = name[0].toUpperCase() + name.slice(1);
  const out = [`get${cap}`, `set${cap}`];
  if (/^is[A-Z]/.test(name)) {
    const bare = name.slice(2);
    out.push(`set${bare}`, `get${bare}`);
  }
  return out;
}


/**
 * Whole-line removal extent: KDoc and annotations above, accessors below, and
 * -1 when the statement visibly continues past our end.
 *
 * Ported from KJ-026 rather than reinvented. The scan extent decides the
 * VERDICT; this one decides what a quick fix would delete, and it is allowed
 * to give up (-1) while the verdict still stands.
 */
export function removalExtent(
  text: string,
  clean: string,
  lineStarts: readonly number[],
  lastLine: number,
  sym: RawSymbol,
  span: { scanEnd: number; lineBasedEnd: boolean },
): { removeStart: number; removeEnd: number } {
  const lines = text.split('\n');
  const lineEndOf = (l: number) => (l + 1 < lineStarts.length ? lineStarts[l + 1] : text.length);

  let firstLine = sym.line;
  for (let l = sym.line - 1; l >= 0; l--) {
    const trimmed = (lines[l] ?? '').trim();
    if (trimmed.startsWith('@')) { firstLine = l; continue; }
    if (trimmed.endsWith('*/')) {
      let k = l;
      while (k >= 0 && !(lines[k] ?? '').trim().startsWith('/*')) k--;
      if (k >= 0) { firstLine = k; l = k; continue; }
    }
    break;
  }

  let endOffset = span.scanEnd;
  if (sym.kind === 'val' || sym.kind === 'var') {
    let nextLine = offsetToPos(lineStarts as number[], endOffset - 1).line + 1;
    while (nextLine <= lastLine
      && /^\s*(?:private\s+|protected\s+)?(?:get|set)\b/.test(lines[nextLine] ?? '')) {
      const lineStart = lineStarts[nextLine];
      const braceIdx = clean.slice(lineStart, lineEndOf(nextLine)).indexOf('{');
      if (braceIdx !== -1) {
        const close = matchBrace(clean, lineStart + braceIdx);
        if (close === -1) break;
        endOffset = close + 1;
      } else {
        endOffset = lineEndOf(nextLine);
      }
      nextLine = offsetToPos(lineStarts as number[], endOffset - 1).line + 1;
    }
  }

  // Judge continuation on the RAW text: the sanitizer blanks string bodies, so
  // `val X = "done"` would read as ending on `=` and lose its quick fix.
  const trailing = text.slice(0, endOffset).trimEnd();
  const nextLineNum = offsetToPos(lineStarts as number[], Math.max(endOffset - 1, 0)).line + 1;
  let nextNonBlank = nextLineNum;
  while (nextNonBlank <= lastLine && (lines[nextNonBlank] ?? '').trim() === '') nextNonBlank++;
  const nextStartsFresh =
    nextNonBlank > lastLine ||
    /^\s*(?:\}|\/\/|\/\*|@|va[lr]\b|fun\b|class\b|object\b|interface\b|companion\b|init\b|constructor\b|private\b|protected\b|internal\b|public\b|override\b|abstract\b|open\b|enum\b|sealed\b|data\b|suspend\b|inline\b|typealias\b)/
      .test(lines[nextNonBlank] ?? '');
  const continues = span.lineBasedEnd
    && (/(?:[+\-*/,.&|?:=(]|->)$/.test(trailing) || !nextStartsFresh);
  if (continues) return { removeStart: -1, removeEnd: -1 };

  const removeStart = lineStarts[firstLine];
  return {
    removeStart,
    removeEnd: lineEndOf(offsetToPos(lineStarts as number[], Math.max(endOffset - 1, removeStart)).line),
  };
}

/** Kotlin declarations of the corpus, top-level only, before any filtering. */
export function collectTopLevelCandidates(
  sources: readonly SymbolSource[],
  testSourceSets: readonly string[],
): {
  candidates: Candidate[];
  topLevelNameCounts: Map<string, number>;
  /** Declared name -> its direct supertypes, for the inheritance walk. */
  supertypesByName: Map<string, string[]>;
  /** Names whose subtypes carry a framework annotation (F8). */
  parentsOfAnnotatedSubtypes: Set<string>;
  /** Java files holding an entry point the corpus never names (F9j). */
  exemptByEntryPoint: Set<string>;
} {
  const topLevelNameCounts = new Map<string, number>();
  const supertypesByName = new Map<string, string[]>();
  // Java entry points nothing in the corpus names. Each exempts every
  // top-level type of its file, because the reachable thing is the FILE:
  // a `main` is named by a manifest or a Gradle mainClass, a `native` method
  // by a C symbol in a .c we never read, and a JUnit class by the runner.
  const exemptByEntryPoint = new Set<string>();
  // F8: a parent whose SUBTYPE is framework-owned is itself reached through
  // that framework. A sealed class whose variants carry @SerializedName is
  // instantiated by the JSON library, never by name.
  const parentsOfAnnotatedSubtypes = new Set<string>();
  const perFile: { path: string; clean: string; syms: RawSymbol[]; text: string }[] = [];

  for (const src of sources) {
    // The mention harvest already read Java; only candidate discovery skipped
    // it. Java members and fields always sit at depth >= 1, so the existing
    // depth filter below keeps this to top-level types with no extra code.
    const isJava = src.path.endsWith('.java');
    if (!isJava && !src.path.endsWith('.kt')) continue;
    if (isBuildArtifactPath(src.path)) continue;
    const parsed = isJava ? parseJava(src.path, src.text) : parse(src.path, src.text);
    const tops = parsed.symbols.filter(s => s.depth === 0 && CANDIDATE_KINDS.has(s.kind));
    for (const s of tops) {
      topLevelNameCounts.set(s.name, (topLevelNameCounts.get(s.name) ?? 0) + 1);
      const supers = (s.supertypes ?? []).map(x => x.replace(/<.*/, '').trim()).filter(Boolean);
      if (supers.length > 0) supertypesByName.set(s.name, supers);
    }
    // Any symbol at any depth: nested sealed variants are the common case.
    const fileClean = sanitizeForUsageScan(src.text);
    const fileStarts = buildLineStarts(fileClean);
    const fileAnnos = collectAnnotationTargets(fileClean);
    for (const s of parsed.symbols) {
      const at = fileStarts[s.line] + s.character;
      const hasForeign = fileAnnos.some(a =>
        a.target >= fileStarts[s.line] && a.target <= at && !BENIGN_TOPLEVEL_ANNOTATIONS.has(a.name));
      if (!hasForeign) continue;
      for (const sup of s.supertypes ?? []) parentsOfAnnotatedSubtypes.add(sup.replace(/<.*/, '').trim());
    }

    if (isJava && JAVA_ENTRY_POINT_RE.test(src.text)) exemptByEntryPoint.add(src.path);

    // F18: a generator owns this file, and the next build rewrites it. Acting
    // on a finding here is wasted, and generator conventions read as dead code
    // to a textual scan.
    if (isGeneratedSource(src.text)) continue;
    if (isTestSourceSet(src.path, testSourceSets)) continue; // F2
    // F12, file scope: `@file:Suppress("unused")` opts the whole file out. It
    // sits above `package`, so the per-declaration annotation window below
    // cannot see it.
    const fileSuppress = FILE_SUPPRESS_RE.exec(src.text);
    if (fileSuppress && suppressesDiagnostic(fileSuppress[1], UNUSED_DECLARATION)) continue;
    perFile.push({ path: src.path, clean: sanitizeForUsageScan(src.text), syms: tops, text: src.text });
  }

  const candidates: Candidate[] = [];
  for (const file of perFile) {
    const lineStarts = buildLineStarts(file.clean);
    const lastLine = lineStarts.length - 1;
    const annotations = collectAnnotationTargets(file.clean);
    const keptText = stripImportLines(stripKotlinComments(file.text));

    for (const sym of file.syms) {
      const nameOffset = lineStarts[sym.line] + sym.character;
      const span = declarationSpan(file.clean, lineStarts, {
        kind: sym.kind === 'fun' || sym.kind === 'composable' ? 'fun'
          : sym.kind === 'val' || sym.kind === 'var' ? 'prop' : 'classLike',
        name: sym.name,
        line: sym.line,
        nameOffset,
        lastLine,
      });
      // F16: an extent we cannot delimit is an extent we cannot trust to
      // blank, so the verdict would be untrustworthy. No finding at all.
      if (!span) continue;

      // Same bound as KJ-026: an annotation chain belongs to this declaration
      // only when it resolves inside the declaration's own line, up to the
      // name token. A wider window would let one declaration's @Suppress
      // silence the next one.
      const lo = lineStarts[sym.line];
      const hi = lo + sym.character;
      const own = annotations.filter(a => a.target >= lo && a.target <= hi);
      const annoNames = own.map(a => a.name);
      // F12 at declaration scope, the mirror of the file-scope check above.
      // `@Suppress` itself is benign (it addresses the compiler, not the
      // framework), so what decides is WHICH diagnostic it names.
      const optsOutUnused = own.some(a =>
        (a.name === 'Suppress' || a.name === 'SuppressWarnings') && a.argStart >= 0
        && suppressesDiagnostic(file.text.slice(a.argStart, a.argEnd), UNUSED_DECLARATION));

      candidates.push({
        optsOutUnused,
        sym,
        name: sym.name,
        kind: sym.kind as UnusedSymbolKind,
        path: file.path,
        selfInSpan: countWord(file.clean.slice(span.scanStart, span.scanEnd), sym.name),
        selfInFile: countWord(keptText, sym.name),
        ...removalExtent(file.text, file.clean, lineStarts, lastLine, sym, span),
        annoNames,
      });
    }
  }
  return { candidates, topLevelNameCounts, supertypesByName, parentsOfAnnotatedSubtypes, exemptByEntryPoint };
}

/** Every token mentioned anywhere, in one pass over the corpus. */
export function harvestMentions(
  sources: readonly SymbolSource[],
  wanted: ReadonlySet<string>,
  testSourceSets: readonly string[],
): Harvest {
  const harvest: Harvest = { main: new Map(), test: new Map(), aliased: new Set(), importPostings: new Map() };

  for (const src of sources) {
    // G2 of KJ-031, same reason: R8 writes every name of the build into these,
    // and a tool cache does the same. Reading one marks the project alive.
    if (isBuildArtifactPath(src.path)) continue;
    if (/\.(json|lock)$/i.test(src.path)) continue;

    const bag = isTestSourceSet(src.path, testSourceSets) ? harvest.test : harvest.main;
    const isCode = /\.(kt|kts|java)$/.test(src.path);
    const isXml = /\.xml$/.test(src.path);

    // H6: for a ServiceLoader entry the SPI name is the file name itself.
    if (/[\\/]META-INF[\\/]services[\\/]/.test(src.path)) {
      for (const token of src.path.split(/[\\/.]/)) bump(bag, token, wanted);
    }

    let text = src.text;
    if (isCode) {
      // Comments do not count: a commented-out reference is exactly the case
      // we want reported. String contents DO count (reflection, DI by name).
      text = stripKotlinComments(text);
      const lines = text.split('\n');
      for (let i = 0; i < lines.length; i++) {
        // `static` for Java, and the trailing `;` is simply not captured.
        const imp = /^\s*import\s+(?:static\s+)?([\w.]+)(?:\s+as\s+(\w+))?/.exec(lines[i]);
        if (!imp) continue;
        const segments = imp[1].split('.');
        const simple = segments[segments.length - 1];
        // Import lines never keep a symbol alive on their own, but an ALIASED
        // import means the simple name may never appear at the call site.
        if (imp[2]) harvest.aliased.add(simple);

        // Only the LAST segment is withheld from the bag. A segment BEFORE it
        // is a real structural dependency: `import p.Outer.Nested` means this
        // file breaks if `Outer` goes away, even though its body may only ever
        // write `Nested`. Withholding those too reported live sealed classes
        // as unreferenced, since their variants are imported exactly this way.
        //
        // Capitalisation is what separates a type from a package here. Getting
        // it wrong on a lowercase type only keeps a symbol alive, which is the
        // safe direction.
        for (let s = 0; s < segments.length - 1; s++) {
          if (/^[A-Z]/.test(segments[s])) bump(bag, segments[s], wanted);
        }

        if (!wanted.has(simple)) continue;
        const postings = harvest.importPostings.get(simple) ?? [];
        postings.push({ path: src.path, line: i });
        harvest.importPostings.set(simple, postings);
      }
      // Strip the import lines from the liveness bag.
      text = stripImportLines(text);
    } else if (isXml) {
      text = stripXmlComments(text);
    }

    // The dot is a separator, so `com.foo.Bar()`, `<com.foo.MyView>`,
    // `android:name=".MainActivity"`, `-keep class com.foo.Bar` and
    // `implementationClass = "com.foo.MyPlugin"` all yield the right token
    // with no manifest, layout or nav-graph parser anywhere.
    WORD_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = WORD_RE.exec(text)) !== null) bump(bag, m[0], wanted);
  }

  return harvest;
}

/**
 * Which guard, if any, takes this candidate out of scope. Returns the guard
 * id so the dry-run harness can explain a verdict; `null` means the candidate
 * survives the filters and goes on to the liveness check.
 *
 * Written as one function rather than inline predicates precisely so that
 * `--why` and the detector can never disagree about the reason.
 */
/**
 * Walks the inheritance chain looking for a supertype the framework
 * instantiates. Following the chain matters: `class Screen : BaseScreen()`
 * where `BaseScreen : Fragment` names only `BaseScreen` at the declaration,
 * and stopping at the first level would report a live Fragment as dead.
 *
 * Only workspace-declared parents can be followed, so the walk is bounded by
 * the corpus and by a depth cap against cycles.
 */
export function frameworkAncestor(
  supertypes: readonly string[],
  supertypesByName: ReadonlyMap<string, string[]>,
): string | null {
  const seen = new Set<string>();
  let frontier = supertypes.map(t => t.replace(/<.*/, '').trim());

  for (let depth = 0; depth < 8 && frontier.length > 0; depth++) {
    const next: string[] = [];
    for (const bare of frontier) {
      if (!bare || seen.has(bare)) continue;
      seen.add(bare);
      if (REFLECTIVE_SUPERTYPES.has(bare)) return `F6:${bare}`;
      if (FRAMEWORK_SUPERTYPES.has(bare)) {
        return depth === 0 ? `F7:${bare}` : `F7:${bare}(via ancestor)`;
      }
      for (const parent of supertypesByName.get(bare) ?? []) next.push(parent);
    }
    frontier = next;
  }
  return null;
}

/**
 * F3 exists because the harvest carries no attribution: when two files declare
 * `foo`, a `foo` token somewhere else could mean either one, so neither can be
 * proven unreferenced and both are dropped.
 *
 * But when the corpus mentions the name ONLY at the declaration sites, there is
 * nothing left to attribute. Not knowing WHICH declaration a reference names is
 * moot when no reference exists: every one of them is unreferenced.
 *
 * Found by auditing a real workspace against another dead-code tool. Two copies
 * of `setCheckedValue`, two of `setIsVisibleValue` and two build-variant copies
 * of `observeForLeaks` were dead with zero callers, and F3 alone was silencing
 * all six.
 *
 * The rule cannot manufacture a false positive that F3 was preventing, because
 * it only fires when the mention count is exactly the count of declarations.
 */
function duplicatesWithNoMention(
  candidates: readonly Candidate[],
  topLevelNameCounts: ReadonlyMap<string, number>,
  harvest: Harvest,
): Set<string> {
  const byName = new Map<string, Candidate[]>();
  for (const c of candidates) {
    if ((topLevelNameCounts.get(c.name) ?? 0) <= 1) continue;
    const list = byName.get(c.name) ?? [];
    list.push(c);
    byName.set(c.name, list);
  }

  const out = new Set<string>();
  for (const [name, group] of byName) {
    // Every declaration of the name has to be visible here. One filtered out
    // earlier (declared in a test source set, or under `@file:Suppress`) still
    // contributes its own mentions to the bag, and what we cannot see we
    // cannot subtract.
    if (group.length !== topLevelNameCounts.get(name)) continue;

    // An aliased import can reference the name without ever spelling it, so
    // the bag's silence proves nothing (H10).
    if (harvest.aliased.has(name)) continue;

    // A second mention inside a candidate's OWN span is a call to another
    // bearer of the name (or self-recursion): either way the group is not
    // provably unmentioned. Found live as a member-level false positive
    // (a member delegating to its homonym), and the flaw is identical here.
    if (group.some(c => c.selfInSpan !== 1)) continue;

    let mentions = harvest.main.get(name) ?? 0;
    if (group.some(c => c.kind === 'val' || c.kind === 'var')) {
      for (const a of accessorNames(name)) mentions += harvest.main.get(a) ?? 0;   // H9
    }

    let self = 0;
    let outsideOwnSpan = 0;
    for (const c of group) {
      self += c.selfInFile;
      outsideOwnSpan += c.selfInFile - c.selfInSpan;
    }
    // `outsideOwnSpan` catches a declaration used elsewhere in its own file:
    // that use may belong to any member of the group, so the group stays out.
    if (mentions - self === 0 && outsideOwnSpan === 0) out.add(name);
  }
  return out;
}

/** Everything the guards need that is not the candidate itself. */
interface ScanContext {
  topLevelNameCounts: ReadonlyMap<string, number>;
  exemptFiles: ReadonlySet<string>;
  supertypesByName: ReadonlyMap<string, string[]>;
  parentsOfAnnotatedSubtypes: ReadonlySet<string>;
  exemptByEntryPoint: ReadonlySet<string>;
  /** Duplicated names the corpus never mentions outside their declarations. */
  unmentionedDuplicates: ReadonlySet<string>;
}

function rejectionReason(
  c: Candidate,
  input: UnusedSymbolScanInput,
  ctx: ScanContext,
): string | null {
  const sym = c.sym;
  const { topLevelNameCounts, exemptFiles, supertypesByName } = ctx;
  const { parentsOfAnnotatedSubtypes, exemptByEntryPoint, unmentionedDuplicates } = ctx;
  if (exemptByEntryPoint.has(c.path)) return 'F9j:java-entry-point';

  if (c.optsOutUnused) return 'F12:suppress-unused';
  if (sym.isPrivate) return 'F1:private';
  if ((topLevelNameCounts.get(c.name) ?? 0) > 1 && !unmentionedDuplicates.has(c.name)) {
    return 'F3:duplicate-name';
  }
  if (sym.isExpect || sym.isActual) return 'F4:kmp';

  const foreign = c.annoNames.find(a => !BENIGN_TOPLEVEL_ANNOTATIONS.has(a));
  if (foreign) return `F5:@${foreign}`;

  const framework = frameworkAncestor(c.sym.supertypes ?? [], supertypesByName);
  if (framework) return framework;
  if (parentsOfAnnotatedSubtypes.has(c.name)) return 'F8:annotated-subtype';
  // An interface is never instantiated by a framework, so the name belt must
  // not apply to one: `interface OnboardingService` is not an Android Service.
  if (input.frameworkNameSuffixes === true && c.kind !== 'interface') {
    const suffix = FRAMEWORK_NAME_SUFFIXES.find(s => c.name.length > s.length && c.name.endsWith(s));
    if (suffix) return `F7b:*${suffix}`;
  }

  if ((c.kind === 'fun' || c.kind === 'composable') && c.name === 'main') return 'F9:main';
  if (sym.isOperator) return 'F10:operator';
  if (CONVENTION_FUN_NAMES.has(c.name)) return 'F10:convention';
  if (/^component\d+$/.test(c.name)) return 'F10:destructuring';
  if (exemptFiles.has(c.path)) return 'F12:ignore-marker';
  if ((input.ignorePaths ?? []).some(p => matchesGlob(c.path, p))) return 'F13:ignored-path';
  if ((input.publishedModules ?? []).some(d => isUnder(c.path, d))) return 'F14:published';
  if ((input.ignoreNames ?? []).some(p => matchesGlob(c.name, p))) return 'F17:ignored-name';
  return null;
}

/** One line per raw candidate, saying what happened to it. For `--why`. */
export interface SymbolExplanation {
  name: string;
  kind: string;
  path: string;
  line: number;
  /** The guard that took it out, `alive` when something references it, or
   *  the verdict when it survived everything. */
  outcome: string;
  mainMentions: number;
  testMentions: number;
}

/** Names the harvest has to watch for: every candidate, plus its accessors. */
function wantedNames(candidates: readonly Candidate[]): Set<string> {
  const wanted = new Set<string>();
  for (const c of candidates) {
    wanted.add(c.name);
    if (c.kind === 'val' || c.kind === 'var') for (const a of accessorNames(c.name)) wanted.add(a);
  }
  return wanted;
}

type Collected = ReturnType<typeof collectTopLevelCandidates>;

/**
 * The harvest has to run BEFORE the guards, because one of them (F3) now needs
 * to know whether the corpus mentions a duplicated name at all. Harvest cost is
 * O(corpus text) and independent of how many names it watches, so widening the
 * watch list from the survivors to every candidate costs nothing.
 */
function buildContext(
  input: UnusedSymbolScanInput,
  collected: Collected,
  harvest: Harvest,
): ScanContext {
  return {
    topLevelNameCounts: collected.topLevelNameCounts,
    exemptFiles: new Set(
      input.sources.filter(s => s.text.includes(IGNORE_MARKER)).map(s => s.path),
    ),
    supertypesByName: collected.supertypesByName,
    parentsOfAnnotatedSubtypes: collected.parentsOfAnnotatedSubtypes,
    exemptByEntryPoint: collected.exemptByEntryPoint,
    unmentionedDuplicates: duplicatesWithNoMention(
      collected.candidates, collected.topLevelNameCounts, harvest),
  };
}

export function explainSymbols(input: UnusedSymbolScanInput): SymbolExplanation[] {
  const collected = collectTopLevelCandidates(input.sources, input.testSourceSets);
  const { candidates } = collected;
  const harvest = harvestMentions(input.sources, wantedNames(candidates), input.testSourceSets);
  const ctx = buildContext(input, collected, harvest);
  const countIn = (bag: Map<string, number>, c: Candidate) => {
    let n = bag.get(c.name) ?? 0;
    if (c.kind === 'val' || c.kind === 'var') {
      for (const a of accessorNames(c.name)) n += bag.get(a) ?? 0;
    }
    return n;
  };

  return candidates.map(c => {
    const mainMentions = countIn(harvest.main, c);
    const testMentions = countIn(harvest.test, c);
    const rejected = rejectionReason(c, input, ctx);
    let outcome: string;
    if (rejected) outcome = rejected;
    else if (harvest.aliased.has(c.name)) outcome = 'H10:aliased-import';
    else if (!ctx.unmentionedDuplicates.has(c.name) && mainMentions - c.selfInFile !== 0) outcome = 'alive:main';
    else if (c.selfInFile - c.selfInSpan > 0) outcome = 'alive:same-file';
    else outcome = testMentions > 0 ? 'testOnly' : 'unreferenced';

    return { name: c.name, kind: c.kind, path: c.path, line: c.sym.line, outcome, mainMentions, testMentions };
  });
}


/**
 * Widens an extent to whole lines when nothing else shares them, so removing
 * a declaration leaves no orphan blank line. Exported for the removal suite.
 */
export function wholeLineExtent(
  text: string,
  start: number,
  end: number,
): { start: number; end: number } {
  if (start < 0 || end < start) return { start, end };
  let lineStart = text.lastIndexOf('\n', Math.max(start - 1, 0));
  lineStart = lineStart === -1 ? 0 : lineStart + 1;
  let lineEnd = text.indexOf('\n', end);
  lineEnd = lineEnd === -1 ? text.length : lineEnd + 1;
  if (text.slice(lineStart, start).trim() !== '' || text.slice(end, lineEnd).trim() !== '') {
    return { start, end };
  }
  return { start: lineStart, end: lineEnd };
}

/**
 * True when applying `extents` leaves the file with nothing but package,
 * imports, file annotations and comments. The caller then deletes the file
 * instead of leaving a shell behind.
 */
export function fileBecomesEmpty(
  text: string,
  extents: readonly { start: number; end: number }[],
): boolean {
  let out = text;
  for (const e of [...extents].sort((a, b) => b.start - a.start)) {
    if (e.start < 0) return false; // an extent we could not delimit stays put
    const w = wholeLineExtent(out, e.start, e.end);
    out = out.slice(0, w.start) + out.slice(w.end);
  }
  // Comments carry no code, so they do not count as remaining content.
  return sanitizeForUsageScan(out)
    .split('\n')
    .every(l => l.trim() === '' || /^\s*(package\s|import\s|@file:)/.test(l));
}

export function findUnusedSymbols(input: UnusedSymbolScanInput): UnusedSymbol[] {
  // Contract rule 2.
  if (input.truncated) return [];

  const collected = collectTopLevelCandidates(input.sources, input.testSourceSets);
  const { candidates } = collected;
  if (candidates.length === 0) return [];

  const harvest = harvestMentions(input.sources, wantedNames(candidates), input.testSourceSets);
  const ctx = buildContext(input, collected, harvest);

  const kept = candidates.filter(c => rejectionReason(c, input, ctx) === null);
  if (kept.length === 0) return [];

  const mentionsOf = (bag: Map<string, number>, c: Candidate): number => {
    let n = bag.get(c.name) ?? 0;
    if (c.kind === 'val' || c.kind === 'var') {
      for (const a of accessorNames(c.name)) n += bag.get(a) ?? 0;   // H9
    }
    return n;
  };

  const out: UnusedSymbol[] = [];
  for (const c of kept) {
    if (harvest.aliased.has(c.name)) continue;                        // H10

    // The declaring file's own mentions come out of the MAIN bag, which F2
    // guarantees by excluding test-declared candidates.
    //
    // A member of an unmentioned duplicate group would otherwise read its
    // TWIN's declaration as a live mention, since the subtraction only removes
    // its own. The group check already established that the bag holds nothing
    // but the declarations themselves, so the residue is zero by construction.
    const mainElsewhere = ctx.unmentionedDuplicates.has(c.name)
      ? 0
      : mentionsOf(harvest.main, c) - c.selfInFile;
    // Defensive: over-counting self would manufacture a finding, so any
    // negative residue reads as alive.
    if (mainElsewhere !== 0) continue;
    if (c.selfInFile - c.selfInSpan > 0) continue;   // used elsewhere in its own file

    const testMentions = mentionsOf(harvest.test, c);
    const verdict: UnusedSymbolVerdict = testMentions > 0 ? 'testOnly' : 'unreferenced';
    if (verdict === 'testOnly' && input.includeTestOnly === false) continue;

    out.push({
      staleImports: harvest.importPostings.get(c.name) ?? [],
      fileBecomesEmpty: false, // filled once every finding of the file is known
      name: c.name,
      kind: c.kind,
      verdict,
      path: c.path,
      line: c.sym.line,
      character: c.sym.character,
      removeStart: c.removeStart,
      removeEnd: c.removeEnd,
      testMentions,
      isDeprecated: c.sym.isDeprecated === true,
      isLibraryModule: (input.libraryModules ?? []).some(d => isUnder(c.path, d)),
    });
  }

  // A file is only emptied by ALL of its findings together, so this is a
  // second pass once every finding is known.
  const textByPath = new Map(input.sources.map(s => [s.path, s.text]));
  const byPath = new Map<string, UnusedSymbol[]>();
  for (const f of out) {
    const list = byPath.get(f.path) ?? [];
    list.push(f);
    byPath.set(f.path, list);
  }
  for (const [p, findings] of byPath) {
    const text = textByPath.get(p);
    if (text === undefined) continue;
    const empties = fileBecomesEmpty(text, findings.map(f => ({ start: f.removeStart, end: f.removeEnd })));
    for (const f of findings) f.fileBecomesEmpty = empties;
  }

  return out.sort((a, b) => a.path.localeCompare(b.path) || a.line - b.line);
}

const KIND_LABEL: Record<string, string> = {
  class: 'Class', dataClass: 'Class', sealedClass: 'Class', enum: 'Enum',
  interface: 'Interface', object: 'Object',
  fun: 'Function', composable: 'Composable', val: 'Property', var: 'Property',
};

export function messageFor(f: UnusedSymbol): string {
  const label = KIND_LABEL[f.kind] ?? 'Symbol';
  if (f.verdict === 'testOnly') {
    const n = f.testMentions;
    return `${label} '${f.name}' is used only from tests (${n} reference${n > 1 ? 's' : ''})`;
  }
  const scope = f.isLibraryModule
    ? ' anywhere in this workspace (library module, an external consumer may use it)'
    : ' anywhere in this workspace';
  return `${label} '${f.name}' is never referenced${scope}`;
}

export function deleteTitleFor(f: UnusedSymbol): string {
  return `Delete unreferenced ${f.kind === 'composable' ? 'composable' : f.kind} ${f.name}`;
}
