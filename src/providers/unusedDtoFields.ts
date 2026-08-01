import { parse } from '../indexer/KotlinParser';
import {
  buildLineStarts,
  collectAnnotationTargets,
  findMatchingParen,
  sanitizeForUsageScan,
  splitParamSegments,
} from '../util/kotlinScan';
import { isTestSourceSet } from '../util/testPaths';
import { isBuildArtifactPath, isGeneratedSource } from '../util/resourceAllowlists';
import { harvestMentions, SymbolSource } from './unusedSymbols';

/**
 * KJ-044: DTO fields the app receives but never reads.
 *
 * A field of a deserialized model that no line of the project reads is data
 * the app pays to parse and then drops. Removing it is safe on the READ side
 * by construction: JSON libraries ignore unknown keys.
 *
 * ## Why this is not KJ-042
 *
 * The member detector excludes primary-constructor properties entirely (M7),
 * because `component1()` reads them without ever spelling their name. That
 * exclusion is exactly where DTO fields live, so this detector reopens that
 * population UNDER STRICTER CONditions: only classes that are visibly wire
 * contracts, and only when nothing in the corpus can be destructuring them.
 *
 * Measured before building: 59 unread fields on a 6410 file workspace, 41 of
 * them in one hand-written config model. The comparable tool's version of this
 * rule was unusable noise because generated OpenAPI models dominated it; the
 * generated-source guard removes those wholesale.
 *
 * Kotlin only in v1: the measured population is `data class` constructors.
 */

export interface UnusedDtoFieldScanInput {
  sources: readonly SymbolSource[];
  testSourceSets: readonly string[];
  /** An incomplete corpus cannot prove absence, so it produces nothing. */
  truncated?: boolean;
  /** `Class` or `Class.field` names never reported. */
  ignoreNames?: readonly string[];
  includeTestOnly?: boolean;
}

export type DtoFieldVerdict = 'unreferenced' | 'testOnly';

export interface UnusedDtoField {
  name: string;
  className: string;
  verdict: DtoFieldVerdict;
  path: string;
  line: number;
  character: number;
  /**
   * Extent of the constructor parameter segment (separator included), or -1:
   * the class is constructed positionally somewhere, and removing the
   * parameter would silently shift every later argument.
   */
  removeStart: number;
  removeEnd: number;
  testMentions: number;
}

/** One line per candidate field, for `--why`. */
export interface DtoFieldExplanation {
  name: string;
  className: string;
  path: string;
  line: number;
  outcome: string;
}

const IGNORE_MARKER = 'kotlin-jump:ignore unused-dto-field';

/** Suffixes that mark a class as a wire contract by convention. */
const DTO_NAME_RE = /(?:DO|DTO|Response|Request|Payload|Entity)$/;

/** Annotations that mark a class or a field as serialized. */
const SERIALIZATION_ANNOTATIONS = new Set([
  'Serializable', 'SerializedName', 'Json', 'JsonClass', 'JsonProperty', 'SerialName',
]);

/**
 * Field-level annotations that do not change reachability. Anything else on a
 * field (Room's `@PrimaryKey`, a validator, an unknown library) means unknown
 * semantics, and the field is left alone.
 */
const BENIGN_FIELD_ANNOTATIONS = new Set([
  ...SERIALIZATION_ANNOTATIONS, 'Suppress', 'JvmField', 'Deprecated',
]);

interface FieldCandidate {
  name: string;
  className: string;
  path: string;
  line: number;
  character: number;
  /** 1-based rank in the primary constructor: the componentN it feeds. */
  position: number;
  removeStart: number;
  removeEnd: number;
  /** Guard that took it out, or null. */
  rejection: string | null;
}

