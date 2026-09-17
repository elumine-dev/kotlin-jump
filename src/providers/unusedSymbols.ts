import { matchesGlob } from '../util/glob';
import { coupeUnBloc } from '../util/blocDeCommentaire';
import { parse, RawSymbol, SymbolKind } from '../indexer/KotlinParser';
import { parseJava } from '../indexer/JavaParser';
import {
  CONVENTION_FUN_NAMES,
  fileOptsOut,
  REFLECTIVE_SUPERTYPES,
  buildLineStarts,
  collectAnnotationTargets,
  matchBrace,
  offsetToPos,
  sanitizeForUsageScan,
  suppressesDiagnostic,
  UNUSED_DECLARATION,
  afterAnnotations,
  multiLineAnnotationStart,
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
// Declaration keywords: a line holding one is a declaration of its own.
const DECL_KEYWORD_RE = /\b(?:val|var|fun|class|object|interface|typealias|const|enum|companion)\b/;
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
  // React Native: a package is found by the CLI's autolinking, which scans the
  // sources of every dependency for a class implementing ReactPackage and
  // registers it without a single reference in Kotlin or Java. A module or a
  // view manager is reached from JavaScript by the name `getName()` returns.
  // Measured on a React Native monorepo: `SafXPackage` and a
  // `BaseReactPackage` doing the `System.loadLibrary` were reported dead and
  // deleted, and two native modules stopped existing at runtime.
  'ReactPackage', 'BaseReactPackage', 'TurboReactPackage', 'ReactContextBaseJavaModule',
  'NativeModule', 'ReactModuleWithSpec', 'SimpleViewManager', 'ViewGroupManager', 'ViewManager',
  'ReactActivity', 'ReactActivityDelegate', 'DefaultReactActivityDelegate', 'ReactNativeHost',
  'DefaultReactNativeHost', 'HeadlessJsTaskService',
  // Nitro Modules: a hybrid object is instantiated from JavaScript by name.
  'HybridObject',
]);

/**
 * Supertypes written by a code generator that the corpus never holds: React
 * Native's codegen emits `Native<Name>Spec` for a TurboModule and Nitrogen
 * emits `Hybrid<Name>Spec` for a hybrid object, both under a generated
 * directory that is ignored by git. A class extending one of these is
 * instantiated by the framework, and the supertype walk cannot learn it from
 * a file it does not have. `HybridAudioRecorder : HybridAudioRecorderSpec()`
 * was deleted on the reference React Native project, and voice typing with it.
 */
const GENERATED_FRAMEWORK_SUPERTYPE_RE = /^(?:Hybrid|Native)\w+Spec$/;

/**
 * Name suffixes that conventionally mark a framework-instantiated type. A
 * belt for the case where the base class lives outside the corpus, so the
 * supertype walk cannot reach the framework type.
 */
const FRAMEWORK_NAME_SUFFIXES = [
  'Activity', 'Fragment', 'Service', 'Receiver', 'Provider', 'Application',
  'Worker', 'Module', 'Entity', 'Dao', 'Interceptor',
  // React Native packages and codegen specs, when the base class is outside the corpus.
  'Package', 'Spec',
];

/**
 * A file bound to native code: `System.loadLibrary` loads a library whose
 * JNI side calls back into this file's classes by name, and a Kotlin
 * `external fun` is the mirror of a Java `native` method, which
 * JAVA_ENTRY_POINT_RE already reads. Either makes the whole file reachable
 * from a source this corpus has no extension for.
 */
const JNI_BRIDGE_RE = /\bSystem\.loadLibrary\s*\(|\bexternal\s+fun\b/;

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
  /**
   * What package resolution of duplicated names needs, gathered in the same
   * pass: resolving afterwards re-stripped and re-tokenized every file, and the
   * detector ran 20 percent slower. Only filled for the names asked for.
   */
  duplicates?: DuplicateMentions;
}

/** Where each duplicated name is written, with what can tell its bearers apart. */
export interface DuplicateMentions {
  /** Package declared by every code file read. */
  packageByPath: Map<string, string>;
  /** token -> one entry per code file that writes it in its body or inside an import. */
  byToken: Map<string, DuplicateMention[]>;
  /**
   * Tokens written where no package applies: a non code file, or a string
   * literal, which reflection or a DI container may resolve by name.
   */
  uncertain: Set<string>;
}

export interface DuplicateMention {
  path: string;
  filePackage: string;
  /** Every import of the file, star imports included. */
  imports: string[];
  /**
   * Qualifiers written right before the token in the body, `com.a` for
   * `com.a.Name`, and `` when the dot follows a call or a line break.
   */
  qualifiers: string[];
  /** Occurrences in the body with no dot before them, declarations included. */
  bare: number;
}

/**
 * Whether `at` sits inside a string literal that opened on its own line: odd
 * count of unescaped quotes before it. A char literal `'"'` flips the parity
 * and a multi line raw string goes unseen; the first error only keeps a name
 * alive, the second is rare enough to accept.
 */
