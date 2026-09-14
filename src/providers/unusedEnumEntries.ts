import { parse, RawSymbol } from '../indexer/KotlinParser';
import { stripKotlinComments } from '../util/xmlRefs';
import { coupeUnBloc, debutDuBloc } from '../util/blocDeCommentaire';
import { parseJava } from '../indexer/JavaParser';
import {
  fileOptsOut,
  UNUSED_DECLARATION,
  suppressesDiagnostic,
  buildLineStarts,
  collectAnnotationTargets,
  offsetToPos,
  sanitizeForUsageScan,
  findMatchingParen,
  matchBrace,
} from '../util/kotlinScan';
import { isTestSourceSet } from '../util/testPaths';
import { isBuildArtifactPath, isGeneratedSource } from '../util/resourceAllowlists';
import { Harvest, harvestMentions, SymbolSource } from './unusedSymbols';
import { DTO_NAME_RE, SERIALIZATION_ANNOTATIONS } from './unusedDtoFields';

/**
 * KJ-039: enum entries nothing in the workspace ever names.
 *
 * An enum accumulates dead variants faster than any other construct, because
 * removing the last use of one leaves the declaration compiling. Nothing in
 * the build complains, so they stay for years.
 *
 * ## Why the guards live on the ENUM, not on the entry
 *
 * An enum can be reached in ways that name no entry at all:
 *
 *   for (m in Mode.values())          // every entry, none of them written
 *   Mode.valueOf(fromServer)          // any entry, chosen at runtime
 *   @Serializable enum class Mode     // the JSON library maps names for us
 *
 * Each of those makes EVERY entry reachable. So a guard that fires takes the
 * whole enum out of scope, entry by entry reasoning never even starts. Judging
 * entries one at a time would report the variant that happens not to appear in
 * source while its siblings do, which is the worst kind of wrong: plausible.
 *
 * ## The contract, unchanged
 *
 * A finding means NO TEXTUAL REFERENCE EXISTS IN WHAT WE CAN READ. String
 * literals count, XML counts, a truncated corpus produces nothing. The harvest
 * is shared with KJ-032 rather than rebuilt, so the two detectors can never
 * disagree about what counts as a mention.
 */

export interface UnusedEnumEntryScanInput {
  sources: readonly SymbolSource[];
  testSourceSets: readonly string[];
  /** An incomplete corpus cannot prove absence, so it produces nothing. */
  truncated?: boolean;
  /** Enum names, or `Enum.ENTRY`, never reported. */
  ignoreNames?: readonly string[];
  includeTestOnly?: boolean;
}

export type EnumEntryVerdict = 'unreferenced' | 'testOnly';

export interface UnusedEnumEntry {
  /** The entry, e.g. `DENY`. */
  name: string;
  /** The enum holding it, e.g. `Mode`. */
  enumName: string;
  verdict: EnumEntryVerdict;
  path: string;
  line: number;
  character: number;
  /** Whole-line extent, or -1 when removing it is not obviously safe. */
  removeStart: number;
  removeEnd: number;
  testMentions: number;
  /**
   * Every test mention of the name is proven to be this entry's. False when
   * another enum declares the name and a test names that one, or when the
   * mentions could not be told apart: the tests to remove along with the entry
   * are then planned by name, and would take the other entry's tests too.
   */
  testsNameOnlyThisEntry: boolean;
}

/** One line per raw entry, saying what happened to it. For `--why`. */
export interface EnumEntryExplanation {
  name: string;
  enumName: string;
  path: string;
  line: number;
  outcome: string;
}

/**
 * Members whose presence means the enum is walked or resolved as a whole.
 *
 * `values`/`entries` iterate every variant and `valueOf`/`enumValueOf` pick
 * one from a string at runtime, so no source line needs to name an entry for
 * it to be reached.
 *
 * `ordinal` is deliberately ABSENT: it only ever appears on an instance one
 * already holds (`Mode.ALLOW.ordinal`), which says nothing about the other
 * entries. Reading an entry back by position goes through `values()[i]` or
 * `entries[i]`, both already covered. Including it would silence real
 * findings for nothing.
 */