/** Every DTO field of the corpus, with per-class guards resolved. */
export function collectDtoFields(
  sources: readonly SymbolSource[],
  testSourceSets: readonly string[],
): { candidates: FieldCandidate[]; classNames: Set<string> } {
  const candidates: FieldCandidate[] = [];
  const classNames = new Set<string>();

  for (const src of sources) {
    if (!src.path.endsWith('.kt')) continue;
    if (isBuildArtifactPath(src.path)) continue;
    if (isGeneratedSource(src.text)) continue;                        // the OpenAPI killer
    if (isTestSourceSet(src.path, testSourceSets)) continue;
    if (src.text.includes(IGNORE_MARKER)) continue;

    const parsed = parse(src.path, src.text);
    const clean = sanitizeForUsageScan(src.text);
    const lineStarts = buildLineStarts(clean);
    const annotations = collectAnnotationTargets(clean);

    for (const cls of parsed.symbols) {
      if (cls.kind !== 'dataClass' && cls.kind !== 'class') continue;

      const lo = lineStarts[cls.line];
      const hi = lo + cls.character;
      const classAnnos = annotations
        .filter(a => a.target >= lo && a.target <= hi)
        .map(a => a.name);

      // Primary-constructor params sit at the CLASS's own brace depth: parens
      // do not increment it. `isPrimaryCtorParam` plus the line window binds
      // them to their class.
      const fields = parsed.symbols.filter(f =>
        f.isPrimaryCtorParam
        && (f.kind === 'val' || f.kind === 'var')
        && (f.depth === cls.depth || f.depth === cls.depth + 1)
        && f.line >= cls.line);
      // Fields between this class and the next same-depth declaration only.
      const nextClass = parsed.symbols.find(n =>
        n !== cls && n.depth <= cls.depth && n.line > cls.line
        && (n.kind === 'class' || n.kind === 'dataClass' || n.kind === 'object' || n.kind === 'interface'));
      const ownFields = fields.filter(f => nextClass === undefined || f.line < nextClass.line);
      if (ownFields.length === 0) continue;

      const fieldAnnosOf = (f: typeof ownFields[number]) => {
        const flo = lineStarts[f.line];
        const fhi = flo + f.character;
        return annotations.filter(a => a.target >= flo && a.target <= fhi).map(a => a.name);
      };

      // A wire contract announces itself: by name, or by a serialization
      // annotation on the class or any of its fields.
      const isDto = DTO_NAME_RE.test(cls.name)
        || classAnnos.some(a => SERIALIZATION_ANNOTATIONS.has(a))
        || ownFields.some(f => fieldAnnosOf(f).some(a => SERIALIZATION_ANNOTATIONS.has(a)));
      if (!isDto) continue;

      classNames.add(cls.name);
      const classRejection = classAnnos.some(a =>
        !SERIALIZATION_ANNOTATIONS.has(a) && !BENIGN_FIELD_ANNOTATIONS.has(a))
        ? `D2:@${classAnnos.find(a => !SERIALIZATION_ANNOTATIONS.has(a) && !BENIGN_FIELD_ANNOTATIONS.has(a))}`
        : null;

      // The removal extent needs the parameter list.
      const nameOffset = lineStarts[cls.line] + cls.character;
      const parenIdx = clean.indexOf('(', nameOffset);
      const closeIdx = parenIdx === -1 ? -1 : findMatchingParen(clean, parenIdx);
      const segments = closeIdx === -1 ? [] : splitParamSegments(clean, parenIdx + 1, closeIdx, src.text);

      for (const [fieldIndex, f] of ownFields.entries()) {
        const fieldAnnos = fieldAnnosOf(f);
        const foreign = fieldAnnos.find(a => !BENIGN_FIELD_ANNOTATIONS.has(a));

        // The segment holding this field, widened over its leading separator.
        const fOffset = lineStarts[f.line] + f.character;
        const segIndex = segments.findIndex(sg => fOffset >= sg.start && fOffset < sg.end);
        let removeStart = -1;
        let removeEnd = -1;
        if (segIndex !== -1) {
          removeStart = segIndex === 0 ? segments[0].start : segments[segIndex - 1].end + 1;
          removeEnd = segIndex === segments.length - 1
            ? segments[segIndex].end
            : segments[segIndex].end + 1;
          if (segIndex === 0 && segments.length > 1) removeEnd = segments[1].start;
        }

        candidates.push({
          name: f.name,
          className: cls.name,
          path: src.path,
          line: f.line,
          character: f.character,
          position: fieldIndex + 1,
          removeStart,
          removeEnd,
          rejection: classRejection
            ?? (f.isPrivate ? 'D3:private' : null)
            ?? (foreign ? `D4:@${foreign}` : null),
        });
      }
    }
  }

  return { candidates, classNames };
}

