import { parse, RawSymbol } from '../indexer/KotlinParser';
import { parseJava } from '../indexer/JavaParser';
import {
  FILE_SUPPRESS_RE,
  UNUSED_DECLARATION,
  buildLineStarts,
  collectAnnotationTargets,
  offsetToPos,
  sanitizeForUsageScan,
  suppressesDiagnostic,
} from '../util/kotlinScan';
import { isTestSourceSet } from '../util/testPaths';
import { isBuildArtifactPath, isGeneratedSource } from '../util/resourceAllowlists';
import { harvestMentions, SymbolSource } from './unusedSymbols';

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
const WHOLE_ENUM_MEMBERS = ['values', 'entries', 'valueOf', 'enumValueOf'];

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

    const fileSuppress = FILE_SUPPRESS_RE.exec(src.text);
    if (fileSuppress && suppressesDiagnostic(fileSuppress[1], UNUSED_DECLARATION)) continue;
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
        rejection: foreign ? `E3:@${foreign}` : annotatedEntry ? 'E5:annotated-entry' : null,
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

  for (const src of sources) {
    if (isBuildArtifactPath(src.path)) continue;
    // Cheap gate: the sanitizer is the expensive part, and a file naming none
    // of these members cannot contribute.
    if (!WHOLE_ENUM_MEMBERS.some(m => src.text.includes(m)) && !src.text.includes('::')) continue;
    const clean = sanitizeForUsageScan(src.text);
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(clean)) !== null) if (enumNames.has(m[1])) walked.add(m[1]);
  }
  return walked;
}

/** Whole-line extent when the entry sits alone on its line, -1 otherwise. */
function entryExtent(
  text: string,
  lineStarts: readonly number[],
  entry: RawSymbol,
): { removeStart: number; removeEnd: number } {
  const start = lineStarts[entry.line];
  const end = entry.line + 1 < lineStarts.length ? lineStarts[entry.line + 1] : text.length;
  const line = text.slice(start, end);
  // `ALLOW,` or `ALLOW(1),` alone. Anything else (two entries on a line, a
  // trailing `;` starting the member section, a comment) is left to the user.
  const alone = new RegExp(`^\\s*${entry.name}\\s*(?:\\([^)]*\\))?\\s*,\\s*$`);
  return alone.test(line) ? { removeStart: start, removeEnd: end } : { removeStart: -1, removeEnd: -1 };
}

export function findUnusedEnumEntries(input: UnusedEnumEntryScanInput): UnusedEnumEntry[] {
  if (input.truncated) return [];                                     // contract rule 2

  const enums = collectEnums(input.sources, input.testSourceSets);
  if (enums.length === 0) return [];

  const wanted = new Set<string>();
  for (const e of enums) for (const entry of e.entries) wanted.add(entry.name);
  const harvest = harvestMentions(input.sources, wanted, input.testSourceSets);

  // How many times each entry name is DECLARED across the corpus. A mention
  // count equal to that is a corpus that names it nowhere else, which is the
  // same reasoning KJ-036 applies to duplicated top-level names.
  const declaredCount = new Map<string, number>();
  for (const e of enums) {
    for (const entry of e.entries) {
      declaredCount.set(entry.name, (declaredCount.get(entry.name) ?? 0) + 1);
    }
  }

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

    for (const entry of e.entries) {
      if (ignored.has(`${e.name}.${entry.name}`)) continue;
      const declared = declaredCount.get(entry.name) ?? 1;
      const mainElsewhere = (harvest.main.get(entry.name) ?? 0) - declared;
      if (mainElsewhere !== 0) continue;

      const testMentions = harvest.test.get(entry.name) ?? 0;
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
        ...entryExtent(text, lineStarts, entry),
      });
    }
  }

  return out.sort((a, b) => a.path.localeCompare(b.path) || a.line - b.line);
}

export function explainEnumEntries(input: UnusedEnumEntryScanInput): EnumEntryExplanation[] {
  const enums = collectEnums(input.sources, input.testSourceSets);
  const wanted = new Set<string>();
  for (const e of enums) for (const entry of e.entries) wanted.add(entry.name);
  const harvest = harvestMentions(input.sources, wanted, input.testSourceSets);

  const declaredCount = new Map<string, number>();
  for (const e of enums) {
    for (const entry of e.entries) {
      declaredCount.set(entry.name, (declaredCount.get(entry.name) ?? 0) + 1);
    }
  }

  const walkedEnums = findWalkedEnums(new Set(enums.map(e => e.name)), input.sources);
  const out: EnumEntryExplanation[] = [];
  for (const e of enums) {
    const walked = !e.rejection && !e.isTest && walkedEnums.has(e.name);
    for (const entry of e.entries) {
      const declared = declaredCount.get(entry.name) ?? 1;
      const mainElsewhere = (harvest.main.get(entry.name) ?? 0) - declared;
      const outcome = e.rejection ? e.rejection
        : e.isTest ? 'E2:test-source-set'
          : walked ? 'E1:walked-as-whole'
            : mainElsewhere !== 0 ? 'alive:main'
              : (harvest.test.get(entry.name) ?? 0) > 0 ? 'testOnly' : 'unreferenced';
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