const WHOLE_ENUM_MEMBERS = ['values', 'entries', 'valueOf', 'enumValueOf', 'class'];
// `enumValueOf<Mode>(s)`, `enumValues<Mode>()`, `enumEntries<Mode>()`: the reified
// forms name the enum as a type argument, not as a receiver.
const REIFIED_ENUM_FNS = ['enumValues', 'enumValueOf', 'enumEntries'];
const DTO_CLASS_KINDS = new Set(['class', 'dataClass', 'sealedClass', 'object', 'interface', 'enum', 'annotation']);

/**
 * Annotations that do NOT make every entry reachable. Everything else does,
 * the same allowlist stance as KJ-032: a serializer, a Room converter or a
 * Retrofit adapter maps entry names without any of them appearing in code.
 */
const BENIGN_ENUM_ANNOTATIONS = new Set([
  'Deprecated', 'JvmField', 'Suppress', 'SuppressWarnings', 'OptIn', 'RequiresApi',
  'Immutable', 'Stable',
]);

const IGNORE_MARKER = 'kotlin-jump:ignore unused-enum-entry';

interface EnumDecl {
  name: string;
  path: string;
  entries: RawSymbol[];
  /** Guard that took the whole enum out of scope, or null. */
  rejection: string | null;
  /** Entries whose own `@Suppress` names `unused`: out of scope one by one. */
  silenced: ReadonlySet<RawSymbol>;
  isTest: boolean;
}

/** Enums of the corpus with their entries, and why some are out of scope. */
export function collectEnums(
  sources: readonly SymbolSource[],
  testSourceSets: readonly string[],
): EnumDecl[] {
  const out: EnumDecl[] = [];

  for (const src of sources) {
    const isJava = src.path.endsWith('.java');
    if (!isJava && !src.path.endsWith('.kt')) continue;
    if (isBuildArtifactPath(src.path)) continue;
    if (isGeneratedSource(src.text)) continue;                        // E4
    if (!/\benum\b/.test(src.text)) continue;

    if (fileOptsOut(src.text, UNUSED_DECLARATION)) continue;
    if (src.text.includes(IGNORE_MARKER)) continue;

    const parsed = isJava ? parseJava(src.path, src.text) : parse(src.path, src.text);
    const clean = sanitizeForUsageScan(src.text);
    const lineStarts = buildLineStarts(clean);
    const annotations = collectAnnotationTargets(clean);

    // Group entries under the enum immediately above them in the nesting.
    const stack: RawSymbol[] = [];
    const byEnum = new Map<RawSymbol, RawSymbol[]>();
    for (const sym of parsed.symbols) {
      stack.length = sym.depth;
      stack[sym.depth] = sym;
      if (sym.kind !== 'enum') continue;
      const parent = sym.depth > 0 ? stack[sym.depth - 1] : undefined;
      if (parent && parent.kind === 'enum') {
        const list = byEnum.get(parent) ?? [];
        list.push(sym);
        byEnum.set(parent, list);
      } else if (!byEnum.has(sym)) {
        byEnum.set(sym, []);
      }
    }

    // `Suppress` is benign here, which only says it makes nothing reachable.
    // Whether it opts OUT depends on the diagnostic it names, and nothing
    // asked: `@Suppress("unused")` on the enum or on the entry itself left the
    // entry reported, and Remove Everything Unused deleted it. Arguments are
    // read on the raw text, the sanitizer blanks strings.
    const silenceAt = (sym: RawSymbol, before?: RawSymbol): boolean => {
      // From the end of the declaration that shares the line, not from the
      // line start: on `enum class E { A, @Suppress("unused") B, C }` the
      // annotation of B fell in the window of C, and C was never reported.
      const slo = before && before.line === sym.line
        ? lineStarts[before.line] + before.character + before.name.length
        : lineStarts[sym.line];
      const shi = lineStarts[sym.line] + sym.character;
      return annotations.some(a => a.target >= slo && a.target <= shi
        && (a.name === 'Suppress' || a.name === 'SuppressWarnings') && a.argStart >= 0
        && suppressesDiagnostic(src.text.slice(a.argStart, a.argEnd), UNUSED_DECLARATION));
    };

    for (const [enumSym, entries] of byEnum) {
      if (entries.length === 0) continue;
      // E5: an annotation on ANY entry means the generator or a serializer
      // maps the whole set by name. `@SerializedName("circle")` on one variant
      // says the others come back from JSON the same way.
      const annotatedEntry = entries.some(entry => {
        const elo = lineStarts[entry.line];
        const ehi = elo + entry.character;
        return annotations.some(a => a.target >= elo && a.target <= ehi
          && !BENIGN_ENUM_ANNOTATIONS.has(a.name));
      });
      const lo = lineStarts[enumSym.line];
      const hi = lo + enumSym.character;
      const foreign = annotations
        .filter(a => a.target >= lo && a.target <= hi)
        .map(a => a.name)
        .find(a => !BENIGN_ENUM_ANNOTATIONS.has(a));

      out.push({
        name: enumSym.name,
        path: src.path,
        entries,
        rejection: silenceAt(enumSym) ? 'F12:suppress-unused'
          : foreign ? `E3:@${foreign}` : annotatedEntry ? 'E5:annotated-entry' : null,
        silenced: new Set(entries.filter((entry, k) => silenceAt(entry, entries[k - 1]))),
        isTest: isTestSourceSet(src.path, testSourceSets),
      });
    }
  }

  return out;
}