function insideStringOnItsLine(text: string, at: number): boolean {
  let quotes = 0;
  for (let i = text.lastIndexOf('\n', at - 1) + 1; i < at; i++) {
    if (text.charCodeAt(i) !== 34) continue;
    let backslashes = 0;
    for (let j = i - 1; j >= 0 && text.charCodeAt(j) === 92; j--) backslashes++;
    if (backslashes % 2 === 0) quotes++;
  }
  return quotes % 2 === 1;
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

export { matchesGlob };

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

/**
 * The same, with LENGTH preserved: each import line becomes spaces.
 *
 * `stripImportLines` keeps the line count and drops the characters, which is
 * fine for counting occurrences and wrong for anything that then compares an
 * index in the result against an offset measured on the unstripped text. On
 * one real file with 55 imports the shift was 2697 characters, enough to move
 * a mention from a sibling class into the body of the class above it. The
 * member came back `selfOnly`, the bulk narrowing made it private, and the
 * module stopped compiling:
 *   Cannot access 'fun onItemRangeInserted(): Unit': it is private in ...
 */
export function blankImportLines(text: string): string {
  return text.split('\n').map(l => (/^\s*import\s/.test(l) ? ' '.repeat(l.length) : l)).join('\n');
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


/** Every modifier a declaration can wear, Kotlin and Java together. */
const MODIFICATEUR =
  '(?:(?:public|private|protected|internal|override|open|final|abstract|sealed|data|inner'
  + '|enum|annotation|value|companion|const|lateinit|inline|noinline|crossinline|suspend'
  + '|operator|infix|tailrec|external|expect|actual|static|synchronized|native|strictfp'
  + '|transient|volatile)\\s+)';

/**
 * A line that OPENS something of its own, so the line above it ended.
 *
 * Written once and used twice, by the freshness test and by the expression
 * walk below: two copies of this list would drift apart in a week.
 *
 * A modifier ALONE proves nothing. Every Kotlin modifier is a soft keyword,
 * which is to say an ordinary identifier: `value`, `data`, `open`, `expect`
 * name variables every day. Matching them bare read the continuation line of
 *   val ghostly = if (a)
 *       value
 *   else
 *       other
 * as a new declaration, so the cut took the first line alone and left the
 * three others behind. Only the HARD keywords stand on their own; a modifier
 * counts when a hard keyword follows it, or, in Java, a type and a name.
 */
const OUVRE_UNE_DECLARATION_RE = new RegExp(
  '^\\s*(?:'
  + '\\}|//|/\\*|@'
  + '|' + MODIFICATEUR + '*(?:va[lr]|fun|class|object|interface|typealias|init|constructor|companion)\\b'
  + '|' + MODIFICATEUR + '+[\\w.<>\\[\\],?]+\\s+\\w+\\s*[=(;]'
  + ')',
);

/**
 * A line that can only CONTINUE what is above it.
 *
 * The mirror of the freshness test, and deliberately not its negation: this
 * one lists tokens that no statement can begin with, so a yes here is proof
 * rather than an absence of proof. It answers where `lineBasedEnd` cannot:
 *
 *   fun getTagVisibility() = tag.text.takeIf { it.isNotBlank() }?.let { View.VISIBLE }
 *       ?: View.GONE
 *
 * The span stops on the lambda's closing brace, so the end is NOT line based
 * and the continuation test, gated on that, never ran. The cut took the first
 * line and left `?: View.GONE` alone in the file. Three such members on a real
 * project, all live code.
 *
 * `/` and `*` are left out on purpose: a KDoc block opening the NEXT
 * declaration starts with them, and reading that as a continuation would
 * swallow the declaration it documents.
 */
const COMMENCE_UNE_SUITE_RE =
  /^\s*(?:\?:|\?\.|\.(?!\.)|::|\+|&&|\|\||==|!=|<=|>=|->|,|\)|\]|else\b|in\b|is\b|as\b)/;