export function findUnusedDtoFields(input: UnusedDtoFieldScanInput): UnusedDtoField[] {
  if (input.truncated) return [];                                     // contract rule 2

  const { candidates, classNames } = collectDtoFields(input.sources, input.testSourceSets);
  if (candidates.length === 0) return [];

  const wanted = new Set<string>();
  for (const c of candidates) wanted.add(c.name);
  for (const n of classNames) wanted.add(n);
  const harvest = harvestMentions(input.sources, wanted, input.testSourceSets);

  // D1, the destructuring guard: `val (a, b) = dto` reads fields without ever
  // spelling them. Undetectable per field, but bounded: an arity-2
  // destructuring only calls component1..component2, so in any file that BOTH
  // mentions the class and destructures, only positions up to the largest
  // observed arity are unprovable.
  const destructuredArity = destructuringGuard(input.sources, classNames);

  // D5: a positional construction (`Config(a, b)`) breaks if a parameter goes
  // away, so the fix is withdrawn while the verdict stands. Constructed-by-
  // library classes have no such site.
  const constructedClasses = constructionGuard(input.sources, classNames);

  const declCount = new Map<string, number>();
  for (const c of candidates) declCount.set(c.name, (declCount.get(c.name) ?? 0) + 1);

  const ignored = new Set(input.ignoreNames ?? []);
  const out: UnusedDtoField[] = [];
  for (const c of candidates) {
    if (c.rejection) continue;
    const reachableArity = destructuredArity.get(c.className);
    if (reachableArity !== undefined && c.position <= reachableArity) continue; // D1
    if (harvest.aliased.has(c.name)) continue;                        // H10
    if (ignored.has(c.className) || ignored.has(`${c.className}.${c.name}`)) continue;

    // Every mention beyond the declarations themselves keeps every bearer
    // alive: the field name in another DTO, a local, an XML attribute.
    const mainMentions = harvest.main.get(c.name) ?? 0;
    if (mainMentions !== (declCount.get(c.name) ?? 0)) continue;

    const testMentions = harvest.test.get(c.name) ?? 0;
    const verdict: DtoFieldVerdict = testMentions > 0 ? 'testOnly' : 'unreferenced';
    if (verdict === 'testOnly' && input.includeTestOnly === false) continue;

    out.push({
      name: c.name,
      className: c.className,
      verdict,
      path: c.path,
      line: c.line,
      character: c.character,
      removeStart: constructedClasses.has(c.className) ? -1 : c.removeStart,
      removeEnd: constructedClasses.has(c.className) ? -1 : c.removeEnd,
      testMentions,
    });
  }

  return out.sort((a, b) => a.path.localeCompare(b.path) || a.line - b.line);
}

/**
 * Largest componentN each class can be read at via destructuring (D1): the
 * maximum arity over every destructuring in files that also mention the class.
 */