/**
 * Every enum the corpus walks or resolves as a whole, in ONE pass.
 *
 * Matched on the enum's own name followed by the member, so an unrelated
 * `values()` on a list nearby cannot silence a real finding. `Mode::class`
 * counts too: reflection can reach any entry.
 *
 * Asking this enum by enum reads the whole corpus once per enum. On a 6423
 * file workspace with a few hundred enums that took nine seconds, against 1.3
 * for the bus detector. One pass, one regex, all names at once.
 */
export function findWalkedEnums(
  enumNames: ReadonlySet<string>,
  sources: readonly SymbolSource[],
): Set<string> {
  const walked = new Set<string>();
  if (enumNames.size === 0) return walked;
  const re = new RegExp(
    `\\b([A-Z]\\w*)\\s*(?:\\.\\s*(?:${WHOLE_ENUM_MEMBERS.join('|')})\\b|::)`, 'g');
  const reified = new RegExp(`\\b(?:${REIFIED_ENUM_FNS.join('|')})\\s*<\\s*([A-Z]\\w*)\\s*>`, 'g');

  for (const src of sources) {
    if (isBuildArtifactPath(src.path)) continue;
    // Cheap gate: the sanitizer is the expensive part, and a file naming none
    // of these members cannot contribute.
    if (!WHOLE_ENUM_MEMBERS.some(m => src.text.includes(m)) && !src.text.includes('::')
      && !REIFIED_ENUM_FNS.some(m => src.text.includes(m))) continue;
    const clean = sanitizeForUsageScan(src.text);
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(clean)) !== null) if (enumNames.has(m[1])) walked.add(m[1]);
    reified.lastIndex = 0;
    while ((m = reified.exec(clean)) !== null) if (enumNames.has(m[1])) walked.add(m[1]);
  }
  for (const name of findDeserializedEnums(enumNames, sources)) walked.add(name);
  return walked;
}

/**
 * Enums that come back from JSON or the database by name: the type of a field
 * of a DTO (suffix or serialization annotation, same test as KJ-044) or an
 * enum named in a file with a Room `@TypeConverter`. Gson and Moshi map
 * such an enum without any annotation, so no entry name ever appears in code,
 * and deleting one turns a payload into a null or an exception.
 */
const ROOM_ANNOTATIONS = new Set(['Entity', 'Embedded', 'ColumnInfo', 'Fts4', 'DatabaseView']);

function findDeserializedEnums(enumNames: ReadonlySet<string>, sources: readonly SymbolSource[]): Set<string> {
  const out = new Set<string>();
  for (const src of sources) {
    if (!/\.(kt|java)$/.test(src.path)) continue;
    if (isBuildArtifactPath(src.path)) continue;
    let mentions = false;
    for (const n of enumNames) if (src.text.includes(n)) { mentions = true; break; }
    if (!mentions) continue;
    if (src.text.includes('@TypeConverter')) {
      for (const n of enumNames) if (new RegExp(`\\b${n}\\b`).test(src.text)) out.add(n);
      continue;
    }
    const isJava = src.path.endsWith('.java');
    const parsed = isJava ? parseJava(src.path, src.text) : parse(src.path, src.text);
    const clean = sanitizeForUsageScan(src.text);
    const lineStarts = buildLineStarts(clean);
    const annotations = collectAnnotationTargets(clean);
    const lines = src.text.split('\n');
    const syms = parsed.symbols;
    for (let i = 0; i < syms.length; i++) {
      const cls = syms[i];
      if (!DTO_CLASS_KINDS.has(cls.kind) || cls.kind === 'enum') continue;
      const lo = lineStarts[cls.line];
      const hi = lo + cls.character;
      // Room maps an enum column by name (2.3+), no TypeConverter needed:
      // an `@Entity` reads its enum back from rows already stored.
      const serialized = DTO_NAME_RE.test(cls.name)
        || annotations.some(a => a.target >= lo && a.target <= hi
          && (SERIALIZATION_ANNOTATIONS.has(a.name) || ROOM_ANNOTATIONS.has(a.name)));
      if (!serialized) continue;
      for (let j = i + 1; j < syms.length && syms[j].depth > cls.depth; j++) {
        const f = syms[j];
        if ((f.kind !== 'val' && f.kind !== 'var') || f.depth !== cls.depth + 1) continue;
        const line = lines[f.line] ?? '';
        const typeText = isJava
          ? line.slice(0, f.character)
          : (/^\w+\s*:\s*([^=,)]+)/.exec(line.slice(f.character))?.[1] ?? '');
        for (const t of typeText.match(/[A-Z]\w*/g) ?? []) if (enumNames.has(t)) out.add(t);
      }
    }
  }
  return out;
}