/** Une ligne qui se termine sur un operateur appelle une suite. */
export const FINIT_SUR_UN_OPERATEUR_RE = /(?:[+\-*/,.&|?:=(]|->)$/;

/**
 * Where a declaration's expression body really ends.
 *
 * `fun f(): T =` with its body on the next line, `val x =` followed by a call
 * chain, `get() = if (a) { } else { }`: the extent test could only ask "does
 * this line continue" and, when the answer was yes, give up. The answer is one
 * line further down, and then the same question again.
 *
 * Whole lines only, with bracket depth counted on the SANITIZED text so a `)`
 * inside a string closes nothing. A line ends the expression when it closes
 * every bracket the declaration opened, does not itself end on an operator,
 * and is not followed by a continuation. Returns -1 when the walk runs past
 * the enclosing block, past the file, or past 80 lines, which leaves the
 * caller refusing the extent exactly as it did before.
 */
const BLANC_RE = /\s/;

/**
 * L index du dernier caractere non blanc avant `jusqu`, ou -1.
 *
 * Meme ensemble de blancs que `trimEnd`, sans en allouer la copie. Les trois
 * questions posees a la fin d une declaration se lisaient chacune sur
 * `copie.slice(0, endOffset).trimEnd()`, soit deux copies du debut du fichier
 * par question, pour n en regarder que les deux derniers caracteres. Compte
 * sur le projet de reference : 36 329 appels a `removalExtent` par passe et
 * 177 Mo copies pour la seule variable devenue morte.
 *
 * Le temps, lui, ne bouge pas : sept passes A B entrelacees sur ce projet
 * donnent 9819 ms contre 9928 ms de mediane, distributions melees. Ces copies
 * partent parce qu elles ne servent a rien, pas pour un gain chronometre.
 */
export function dernierNonBlanc(s: string, jusqu: number): number {
  let i = Math.min(jusqu, s.length) - 1;
  while (i >= 0 && BLANC_RE.test(s[i])) i--;
  return i;
}

/**
 * Les deux derniers caracteres de CODE avant `jusqu`, commentaires effaces.
 *
 * Trois copies du fichier, trois questions. La profondeur et le point virgule
 * veulent le blanchi. L operateur veut le brut prive de ses commentaires mais
 * pas de ses chaines : sur le blanchi, `val x = "done"` se lirait sur son `=`,
 * et sur le brut une virgule dans `// etape 1,` se lirait comme une suite.
 *
 * Reconnaitre le commentaire sur le blanchi ne marche pas : les guillemets y
 * sont vides eux aussi, donc `"https://…"` y ressemble trait pour trait a un
 * commentaire, et la premiere version de ce correctif coupait la ligne apres
 * `"https:` puis, la voyant finir sur un `:`, emportait les deux declarations
 * suivantes.
 *
 * Cette copie se prend sur le FICHIER. La version qui strippait chaque ligne
 * isolement perdait le contexte : privee de son ouverture, une ligne
 * interieure de commentaire de bloc n a rien a effacer, et sa fermeture se
 * lisait comme une division.
 *
 * `depuis` borne la remontee : la marche pose la question a UNE ligne, la fin
 * de declaration la pose a tout ce qui precede.
 */
export function finDuCode(sc: string, jusqu: number, depuis = 0): string {
  const d = dernierNonBlanc(sc, jusqu);
  if (d < depuis) return '';
  return sc.slice(Math.max(depuis, d - 1), d + 1);
}

function finDeLExpression(
  clean: string,
  sc: string,
  lines: readonly string[],
  lineStarts: readonly number[],
  lineEndOf: (l: number) => number,
  premiereLigne: number,
  depuis: number,
  lastLine: number,
): number {
  // Compte sur des INDEX, sans decouper : une tranche par ligne allouait une
  // chaine a chaque pas et faisait basculer le balayage dans un mode lent une
  // fois sur deux. Mesure A/B entrelacee sur deadIslands.workspace : le
  // plancher de bruit ne bougeait pas, mais le mode haut passait de 30 % a
  // 65 % des passes. Les crochets sont tous en ASCII, donc l unite de code
  // suffit, et elle s aligne sur les offsets.
  const compte = (de: number, a: number): number => {
    let d = 0;
    for (let i = de; i < a; i++) {
      const c = clean.charCodeAt(i);
      if (c === 40 || c === 91 || c === 123) d++;
      else if (c === 41 || c === 93 || c === 125) d--;
    }
    return d;
  };
  let profondeur = compte(lineStarts[premiereLigne], lineEndOf(depuis));
  if (profondeur < 0) return -1;

  for (let l = depuis + 1; l <= lastLine && l <= depuis + 80; l++) {
    const brute = lines[l] ?? '';
    profondeur += compte(lineStarts[l], lineEndOf(l));
    // Sortir du bloc qui contient la declaration : la marche est perdue.
    if (profondeur < 0) return -1;
    if (profondeur > 0 || brute.trim() === '') continue;

    // La question de l operateur se pose a la copie du FICHIER sans ses
    // commentaires, jamais a la ligne strippee toute seule : isolee, une ligne
    // interieure de commentaire de bloc n a pas son ouverture, donc rien n y
    // est efface et sa fermeture se lisait comme une division. La marche
    // continuait a travers le commentaire et emportait la declaration vivante
    // posee dessous.
    if (FINIT_SUR_UN_OPERATEUR_RE.test(finDuCode(sc, lineEndOf(l), lineStarts[l]))) continue;
    // Un `;` a profondeur zero clot la declaration, quelle que soit la ligne
    // suivante : sans cela la marche traversait la methode Java d en dessous.
    //
    // Lu sur la copie BLANCHIE, pas sur la ligne brute. Un commentaire de fin
    // de ligne qui se termine par un point-virgule arretait la marche au
    // milieu de l'expression, et `val fantome = 1 + // note;` suivi de sa
    // continuation emportait la premiere ligne en laissant l'autre orpheline.
    // Le test de l'OPERATEUR juste au dessus veut l'inverse, le brut, parce
    // que le nettoyeur vide les chaines et que `val x = "done"` se lirait sur
    // son `=`. Les deux questions ne se posent pas a la meme copie.
    if (clean.slice(lineStarts[l], lineEndOf(l)).trimEnd().endsWith(';')) return lineEndOf(l);
    let suivante = l + 1;
    while (suivante <= lastLine && (lines[suivante] ?? '').trim() === '') suivante++;
    if (suivante <= lastLine && !OUVRE_UNE_DECLARATION_RE.test(lines[suivante] ?? '')) continue;
    return lineEndOf(l);
  }
  return -1;
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
  /**
   * La copie du fichier sans ses commentaires.
   *
   * Obligatoire, et paresseuse, pour deux raisons. La copie ne sert qu aux
   * declarations qui posent une question de fin, donc la calculer d office
   * serait la payer pour tout un projet. Et un parametre optionnel a repli
   * silencieux se paie sans se voir : quatre appelants sur cinq l auraient
   * oublie, chacun refaisant la copie entiere du fichier PAR declaration
   * morte. Mesure sur le projet de reference avant de fermer ce trou :
   * 311 Mo strippes au lieu de 91, et la passe qui prend 35 % de plus.
   */
  sansCommentaires: () => string,
): { removeStart: number; removeEnd: number } {
  let copieSc: string | undefined;
  const sc = (): string => (copieSc ??= sansCommentaires());
  const lines = text.split('\n');
  const lineEndOf = (l: number) => (l + 1 < lineStarts.length ? lineStarts[l + 1] : text.length);

  let firstLine = sym.line;
  for (let l = sym.line - 1; l >= 0; l--) {
    const trimmed = (lines[l] ?? '').trim();
    // An annotation line that declares something of its own
    // (`@Inject lateinit var analytics`) is a neighbour, not ours. The test
    // runs on what FOLLOWS the annotation: `@Deprecated("Use the val")` read
    // as a declaration because of the word inside its argument, and stayed.
    if (trimmed.startsWith('@') && !DECL_KEYWORD_RE.test(afterAnnotations(trimmed))) { firstLine = l; continue; }
    const annoStart = multiLineAnnotationStart(lines, l);
    if (annoStart !== -1) { firstLine = annoStart; l = annoStart; continue; }
    // Same walk as unusedDeclarations.ts: only through comment-only lines.
    // `val cache = … /* warm */` also ends with `*/`, and the walk used to
    // climb from there to the licence header and delete the whole file top.
    if (trimmed.endsWith('*/') && (trimmed.startsWith('/*') || trimmed.startsWith('*'))) {
      let k = l;
      while (k >= 0) {
        const t = (lines[k] ?? '').trim();
        if (t.startsWith('/*')) break;
        if (!t.startsWith('*')) { k = -1; break; }
        k--;
      }
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

  /** La fin, commentaires effaces : pour la question de l'operateur. */
  const trailingSansCommentaire = (): string => finDuCode(sc(), endOffset);
  /** Le dernier caractere utile de la copie blanchie, pour le point virgule. */
  const finBlanchie = dernierNonBlanc(clean, endOffset);
  const nextLineNum = offsetToPos(lineStarts as number[], Math.max(endOffset - 1, 0)).line + 1;
  let nextNonBlank = nextLineNum;
  while (nextNonBlank <= lastLine && (lines[nextNonBlank] ?? '').trim() === '') nextNonBlank++;
  // Tout mot qui OUVRE une declaration, pas seulement ceux qui portent son
  // genre. La liste s arretait a `data` et `inline` : un bloc de constantes,
  // la forme que prend tout companion object, se lisait comme UNE declaration
  // etalee sur six lignes, l etendue etait refusee et le diagnostic sortait
  // sans correctif. 58 des 66 declarations sans coupe sur exampleapp tenaient a
  // `const`. Ajouter un mot ne peut qu ouvrir une coupe, jamais l elargir :
  // l etendue vient de la portee, ce test decide seulement de la rendre.
  // Une ligne INTERIEURE d un commentaire de bloc ne commence par aucun des
  // signes de la liste : elle se lisait donc comme la suite de la declaration,
  // et la marche partait. Sans cela `val fantome = 1 /* on garde` suivi de
  // `   as is pour l instant */` emportait la fonction vivante d en dessous.
  //
  // Lu sur la copie sans commentaires, PAS sur la blanchie : celle-ci vide
  // aussi les chaines, guillemets compris, donc la ligne `    "off"` d un
  // `if else` a accolades y paraissait vide elle aussi et la coupe s arretait
  // sur `} else {`.
  const suivanteEstDuCommentaire = (): boolean => nextNonBlank <= lastLine
    && sc().slice(lineStarts[nextNonBlank], lineEndOf(nextNonBlank)).trim() === '';
  const nextStartsFresh = (): boolean =>
    nextNonBlank > lastLine ||
    OUVRE_UNE_DECLARATION_RE.test(lines[nextNonBlank] ?? '') ||
    suivanteEstDuCommentaire();
  // A trailing `;` closes the statement, in Java as in Kotlin. Without this the
  // freshness test decides, and its keyword list is Kotlin only: a Java field
  // starts with its TYPE (`int`, `String`), never with `val` or `fun`, so the
  // next line never read as fresh and no Java constant could be removed.
  // Lu sur la copie BLANCHIE : un commentaire de fin de ligne qui se termine
  // par un point-virgule faisait croire la declaration terminee, et
  //   val fantome = 1 + // note;
  //       2
  // perdait sa continuation, laissee orpheline dans le fichier. Le test de
  // l'OPERATEUR juste en dessous veut le brut, lui, parce que le nettoyeur
  // vide les chaines et que `val x = "done"` se lirait sur son `=`.
  const termine = finBlanchie >= 0 && clean[finBlanchie] === ';';
  const continues = span.lineBasedEnd && !termine
    && (FINIT_SUR_UN_OPERATEUR_RE.test(trailingSansCommentaire()) || !nextStartsFresh());
  // Une accolade de lambda n est pas forcement la fin de l expression, et la
  // portee s y arrete quand meme. La suite evidente repond la ou `lineBasedEnd`
  // se tait, sans jamais elargir les cas que la garde couvrait deja.
  const suiteEvidente = !continues && !termine
    && COMMENCE_UNE_SUITE_RE.test(clean.slice(lineStarts[nextNonBlank] ?? 0, lineEndOf(nextNonBlank)));
  if (continues || suiteEvidente) {
    const vraieFin = finDeLExpression(
      clean, sc(), lines, lineStarts, lineEndOf, sym.line,
      offsetToPos(lineStarts as number[], Math.max(endOffset - 1, 0)).line, lastLine);
    if (vraieFin === -1) return { removeStart: -1, removeEnd: -1 };
    endOffset = vraieFin;
  }

  const removeStart = lineStarts[firstLine];
  let removeEnd = lineEndOf(offsetToPos(lineStarts as number[], Math.max(endOffset - 1, removeStart)).line);

  // Une coupe ne doit jamais trancher un commentaire de bloc : sa fermeture
  // reste seule derriere et le fichier ne compile plus. Meme garde que celle
  // des chaines brutes plus bas, et meme facon de la reparer. Les marqueurs
  // sont comptes la ou la copie sans commentaires differe du brut, donc une
  // ouverture ecrite dans une chaine ne compte pas.
  // Une coupe ne doit jamais partager un commentaire de bloc avec ce qui
  // reste : la fermeture se retrouve seule et le fichier ne compile plus.
  // Meme garde que celle des chaines brutes plus bas, et meme reparation.
  // Ici on ETEND jusqu a la fermeture, parce que le commentaire commence sur
  // la ligne de la declaration qui part et parle d elle.
  if (coupeUnBloc(text, sc, removeEnd)) {
    const fin = text.indexOf('*/', removeEnd);
    if (fin === -1) return { removeStart: -1, removeEnd: -1 };
    removeEnd = lineEndOf(offsetToPos(lineStarts as number[], fin).line);
  }


  // A line-based extent takes WHOLE LINES, so a second declaration sharing the
  // line would go with the first. `val mort = 1; val vivant = 2` and the Java
  // `static int MORT = 1; static int VIVANT = 2;` both deleted live code.
  // Checked on the sanitized cut and only for a line-based end: inside a body
  // a `for (i = 0; i < n; i++)` has semicolons of its own, and refusing there
  // would withhold every function.
  if (span.lineBasedEnd) {
    for (const l of clean.slice(removeStart, removeEnd).split('\n')) {
      const pv = l.indexOf(';');
      if (pv !== -1 && l.slice(pv + 1).trim() !== '') return { removeStart: -1, removeEnd: -1 };
    }
  }

  // A cut must never split a raw string. The sanitizer blanks the `"""`
  // markers themselves, so `clean` holds no trace of them and the walk above
  // reads the body as a run of empty lines: on a real project it stopped in
  // the middle of twenty three JSON fixtures, leaving a dangling `"""`.
  // Counted on the RAW text, which is the only place those markers survive.
  const marqueurs = (t: string): number => {
    let n = 0;
    for (let i = 0; i + 2 < t.length; i++) {
      if (t[i] === '"' && t[i + 1] === '"' && t[i + 2] === '"') { n++; i += 2; }
    }
    return n;
  };
  if (marqueurs(text.slice(removeStart, removeEnd)) % 2 === 1) {
    const fin = text.indexOf('"""', removeEnd);
    if (fin === -1) return { removeStart: -1, removeEnd: -1 };
    const ligneFin = offsetToPos(lineStarts as number[], fin).line;
    return { removeStart, removeEnd: lineEndOf(ligneFin) };
  }

  return { removeStart, removeEnd };
}

/** Kotlin declarations of the corpus, top-level only, before any filtering. */
/**
 * The removal extent of a top-level declaration recomputed on `text` as it
 * is NOW. A finding carries offsets from the scan; an unsaved edit above the
 * declaration shifted them, and the fix deleted a neighbouring line.
 * Undefined when the declaration is no longer where the scan saw it.
 */
export function currentRemovalExtent(
  path: string,
  text: string,
  name: string,
  kind: UnusedSymbolKind,
  /** Line the finding was made on, to tell two overloads apart. */
  line?: number,
): { removeStart: number; removeEnd: number } | undefined {
  const parsed = path.endsWith('.java') ? parseJava(path, text) : parse(path, text);
  // Overloads share a name AND a kind, so the first match is not necessarily
  // the one that was reported: deleting the second `fun load` used to delete
  // the first, its @Keep annotation included. The file may have been edited
  // since the scan, so the reported line picks the nearest match rather than
  // an exact one.
  const matches = parsed.symbols.filter(s => s.depth === 0 && s.name === name && s.kind === kind);
  const sym = line === undefined
    ? matches[0]
    : matches.reduce<typeof matches[number] | undefined>(
      (best, s) => (best === undefined || Math.abs(s.line - line) < Math.abs(best.line - line)) ? s : best,
      undefined,
    );
  if (!sym) return undefined;
  const clean = sanitizeForUsageScan(text);
  const lineStarts = buildLineStarts(clean);
  const lastLine = lineStarts.length - 1;
  const span = declarationSpan(clean, lineStarts, {
    kind: sym.kind === 'fun' || sym.kind === 'composable' ? 'fun'
      : sym.kind === 'val' || sym.kind === 'var' ? 'prop' : 'classLike',
    name: sym.name,
    line: sym.line,
    nameOffset: lineStarts[sym.line] + sym.character,
    lastLine,
  });
  if (!span) return undefined;
  // Une seule declaration par appel : la copie n a personne avec qui se
  // partager.
  return removalExtent(text, clean, lineStarts, lastLine, sym, span, () => stripKotlinComments(text));
}

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
  const perFile: { path: string; clean: string; syms: RawSymbol[]; text: string; sc?: string }[] = [];

  for (const src of sources) {
    // The mention harvest already read Java; only candidate discovery skipped
    // it. Java members and fields always sit at depth >= 1, so the existing
    // depth filter below keeps this to top-level types with no extra code.
    const isJava = src.path.endsWith('.java');
    if (!isJava && !src.path.endsWith('.kt')) continue;
    if (isBuildArtifactPath(src.path)) continue;
    const parsed = isJava ? parseJava(src.path, src.text) : parse(src.path, src.text);
    // `$anon$<line>` is the parser's synthetic name for `object : Base { }`, kept
    // so lookupImplementations() can count anonymous implementors. It is not a
    // declaration: WORD_RE cannot produce that token, so its mention count is
    // always zero and it would walk through every test below untouched.
    const tops = parsed.symbols.filter(
      s => s.depth === 0 && CANDIDATE_KINDS.has(s.kind) && !s.name.startsWith('$'));
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

    // A Kotlin `@Test` class is a runner entry point too, wherever it sits:
    // `src/e2e/kotlin` is no Gradle test source set, and its classes were
    // offered for deletion.
    if (isJava ? JAVA_ENTRY_POINT_RE.test(src.text) : parsed.symbols.some(s => s.isTest)) exemptByEntryPoint.add(src.path);
    if (JNI_BRIDGE_RE.test(src.text)) exemptByEntryPoint.add(src.path);

    // F18: a generator owns this file, and the next build rewrites it. Acting
    // on a finding here is wasted, and generator conventions read as dead code
    // to a textual scan.
    if (isGeneratedSource(src.text)) continue;
    if (isTestSourceSet(src.path, testSourceSets)) continue; // F2
    // F12, file scope: `@file:Suppress("unused")` opts the whole file out. It
    // sits above `package` — `fileOptsOut` reads only there, so a mention in a
    // KDoc or a string cannot silence the file — and the per-declaration
    // annotation window below cannot see it.
    if (fileOptsOut(src.text, UNUSED_DECLARATION)) continue;
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
        // Une seule copie sans commentaires par FICHIER, et seulement si un
        // symbole mort y demande son etendue.
        ...removalExtent(file.text, file.clean, lineStarts, lastLine, sym, span,
          () => (file.sc ??= stripKotlinComments(file.text))),
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
  /** Duplicated names to collect package data for, when resolving F3. */
  duplicateTokens?: ReadonlySet<string>,
): Harvest {
  const harvest: Harvest = { main: new Map(), test: new Map(), aliased: new Set(), importPostings: new Map() };
  const dup: DuplicateMentions | undefined = duplicateTokens && duplicateTokens.size > 0
    ? { packageByPath: new Map(), byToken: new Map(), uncertain: new Set() }
    : undefined;
  if (dup) harvest.duplicates = dup;

  for (const src of sources) {
    // G2 of KJ-031, same reason: R8 writes every name of the build into these,
    // and a tool cache does the same. Reading one marks the project alive.
    if (isBuildArtifactPath(src.path)) continue;
    // A `nitro.json` is the one JSON that names code: its `autolinking` block
    // maps a JavaScript name to the Kotlin class Nitro instantiates for it.
    if (/\.(json|lock)$/i.test(src.path) && !/[\\/]nitro\.json$/.test(src.path)) continue;

    const bag = isTestSourceSet(src.path, testSourceSets) ? harvest.test : harvest.main;
    const isCode = /\.(kt|kts|java)$/.test(src.path);
    const isXml = /\.xml$/.test(src.path);

    // H6: for a ServiceLoader entry the SPI name is the file name itself.
    if (/[\\/]META-INF[\\/]services[\\/]/.test(src.path)) {
      for (const token of src.path.split(/[\\/.]/)) bump(bag, token, wanted);
    }

    let text = src.text;
    let fileImports: string[] | undefined;
    let filePackage = '';
    let perToken: Map<string, DuplicateMention> | undefined;
    if (isCode) {
      // Comments do not count: a commented-out reference is exactly the case
      // we want reported. String contents DO count (reflection, DI by name).
      text = stripKotlinComments(text);
      if (dup) {
        filePackage = packageOf(text);
        dup.packageByPath.set(src.path, filePackage);
        fileImports = [];
      }
      const lines = text.split('\n');
      for (let i = 0; i < lines.length; i++) {
        // `static` for Java, and the trailing `;` is simply not captured.
        const imp = /^\s*import\s+(?:static\s+)?([\w.]+)(?:\s+as\s+(\w+))?/.exec(lines[i]);
        if (!imp) continue;
        const segments = imp[1].split('.');
        if (fileImports) fileImports.push(imp[1]);
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
          // A token only inside an import, before its last segment, still needs
          // an entry: `import p.Cmd.DISPATCH` depends on `p.Cmd`.
          if (fileImports && s > 0 && duplicateTokens!.has(segments[s])) {
            perToken ??= new Map();
            if (!perToken.has(segments[s])) {
              perToken.set(segments[s], { path: src.path, filePackage, imports: fileImports, qualifiers: [], bare: 0 });
            }
          }
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
    while ((m = WORD_RE.exec(text)) !== null) {
      // Inlined bump: every word of the corpus goes through here, and the
      // duplicated names are a subset of the wanted ones.
      if (!wanted.has(m[0])) continue;
      bag.set(m[0], (bag.get(m[0]) ?? 0) + 1);
      if (!dup || !duplicateTokens!.has(m[0])) continue;
      if (!isCode || insideStringOnItsLine(text, m.index)) { dup.uncertain.add(m[0]); continue; }
      perToken ??= new Map();
      let entry = perToken.get(m[0]);
      if (!entry) {
        entry = { path: src.path, filePackage, imports: fileImports!, qualifiers: [], bare: 0 };
        perToken.set(m[0], entry);
      }
      // `com.a.Name`: the qualifier is the dotted run right before the token.
      if (m.index > 0 && text[m.index - 1] === '.') {
        let q = m.index - 1;
        while (q > 0 && /[\w.]/.test(text[q - 1])) q--;
        entry.qualifiers.push(text.slice(q, m.index - 1));
      } else {
        entry.bare++;
      }
    }
    if (perToken) {
      for (const [token, entry] of perToken) {
        const list = dup!.byToken.get(token) ?? [];
        list.push(entry);
        dup!.byToken.set(token, list);
      }
    }
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
      if (FRAMEWORK_SUPERTYPES.has(bare) || GENERATED_FRAMEWORK_SUPERTYPE_RE.test(bare)) {
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

    // Count each FILE once. Two declarations of the name in the same file
    // each see the other's name token in their own `selfInFile`, so summing
    // per candidate counted that file twice and the group read as mentioned:
    // two dead overloads sitting side by side were never reported, while the
    // same two in separate files were.
    const byFile = new Map<string, Candidate[]>();
    for (const c of group) {
      const inFile = byFile.get(c.path) ?? [];
      inFile.push(c);
      byFile.set(c.path, inFile);
    }
    let self = 0;
    let outsideOwnSpan = 0;
    for (const inFile of byFile.values()) {
      const fileMentions = inFile[0].selfInFile;
      const owned = inFile.reduce((n, c) => n + c.selfInSpan, 0);
      self += fileMentions;
      outsideOwnSpan += fileMentions - owned;
    }
    // `outsideOwnSpan` catches a declaration used elsewhere in its own file:
    // that use may belong to any member of the group, so the group stays out.
    if (mentions - self === 0 && outsideOwnSpan === 0) out.add(name);
  }
  return out;
}

/** True when the import at `posting` names `c` in its own package, and nothing else. */
function importsFromPackage(sources: readonly SymbolSource[], posting: StaleImport, c: Candidate, harvest: Harvest): boolean {
  const importer = sources.find(src => src.path === posting.path);
  if (!importer) return false;
  // Read on the same comment free copy the posting line was counted on. On the
  // raw line `import p.Name // gone` did not match, the import stayed behind
  // the deleted declaration and the file no longer compiled.
  const line = stripKotlinComments(importer.text).split('\n')[posting.line] ?? '';
  const p = harvest.duplicates?.packageByPath.get(c.path) ?? '';
  return new RegExp(`^\\s*import\\s+${p.replace(/\./g, '\\.')}\\.${c.name}\\s*;?\\s*$`).test(line);
}

/** The package a Kotlin or Java file declares, or '' for the default package. */
function packageOf(strippedText: string): string {
  return /^\s*package\s+([\w.]+)/m.exec(strippedText)?.[1] ?? '';
}

function isClassLike(c: Candidate): boolean {
  return c.kind !== 'fun' && c.kind !== 'composable' && c.kind !== 'val' && c.kind !== 'var';
}

/**
 * F3 again, resolved by PACKAGE.
 *
 * `duplicatesWithNoMention` clears a duplicated name only when the corpus
 * never mentions it. On the reference project thirteen screens each declare
 * their own `internal data class Dimensions` and use it at home: one screen's
 * copy, left with no use at all, was never reported because the twelve others
 * said "Dimensions" elsewhere. 783 declarations were held back that way.
 *
 * The compiler knows better. A `Dimensions` written in a file can only name the
 * one declared in package P when the file is IN P, spells `P.Dimensions`, or
 * imports it: `P.Dimensions` itself, something inside it, or `P.*`. Importing
 * ANOTHER name of P shows nothing, except from Java to a top level function or
 * property, which is reached through a facade class whose name `@JvmName` can
 * change: there any import from P counts.
 *
 * In the file of another bearer, the name designates that bearer when both
 * are classes, since classifiers do not overload. Otherwise only when its
 * declaration is the one occurrence: a call there may pick the overload of P,
 * or the function of P over a constructor that does not apply, through a star
 * import.
 *
 * Every doubt counts as a use: a mention in a non code file or in a string, a
 * mention from a test that could see P, two bearers in the same package, a
 * bearer in the root package. The first two keep the declaration alive, the
 * last two keep it out.
 *
 * Returns the candidates proven unreferenced this way, by identity: unlike the
 * unmentioned groups, only SOME members of a name are cleared.
 */
function duplicatesResolvedByPackage(
  candidates: readonly Candidate[],
  topLevelNameCounts: ReadonlyMap<string, number>,
  harvest: Harvest,
  alreadyCleared: ReadonlySet<string>,
): Set<Candidate> {
  const dup = harvest.duplicates;
  if (!dup) return new Set();

  const byName = new Map<string, Candidate[]>();
  for (const c of candidates) {
    if ((topLevelNameCounts.get(c.name) ?? 0) <= 1 || alreadyCleared.has(c.name)) continue;
    if (!/\.(kt|java)$/.test(c.path)) continue;
    const list = byName.get(c.name) ?? [];
    list.push(c);
    byName.set(c.name, list);
  }

  // Every bearer visible and no aliased import, as for the unmentioned groups.
  // The rest is decided per BEARER, since the package tells them apart: one
  // used in its own file, or mentioning its name twice in its own span, stays
  // out alone. Two bearers in the same package need no rule of their own: each
  // one's declaration is a mention the other's package can see.
  const out = new Set<Candidate>();
  for (const [name, group] of byName) {
    if (group.length !== topLevelNameCounts.get(name)) continue;
    if (harvest.aliased.has(name)) continue;
    const tokens = [name];
    if (group.some(c => c.kind === 'val' || c.kind === 'var')) tokens.push(...accessorNames(name));   // H9
    if (tokens.some(t => dup.uncertain.has(t))) continue;
    const bearerAt = new Map(group.map(c => [c.path, c]));

    for (const c of group) {
      // Used in its own file, or mentioning its name twice in its own span:
      // out alone, the package cannot tell those apart.
      if (c.selfInSpan !== 1 || c.selfInFile !== c.selfInSpan) continue;
      const p = dup.packageByPath.get(c.path) ?? '';
      if (p === '') continue;
      const classLike = isClassLike(c);

      const seen = tokens.some(t => (dup.byToken.get(t) ?? []).some(mention => {
        if (mention.path === c.path) return false;
        if (mention.filePackage === p || mention.qualifiers.includes(p)) return true;
        if (mention.imports.some(i => i === `${p}.${t}` || i.startsWith(`${p}.${t}.`))) return true;
        const twin = bearerAt.get(mention.path);
        if (twin && (classLike && isClassLike(twin)
          || t === name && twin.selfInSpan === 1 && twin.selfInFile === 1)) return false;
        if (mention.imports.includes(`${p}.`)) return true;
        return !classLike && /\.java$/.test(mention.path) && mention.imports.some(i => i.startsWith(`${p}.`));
      }));
      if (!seen) out.add(c);
    }
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
  /** Bearers of a duplicated name that nothing able to see their package mentions. */
  resolvedDuplicates: ReadonlySet<Candidate>;
  /** KJ-064: singly declared top level names whose only other mentions are a library's. */
  resolvedSingles: ReadonlyMap<Candidate, UnusedSymbolVerdict>;
}

/** A name the mention harvest can actually look for. */
const BARE_IDENTIFIER_RE = /^[A-Za-z_]\w*$/;

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
  // F11: a backtick name is not an identifier, and the mention harvest is
  // identifier based. `\`a ghost\`()` at a call site is invisible to it, so
  // absence can never be proven here. This used to hold by accident, because
  // `declarationSpan` could not delimit such a declaration either; teaching it
  // backticks (KJ-047 needs it for test functions) turned a called function
  // into a removable finding.
  if (!BARE_IDENTIFIER_RE.test(c.name)) return 'F11:backtick-name';
  if (sym.isPrivate) return 'F1:private';
  if ((topLevelNameCounts.get(c.name) ?? 0) > 1 && !unmentionedDuplicates.has(c.name)
    && !ctx.resolvedDuplicates.has(c)) {
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
  /** KJ-064: the verdict came from the package rule, the bag's count being a homonym's. */
  via?: 'visibility';
  mainMentions: number;
  testMentions: number;
}

/** Duplicated top level names, with the Java accessors of a duplicated property. */
function duplicateTokens(candidates: readonly Candidate[], counts: ReadonlyMap<string, number>): Set<string> {
  const out = new Set<string>();
  for (const c of candidates) {
    if ((counts.get(c.name) ?? 0) <= 1 && !isVisibilityScoped(c)) continue;
    out.add(c.name);
    if (c.kind === 'val' || c.kind === 'var') for (const a of accessorNames(c.name)) out.add(a);
  }
  return out;
}

/**
 * KJ-064: a top level Kotlin function or property is reached only from its
 * own package, from a file that imports it by name (or its package whole),
 * or from Java through the file's facade class. A mention anywhere else
 * names something else, however many there are.
 *
 * Measured on the reference project: `fun ImageView.loadUrl(url: String)`,
 * imported by nobody, called by nobody in its package, stayed alive on the
 * strength of nineteen files calling `WebView.loadUrl`, an Android method.
 * A reviewer saw it; the bag of names could not.
 *
 * Only the declarations the package rule can decide: a class is reached
 * through XML, manifests and reflection too, and an operator or a
 * convention function is called without its name. An annotated declaration
 * is already a framework's (F5), a private one its file's (F1).
 */
function isVisibilityScoped(c: Candidate): boolean {
  return /\.kt$/.test(c.path)
    && (c.kind === 'fun' || c.kind === 'val' || c.kind === 'var')
    && !c.sym.isOperator && !c.sym.isPrivate
    && c.name !== 'main'
    && BARE_IDENTIFIER_RE.test(c.name)
    && !/^component\d+$/.test(c.name)
    && !CONVENTION_FUN_NAMES.has(c.name)
    && c.annoNames.every(a => BENIGN_TOPLEVEL_ANNOTATIONS.has(a));
}

/**
 * The singly declared top level functions and properties nothing able to see
 * their package mentions: the same visibility test as the duplicated names,
 * applied to a name whose other mentions belong to a library. Returns each
 * one's verdict: seen from a test that can see the package, testOnly;
 * from nowhere, unreferenced. A doubt (a string, a non code file, an aliased
 * import, a root package, a name used in its own file) leaves the bag's
 * count in charge, as before.
 */
function singlesResolvedByPackage(
  candidates: readonly Candidate[],
  counts: ReadonlyMap<string, number>,
  harvest: Harvest,
  testSourceSets: readonly string[],
): Map<Candidate, UnusedSymbolVerdict> {
  const out = new Map<Candidate, UnusedSymbolVerdict>();
  const dup = harvest.duplicates;
  if (!dup) return out;
  for (const c of candidates) {
    if ((counts.get(c.name) ?? 0) !== 1 || !isVisibilityScoped(c)) continue;
    if (harvest.aliased.has(c.name)) continue;
    if (c.selfInSpan !== 1 || c.selfInFile !== c.selfInSpan) continue;
    const tokens = [c.name];
    if (c.kind === 'val' || c.kind === 'var') tokens.push(...accessorNames(c.name));   // H9
    if (tokens.some(t => dup.uncertain.has(t))) continue;
    const p = dup.packageByPath.get(c.path) ?? '';
    if (p === '') continue;
    let seenMain = false;
    let seenTest = false;
    for (const t of tokens) {
      for (const mention of dup.byToken.get(t) ?? []) {
        if (mention.path === c.path) continue;
        const visible = mention.filePackage === p || mention.qualifiers.includes(p)
          || mention.imports.some(i => i === `${p}.${t}` || i.startsWith(`${p}.${t}.`))
          || mention.imports.includes(`${p}.`)
          // Java reaches a top level declaration through the facade class,
          // whose name `@JvmName` can change: any import from P counts.
          || (/\.java$/.test(mention.path) && mention.imports.some(i => i.startsWith(`${p}.`)));
        if (!visible) continue;
        if (isTestSourceSet(mention.path, testSourceSets)) seenTest = true; else seenMain = true;
      }
    }
    if (seenMain) continue;
    out.set(c, seenTest ? 'testOnly' : 'unreferenced');
  }
  return out;
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
  const unmentionedDuplicates = duplicatesWithNoMention(
    collected.candidates, collected.topLevelNameCounts, harvest);
  return {
    topLevelNameCounts: collected.topLevelNameCounts,
    exemptFiles: new Set(
      input.sources.filter(s => s.text.includes(IGNORE_MARKER)).map(s => s.path),
    ),
    supertypesByName: collected.supertypesByName,
    parentsOfAnnotatedSubtypes: collected.parentsOfAnnotatedSubtypes,
    exemptByEntryPoint: collected.exemptByEntryPoint,
    unmentionedDuplicates,
    resolvedDuplicates: duplicatesResolvedByPackage(
      collected.candidates, collected.topLevelNameCounts, harvest, unmentionedDuplicates),
    resolvedSingles: singlesResolvedByPackage(
      collected.candidates, collected.topLevelNameCounts, harvest, input.testSourceSets),
  };
}

export function explainSymbols(input: UnusedSymbolScanInput): SymbolExplanation[] {
  const collected = collectTopLevelCandidates(input.sources, input.testSourceSets);
  const { candidates } = collected;
  const harvest = harvestMentions(input.sources, wantedNames(candidates), input.testSourceSets,
    duplicateTokens(candidates, collected.topLevelNameCounts));
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
    else if (ctx.resolvedDuplicates.has(c)) outcome = 'unreferenced';
    else if (ctx.resolvedSingles.has(c)) outcome = ctx.resolvedSingles.get(c)!;
    else if (!ctx.unmentionedDuplicates.has(c.name) && mainMentions - c.selfInFile !== 0) outcome = 'alive:main';
    // Mirror of the scan: a twin declared in the same file is not a mention.
    else if (!ctx.unmentionedDuplicates.has(c.name)
      && c.selfInFile - c.selfInSpan > 0) outcome = 'alive:same-file';
    else outcome = testMentions > 0 ? 'testOnly' : 'unreferenced';

    return {
      name: c.name, kind: c.kind, path: c.path, line: c.sym.line, outcome, mainMentions, testMentions,
      ...(ctx.resolvedSingles.has(c) ? { via: 'visibility' as const } : {}),
    };
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
 * A declaration usually sits between two blank lines. Cutting it whole leaves
 * the two side by side, and a formatter refuses that: detekt's
 * NoConsecutiveBlankLines goes red, one finding per cut. Both removal
 * commands already grow their extents for it (`wholeLineExtent` above, and
 * `sansTrouDeLignesVides` in Remove Everything Unused, kept in step by the
 * BothPathsCutTheSame witness); the test cuts of the closure planner did not.
 * Same policy as the merged pass: when the line above the extent is blank
 * and the line below is blank too, the extent takes the one below, and the
 * file keeps a single blank line where the declaration stood. Nothing is
 * taken at the very start or end of the file.
 */
export function absorbOneBlankLine(text: string, lineStart: number, lineEnd: number): { start: number; end: number } {
  const above = text.lastIndexOf('\n', lineStart - 2);
  const previousLine = lineStart >= 1 ? text.slice(above === -1 ? 0 : above + 1, lineStart - 1) : undefined;
  const nextBreak = text.indexOf('\n', lineEnd);
  const nextLine = lineEnd < text.length ? text.slice(lineEnd, nextBreak === -1 ? text.length : nextBreak) : undefined;
  if (previousLine !== undefined && previousLine.trim() === '' && lineStart >= 2
    && nextLine !== undefined && nextLine.trim() === '' && nextBreak !== -1) {
    return { start: lineStart, end: nextBreak + 1 };
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

  const harvest = harvestMentions(input.sources, wantedNames(candidates), input.testSourceSets,
    duplicateTokens(candidates, collected.topLevelNameCounts));
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
    const resolved = ctx.resolvedDuplicates.has(c);
    // KJ-064: a single whose package rule found no visible mention; the bag's
    // count is a library homonym's.
    const single = ctx.resolvedSingles.get(c);
    const mainElsewhere = ctx.unmentionedDuplicates.has(c.name) || resolved || single !== undefined
      ? 0
      : mentionsOf(harvest.main, c) - c.selfInFile;
    // Defensive: over-counting self would manufacture a finding, so any
    // negative residue reads as alive.
    if (mainElsewhere !== 0) continue;
    // Same reasoning as above for a twin declared in the SAME file: the group
    // check already proved the only mentions are the declarations themselves.
    if (!ctx.unmentionedDuplicates.has(c.name)
      && c.selfInFile - c.selfInSpan > 0) continue;   // used elsewhere in its own file

    // A resolved bearer was proven unmentioned by tests too; the bag's test
    // count belongs to its twins.
    const testMentions = resolved ? 0 : single !== undefined ? (single === 'testOnly' ? 1 : 0) : mentionsOf(harvest.test, c);
    const verdict: UnusedSymbolVerdict = testMentions > 0 ? 'testOnly' : 'unreferenced';
    if (verdict === 'testOnly' && input.includeTestOnly === false) continue;

    out.push({
      // A resolved bearer shares its name with live twins: only an import of
      // ITS package goes, or the cascade would delete the import a twin needs.
      staleImports: resolved || single !== undefined
        ? (harvest.importPostings.get(c.name) ?? []).filter(posting =>
          importsFromPackage(input.sources, posting, c, harvest))
        : harvest.importPostings.get(c.name) ?? [],
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
    // Test-only findings never carry a removal: a file that still holds one
    // is not emptied, and "Delete X.kt (nothing else in it)" was breaking tests.
    const removable = findings.filter(f => f.verdict === 'unreferenced' && f.removeStart !== -1);
    const empties = removable.length === findings.length
      && fileBecomesEmpty(text, removable.map(f => ({ start: f.removeStart, end: f.removeEnd })));
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