function destructuringGuard(
  sources: readonly SymbolSource[],
  classNames: ReadonlySet<string>,
): Map<string, number> {
  const out = new Map<string, number>();
  for (const src of sources) {
    if (!/\.(kt|kts)$/.test(src.path)) continue;
    if (isBuildArtifactPath(src.path)) continue;
    if (!/\bva[lr]\s*\(/.test(src.text) && !src.text.includes('->')) continue;
    const clean = sanitizeForUsageScan(src.text);
    const arity = maxDestructuringArity(clean);
    if (arity === 0) continue;
    for (const name of classNames) {
      if (new RegExp(`(?<![A-Za-z0-9_])${name}(?![A-Za-z0-9_])`).test(clean)) {
        out.set(name, Math.max(out.get(name) ?? 0, arity));
      }
    }
  }
  return out;
}

/**
 * Highest componentN any destructuring in this text can call: `val (a, b)`
 * declarations and lambda parameter lists `{ (a, b) -> …`. Commas inside
 * nested generics inflate the count, which only widens the guard — a false
 * negative, never a false positive.
 */
function maxDestructuringArity(clean: string): number {
  let max = 0;
  let m: RegExpExecArray | null;
  const declRe = /\bva[lr]\s*\(/g;
  while ((m = declRe.exec(clean)) !== null) {
    max = Math.max(max, arityAt(clean, m.index + m[0].length - 1));
  }
  const lambdaRe = /(?<=[{,])\s*\(/g;
  while ((m = lambdaRe.exec(clean)) !== null) {
    const open = m.index + m[0].length - 1;
    const close = findMatchingParen(clean, open);
    if (close === -1) continue;
    // Only a parameter list that flows into `->` destructures.
    if (!/^[^(){}=;]*->/.test(clean.slice(close + 1, close + 80))) continue;
    // A lone Capitalized identifier is a function type's parameter, not names.
    if (/^\s*[A-Z][A-Za-z0-9_]*\s*$/.test(clean.slice(open + 1, close))) continue;
    max = Math.max(max, arityAt(clean, open));
  }
  return max;
}

/** Number of top-level segments of the paren group opening at openIdx. */
function arityAt(clean: string, openIdx: number): number {
  const close = findMatchingParen(clean, openIdx);
  if (close === -1) return 0;
  let depth = 0;
  let count = 1;
  for (let i = openIdx + 1; i < close; i++) {
    const ch = clean[i];
    if (ch === '(') depth++;
    else if (ch === ')') depth--;
    else if (ch === ',' && depth === 0) count++;
  }
  return count;
}

/** Classes constructed by hand anywhere: their parameters cannot be removed (D5). */
function constructionGuard(
  sources: readonly SymbolSource[],
  classNames: ReadonlySet<string>,
): Set<string> {
  const out = new Set<string>();
  for (const src of sources) {
    if (!/\.(kt|kts|java)$/.test(src.path)) continue;
    if (isBuildArtifactPath(src.path)) continue;
    const clean = sanitizeForUsageScan(src.text);
    for (const name of classNames) {
      const re = new RegExp(`(?<![A-Za-z0-9_.])(?:new\\s+)?${name}\\s*\\(`, 'g');
      let m: RegExpExecArray | null;
      while ((m = re.exec(clean)) !== null) {
        // The declaration itself (`data class Name(`) is not a construction.
        const before = clean.slice(Math.max(0, m.index - 40), m.index);
        if (/\bclass\s*$/.test(before)) continue;
        out.add(name);
        break;
      }
    }
  }
  return out;
}

export function explainDtoFields(input: UnusedDtoFieldScanInput): DtoFieldExplanation[] {
  const { candidates, classNames } = collectDtoFields(input.sources, input.testSourceSets);
  const wanted = new Set<string>();
  for (const c of candidates) wanted.add(c.name);
  const harvest = harvestMentions(input.sources, wanted, input.testSourceSets);
  const destructured = destructuringGuard(input.sources, classNames);
  const declCount = new Map<string, number>();
  for (const c of candidates) declCount.set(c.name, (declCount.get(c.name) ?? 0) + 1);

  return candidates.map(c => {
    const mainMentions = harvest.main.get(c.name) ?? 0;
    const arity = destructured.get(c.className);
    const outcome = c.rejection ? c.rejection
      : arity !== undefined && c.position <= arity ? `D1:destructured-arity-${arity}`
        : harvest.aliased.has(c.name) ? 'H10:aliased-import'
          : mainMentions !== (declCount.get(c.name) ?? 0) ? 'alive:main'
            : (harvest.test.get(c.name) ?? 0) > 0 ? 'testOnly' : 'unreferenced';
    return { name: c.name, className: c.className, path: c.path, line: c.line, outcome };
  });
}

export function messageFor(f: UnusedDtoField): string {
  if (f.verdict === 'testOnly') {
    return `DTO field '${f.className}.${f.name}' is read only from tests (${f.testMentions} reference${f.testMentions > 1 ? 's' : ''})`;
  }
  return `DTO field '${f.className}.${f.name}' is deserialized but never read anywhere in this workspace`;
}

export function deleteTitleFor(f: UnusedDtoField): string {
  return `Delete unread DTO field ${f.name}`;
}