/**
 * Where the entry ENDS: past its argument list and past its body, if it has
 * either. -1 when either cannot be closed.
 */
function finDeLEntree(clean: string, nameEnd: number): number {
  let i = nameEnd;
  while (i < clean.length && (clean[i] === ' ' || clean[i] === '\t')) i++;
  if (clean[i] === '(') {
    const close = findMatchingParen(clean, i);
    if (close === -1) return -1;
    i = close + 1;
    while (i < clean.length && (clean[i] === ' ' || clean[i] === '\t')) i++;
  }
  if (clean[i] === '{') {
    const close = matchBrace(clean, i);
    if (close === -1) return -1;
    i = close + 1;
  }
  return i;
}

/**
 * The extent of one entry inside its list, comma included.
 *
 * An entry alone on its line takes the whole line, which is what this used to
 * do and all it used to do: `A, B, C` on one line, the shape Java enums take
 * for short lists, left every entry unremovable. Measured on
 * /Users/kevin/Desktop/work/lapresse, six of the nine remaining enum findings
 * were exactly that.
 *
 * The rule is the one a human applies: take the entry and ONE adjacent comma,
 * the following one when there is one, the preceding one for the last entry.
 * Anything the scan cannot close, an argument list or an entry body, yields -1
 * rather than a guess.
 */
/**
 * True when `avant` holds nothing but whitespace and complete annotations.
 *
 * `@Deprecated`, `@RequiresApi(26)`, `@Suppress("x", Y::class)`: the argument
 * list can nest, so the parens are counted rather than matched by a regex.
 */
function annotationsSeules(avant: string): boolean {
  let i = 0;
  while (i < avant.length) {
    while (i < avant.length && /\s/.test(avant[i])) i++;
    if (i >= avant.length) return true;
    if (avant[i] !== '@') return false;
    i++;
    while (i < avant.length && /[\w.]/.test(avant[i])) i++;
    while (i < avant.length && /\s/.test(avant[i])) i++;
    if (avant[i] === '(') {
      let p = 0;
      for (; i < avant.length; i++) {
        if (avant[i] === '(') p++;
        else if (avant[i] === ')' && --p === 0) { i++; break; }
      }
      if (p !== 0) return false;
    }
  }
  return true;
}

/**
 * The offset an entry's removal must start at: its OWN annotations included.
 *
 * The cut began at the entry's name, so a dead `@Deprecated OLD,` left its
 * `@Deprecated` standing. Kotlin and Java both bind a leading annotation to
 * the declaration that follows, which is the next entry: javac proves it, the
 * deprecation silently moves from the entry that left onto a live sibling.
 * When the dead entry is the LAST one and the list carries a trailing comma,
 * the annotation is left with nothing after it but `}` and the file stops
 * parsing outright.
 *
 * Only annotations are swallowed, and only while every character between them
 * and the name belongs to them: `ASC, @Deprecated DESC` backs up to the `@`,
 * never past the comma.
 */
function debutAvecAnnotations(
  clean: string,
  lineStarts: readonly number[],
  nameStart: number,
): number {
  const ligneDe = (o: number): number => {
    let bas = 0, haut = lineStarts.length - 1;
    while (bas < haut) {
      const m = Math.ceil((bas + haut) / 2);
      if (lineStarts[m] <= o) bas = m; else haut = m - 1;
    }
    return bas;
  };
  const ligne = ligneDe(nameStart);
  if (!annotationsSeules(clean.slice(lineStarts[ligne], nameStart))) return nameStart;
  let debut = lineStarts[ligne];
  // Puis les lignes AU DESSUS. C'est le BLOC entier jusqu'au nom qui doit ne
  // porter que des annotations, pas chaque ligne prise isolement : une
  // annotation etalee sur plusieurs lignes met un `)` seul juste au dessus de
  // l'entree, et `)` n'est une annotation pour personne. Tester ligne a ligne
  // arretait donc la remontee la, et l'annotation restait collee a l'entree
  // suivante, vivante. Sur la DERNIERE entree il ne restait apres elle qu'une
  // accolade fermante et le fichier cessait de parser.
  //
  // On continue donc a monter au dessus d'une ligne qui echoue seule, puisque
  // c'est une ligne plus haut qui ouvre l'annotation. Borne a vingt lignes :
  // au dela ce n'est plus un en-tete de declaration, et le bloc teste grandit
  // a chaque pas.
  for (let l = ligne - 1; l >= 0 && ligne - l <= 20; l--) {
    if (clean.slice(lineStarts[l], lineStarts[l + 1]).trim() === '') break;
    if (annotationsSeules(clean.slice(lineStarts[l], nameStart))) debut = lineStarts[l];
  }
  return debut;
}

/**
 * La meme fin, ramenee avant l ouverture d un commentaire de bloc qu elle
 * couperait en deux.
 *
 * Les blancs de la copie blanchie ne sont pas tous des blancs : un commentaire
 * y est efface a la meme longueur. La marche qui prend les espaces apres la
 * virgule traversait donc `/* on garde` et s arretait au retour a la ligne, en
 * laissant `as is *​/` seul derriere. Le fichier ne compilait plus.
 *
 * Reculer, et non etendre jusqu a la fermeture : l entree suivante peut
 * partager la ligne de cette fermeture, et elle est vivante.
 *
 * Le commentaire ferme sur la meme ligne ne bouge pas, lui : il parle de
 * l entree qui part, et il part avec elle comme avant.
 */
function sansTrancherUnBloc(
  text: string, sansCommentaires: () => string, depuis: number, fin: number,
): number {
  if (!coupeUnBloc(text, sansCommentaires, fin)) return fin;
  const i = debutDuBloc(text, sansCommentaires(), depuis, fin);
  return i === -1 ? fin : i;
}

function entryExtent(
  text: string,
  lineStarts: readonly number[],
  entry: RawSymbol,
  /** La copie du fichier sans ses commentaires, calculee au plus une fois. */
  sansCommentaires: () => string,
): { removeStart: number; removeEnd: number } {
  const debutLigne = lineStarts[entry.line];
  const finLigne = entry.line + 1 < lineStarts.length ? lineStarts[entry.line + 1] : text.length;
  const ligne = text.slice(debutLigne, finLigne);
  const alone = new RegExp(`^\\s*${entry.name}\\s*(?:\\([^)]*\\))?\\s*,\\s*$`);
  if (alone.test(ligne)) return { removeStart: debutLigne, removeEnd: finLigne };

  // Comments and string bodies are blanked, so a `//` after the entry cannot
  // be read as code and an argument holding a `,` cannot split the list.
  const clean = sanitizeForUsageScan(text);
  const nameStart = debutLigne + entry.character;
  if (clean.slice(nameStart, nameStart + entry.name.length) !== entry.name) {
    return { removeStart: -1, removeEnd: -1 };
  }
  const fin = finDeLEntree(clean, nameStart + entry.name.length);
  if (fin === -1) return { removeStart: -1, removeEnd: -1 };

  // A comma AFTER: the entry and that comma go, plus the spaces that followed
  // it on the same line so the neighbours do not end up glued.
  // Tout blanc, retours a la ligne compris : une liste se poursuit volontiers
  // a la ligne suivante, et la derniere entree est suivie d un `\n` avant son
  // `}`.
  let apres = fin;
  while (apres < clean.length && /\s/.test(clean[apres])) apres++;
  if (clean[apres] === ',') {
    let coupeFin = apres + 1;
    while (coupeFin < clean.length && (clean[coupeFin] === ' ' || clean[coupeFin] === '\t')) coupeFin++;
    return { removeStart: nameStart, removeEnd: sansTrancherUnBloc(text, sansCommentaires, apres, coupeFin) };
  }

  // No comma after: this is the last entry, so the comma BEFORE it goes with
  // it. `;` and `}` are the only things allowed to follow the list.
  if (clean[apres] !== ';' && clean[apres] !== '}' && apres < clean.length) {
    return { removeStart: -1, removeEnd: -1 };
  }
  let avant = nameStart - 1;
  while (avant >= 0 && /\s/.test(clean[avant])) avant--;
  if (clean[avant] !== ',') return { removeStart: -1, removeEnd: -1 };
  // `finDeLEntree` stops after the blanks of the line but before its newline,
  // so taking it whole glued the closing brace to the neighbour on a single
  // line list: `enum class E { VIVANT}`. Only that brace needs a blank kept,
  // and one is enough.
  //
  // Giving the whole run back instead was worse than the glue it cured. A
  // comment is blanked to spaces of the SAME LENGTH in `clean`, so the walk
  // climbed back over the entry's own `// no longer used` and returned it to
  // the file, where it reads as a note on the neighbour that survives. Trailing
  // spaces came back the same way, on a line the cut used to leave clean.
  //
  // The blank is read from the raw text, never from `clean`: a space there is
  // a space, not the tail of a comment we are supposed to be taking.
  //
  // This paragraph used to end by saying no shape could tell the two readings
  // apart, because an entry carrying a block comment on its line was not
  // detected at all. It is detected. The same confusion, one branch below,
  // walked forward over `/* keep` and stopped at the newline, leaving `as is
  // */` behind and the file no longer compiling.
  let finPropre = fin;
  if (clean[fin] === '}' && finPropre > nameStart
      && (text[finPropre - 1] === ' ' || text[finPropre - 1] === '\t')) finPropre--;
  return { removeStart: avant, removeEnd: finPropre };
}

/** Declarations of each entry name, over the corpus and file by file. */
interface EntryDeclarations {
  total: Map<string, number>;
  /**
   * The same, split by source set. The harvest files a declaration token under
   * the bag of its file: subtracting a test enum's declaration from the MAIN
   * mentions ate a real use, and a live entry sharing its name with an entry of
   * a test enum came out unreferenced.
   */
  inMain: Map<string, number>;
  inTest: Map<string, number>;
  /** `path` NUL `entry` -> declarations of that entry name in that file. */
  inFile: Map<string, number>;
  /** entry -> names of the enums declaring it. */
  enumsDeclaring: Map<string, Set<string>>;
}

function countDeclarations(enums: readonly EnumDecl[]): EntryDeclarations {
  const out: EntryDeclarations = { total: new Map(), inMain: new Map(), inTest: new Map(), inFile: new Map(), enumsDeclaring: new Map() };
  for (const e of enums) {
    const bySet = e.isTest ? out.inTest : out.inMain;
    for (const entry of e.entries) {
      out.total.set(entry.name, (out.total.get(entry.name) ?? 0) + 1);
      bySet.set(entry.name, (bySet.get(entry.name) ?? 0) + 1);
      const key = `${e.path}\0${entry.name}`;
      out.inFile.set(key, (out.inFile.get(key) ?? 0) + 1);
      (out.enumsDeclaring.get(entry.name) ?? out.enumsDeclaring.set(entry.name, new Set()).get(entry.name)!).add(e.name);
    }
  }
  return out;
}

/** Entry names declared by more than one enum: the harvest records where each is written. */
function homonymEntries(declarations: EntryDeclarations): Set<string> {
  return new Set([...declarations.total].filter(([, n]) => n > 1).map(([name]) => name));
}

/**
 * Mentions of `entry` that may designate the entry of `e`, when several enums
 * declare that name. Counting every mention of the name minus its declarations
 * kept all of them alive as soon as one was used: 318 entries on the reference
 * project, `MediaSource.FEED` among them while only `EventSource.FEED` and its
 * like were ever written.
 *
 * A mention belongs to `e` when qualified by its name, bare in its own file, or
 * bare in a Kotlin file importing that entry or all entries of `e`. Qualified
 * by another enum declaring the name, or bare in a Kotlin file importing the
 * entry of such an enum, it belongs elsewhere. Anything else is a doubt and
 * returns null, so the caller keeps counting every mention: bare in Java, where
 * a `switch` case never qualifies; bare in Kotlin with no import to explain it,
 * which context sensitive resolution may bind through the expected type; in a
 * string or a non code file; behind an unknown qualifier, a typealias or a call.
 */
function homonymEntryMentions(
  e: EnumDecl,
  entry: string,
  harvest: Harvest,
  declarations: EntryDeclarations,
  testSourceSets: readonly string[],
): { main: number; test: number; testElsewhere: number } | null {
  const dup = harvest.duplicates;
  if (!dup || dup.uncertain.has(entry) || harvest.aliased.has(entry)) return null;
  const others = declarations.enumsDeclaring.get(entry) ?? new Set<string>();
  const importsEntryOf = (imports: readonly string[], enumName: string) =>
    imports.some(i => `.${i}`.endsWith(`.${enumName}.${entry}`) || `.${i}`.endsWith(`.${enumName}.`));

  const counts = { main: 0, test: 0, testElsewhere: 0 };
  for (const mention of dup.byToken.get(entry) ?? []) {
    let ours = 0;
    let theirs = 0;
    for (const q of mention.qualifiers) {
      const last = q.slice(q.lastIndexOf('.') + 1);
      if (last === e.name) ours++;
      else if (others.has(last)) theirs++;
      else return null;
    }
    const bare = mention.bare - (declarations.inFile.get(`${mention.path}\0${entry}`) ?? 0);
    if (bare > 0) {
      if (mention.path === e.path) ours += bare;
      else if (!/\.kts?$/.test(mention.path)) return null;
      else if (importsEntryOf(mention.imports, e.name)) ours += bare;
      else if ([...others].some(o => importsEntryOf(mention.imports, o))) theirs += bare;
      else return null;
    }
    if (isTestSourceSet(mention.path, testSourceSets)) {
      counts.test += ours;
      counts.testElsewhere += theirs;
    } else {
      counts.main += ours;
    }
  }
  return counts;
}

export function findUnusedEnumEntries(input: UnusedEnumEntryScanInput): UnusedEnumEntry[] {
  if (input.truncated) return [];                                     // contract rule 2

  const enums = collectEnums(input.sources, input.testSourceSets);
  if (enums.length === 0) return [];

  const wanted = new Set<string>();
  for (const e of enums) for (const entry of e.entries) wanted.add(entry.name);
  // How many times each entry name is DECLARED across the corpus. A mention
  // count equal to that is a corpus that names it nowhere else, which is the
  // same reasoning KJ-036 applies to duplicated top-level names.
  const declarations = countDeclarations(enums);
  const harvest = harvestMentions(input.sources, wanted, input.testSourceSets, homonymEntries(declarations));

  const ignored = new Set(input.ignoreNames ?? []);
  const walked = findWalkedEnums(new Set(enums.map(e => e.name)), input.sources);
  const textByPath = new Map(input.sources.map(s => [s.path, s.text]));
  const out: UnusedEnumEntry[] = [];

  for (const e of enums) {
    if (e.rejection) continue;
    if (e.isTest) continue;                                           // E2: declared in tests
    if (ignored.has(e.name)) continue;
    if (walked.has(e.name)) continue;                                 // E1

    const text = textByPath.get(e.path);
    if (text === undefined) continue;
    const lineStarts = buildLineStarts(text);
    /** Une seule copie sans commentaires par fichier, et seulement si besoin. */
    let copieSc: string | undefined;
    const sansCommentaires = (): string => (copieSc ??= stripKotlinComments(text));

    for (const entry of e.entries) {
      if (ignored.has(`${e.name}.${entry.name}`)) continue;
      if (e.silenced.has(entry)) continue;
      const declared = declarations.total.get(entry.name) ?? 1;
      const resolved = declared > 1
        ? homonymEntryMentions(e, entry.name, harvest, declarations, input.testSourceSets)
        : null;
      const mainElsewhere = resolved ? resolved.main
        : (harvest.main.get(entry.name) ?? 0) - (declarations.inMain.get(entry.name) ?? 0);
      if (mainElsewhere !== 0) continue;

      const testMentions = resolved ? resolved.test
        : (harvest.test.get(entry.name) ?? 0) - (declarations.inTest.get(entry.name) ?? 0);
      const verdict: EnumEntryVerdict = testMentions > 0 ? 'testOnly' : 'unreferenced';
      if (verdict === 'testOnly' && input.includeTestOnly === false) continue;

      out.push({
        name: entry.name,
        enumName: e.name,
        verdict,
        path: e.path,
        line: entry.line,
        character: entry.character,
        testMentions,
        testsNameOnlyThisEntry: declared === 1 || (resolved !== null && resolved.testElsewhere === 0),
        ...avecAnnotations(text, lineStarts, entryExtent(text, lineStarts, entry, sansCommentaires)),
      });
    }
  }

  // Two neighbours claim the same comma: the one before it as its trailing
  // separator, the one after it as its leading one. Applied one at a time by a
  // lightbulb that is harmless, applied together it ate the closing brace of
  // `enum SortOrder { ASC, DESC }` when both entries were dead. The later
  // extent yields the overlap.
  const parFichier = new Map<string, UnusedEnumEntry[]>();
  for (const e of out) {
    if (e.removeStart < 0) continue;
    (parFichier.get(e.path) ?? parFichier.set(e.path, []).get(e.path)!).push(e);
  }
  for (const liste of parFichier.values()) {
    liste.sort((a, b) => a.removeStart - b.removeStart);
    for (let i = 1; i < liste.length; i++) {
      const precedent = liste[i - 1];
      const courant = liste[i];
      if (courant.removeStart < precedent.removeEnd) {
        courant.removeStart = precedent.removeEnd;
        if (courant.removeEnd <= courant.removeStart) {
          courant.removeStart = -1;
          courant.removeEnd = -1;
        }
      }
    }
  }

  return out.sort((a, b) => a.path.localeCompare(b.path) || a.line - b.line);
}

export function explainEnumEntries(input: UnusedEnumEntryScanInput): EnumEntryExplanation[] {
  const enums = collectEnums(input.sources, input.testSourceSets);
  const wanted = new Set<string>();
  for (const e of enums) for (const entry of e.entries) wanted.add(entry.name);
  const declarations = countDeclarations(enums);
  const harvest = harvestMentions(input.sources, wanted, input.testSourceSets, homonymEntries(declarations));

  const walkedEnums = findWalkedEnums(new Set(enums.map(e => e.name)), input.sources);
  const out: EnumEntryExplanation[] = [];
  for (const e of enums) {
    const walked = !e.rejection && !e.isTest && walkedEnums.has(e.name);
    for (const entry of e.entries) {
      const declared = declarations.total.get(entry.name) ?? 1;
      const resolved = declared > 1
        ? homonymEntryMentions(e, entry.name, harvest, declarations, input.testSourceSets)
        : null;
      const mainElsewhere = resolved ? resolved.main
        : (harvest.main.get(entry.name) ?? 0) - (declarations.inMain.get(entry.name) ?? 0);
      const testMentions = resolved ? resolved.test
        : (harvest.test.get(entry.name) ?? 0) - (declarations.inTest.get(entry.name) ?? 0);
      const outcome = e.rejection ? e.rejection
        : e.silenced.has(entry) ? 'F12:suppress-unused'
        : e.isTest ? 'E2:test-source-set'
          : walked ? 'E1:walked-as-whole'
            : mainElsewhere !== 0 ? 'alive:main'
              : testMentions > 0 ? 'testOnly' : 'unreferenced';
      out.push({ name: entry.name, enumName: e.name, path: e.path, line: entry.line, outcome });
    }
  }
  return out;
}

export function messageFor(entry: UnusedEnumEntry): string {
  if (entry.verdict === 'testOnly') {
    const n = entry.testMentions;
    return `Enum entry '${entry.enumName}.${entry.name}' is used only from tests (${n} reference${n > 1 ? 's' : ''})`;
  }
  return `Enum entry '${entry.enumName}.${entry.name}' is never referenced anywhere in this workspace`;
}

export function deleteTitleFor(entry: UnusedEnumEntry): string {
  return `Delete unreferenced enum entry ${entry.name}`;
}

/** Offsets used by `offsetToPos` in the provider shell. */
export { offsetToPos };

/** `entryExtent` widened so the entry's own annotations leave with it. */
function avecAnnotations(
  text: string,
  lineStarts: readonly number[],
  extent: { removeStart: number; removeEnd: number },
): { removeStart: number; removeEnd: number } {
  if (extent.removeStart < 0) return extent;
  const clean = sanitizeForUsageScan(text);
  return { ...extent, removeStart: debutAvecAnnotations(clean, lineStarts, extent.removeStart) };
}
