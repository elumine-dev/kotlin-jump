import { matchesGlob } from '../util/glob';
import { isBuildArtifactPath, isGeneratedSource } from '../util/resourceAllowlists';
import { stripXmlComments } from '../util/xmlRefs';
import { harvestMentions, SymbolSource } from './unusedSymbols';

/**
 * KJ-040: Remote Config keys declared in the defaults file that nothing reads.
 *
 * A default only ever matters when the client asks for that key. So a key
 * sitting in `remote_config_defaults.xml` that no line of the project names is
 * dead WITHOUT having to ask the Firebase console anything: whatever the server
 * holds for it, this app never looks.
 *
 * That is what makes this checkable at all. Asking "is this key still served?"
 * needs a network call and a credential; asking "does this app still read it?"
 * needs only the workspace, and it is the question that decides whether the
 * declaration can go.
 *
 * ## Why detection is structural, not by file name
 *
 * `remote_config_defaults.xml` is a convention, not a rule: the file is passed
 * to `setDefaultsAsync(R.xml.<anything>)`. Matching the SHAPE (`<defaults>`
 * holding `<entry><key>`) covers a project that named it otherwise, and cannot
 * mistake an unrelated `res/xml` file for one.
 *
 * ## The build-variant trap
 *
 * The same key is normally declared once per variant: `main`, `debug` and
 * `release` each carry their own copy. On one workspace that is 333
 * declarations for 92 distinct keys. Reporting per declaration turns 28 dead
 * keys into 84 lines saying nearly the same thing, so findings are grouped by
 * KEY and carry every place it is declared.
 */

export interface RemoteConfigKeyScanInput {
  sources: readonly SymbolSource[];
  /** An incomplete corpus cannot prove absence, so it produces nothing. */
  truncated?: boolean;
  /** Key names, globs allowed, never reported. */
  ignoreNames?: readonly string[];
}

export interface RemoteConfigKeyDeclaration {
  path: string;
  /** 0-based line of the `<key>` element. */
  line: number;
  character: number;
  /** Offsets of the whole `<entry>` element, so a fix removes it as a unit. */
  removeStart: number;
  removeEnd: number;
}

export interface UnusedRemoteConfigKey {
  name: string;
  /** Every file declaring it: one per build variant, normally. */
  declarations: RemoteConfigKeyDeclaration[];
}

/** One line per declared key, saying what happened to it. For `--why`. */
export interface RemoteConfigKeyExplanation {
  name: string;
  path: string;
  line: number;
  outcome: string;
}

const IGNORE_MARKER = 'kotlin-jump:ignore unused-remote-config-key';

/**
 * Where the whole map is taken: `remoteConfig.all`, `rc.getAll()`,
 * `FirebaseRemoteConfig.getInstance().all`.
 *
 * Taking the map is not yet reading every key. A lookup table takes it and
 * then asks for one key at a time, which leaves every other key unread.
 */
const TAKES_THE_WHOLE_MAP =
  /\b(?:\w*[Rr]emote[Cc]onfig\w*|rc|config)\s*(?:\.\s*\w+\s*(?:\(\s*\))?\s*){0,2}\.\s*(?:all\b|getAll\s*\(\s*\))/g;

/** What turns the map back into a single key: `[key]`, `.getValue(key)`, `.get(key)`. */
const ASKS_FOR_ONE_KEY = /^\s*(?:\?\s*)?(?:\[|\.\s*(?:getValue|getOrDefault|getOrElse|get)\s*\()/;

/**
 * A `getAll()` the workspace declares itself.
 *
 * Calling it proves nothing: its body is in the corpus and is judged on its
 * own `.all`. Without this, the enum-bounded projection of
 * `RemoteConfigurationService.getAll()` silenced the detector from every one
 * of its call sites, on top of its declaration.
 */
const DECLARES_GET_ALL =
  /\bfun\s+getAll\s*\(|^[^\n]*\b(?:public|protected|private|abstract|static|final)\b[^\n]*\bgetAll\s*\(/m;

/** `<entry>` blocks with a `<key>`, held by a `<defaults>` root. */
const ENTRY_RE = /<entry\b[^>]*>([\s\S]*?)<\/entry\s*>/g;
const KEY_RE = /<key\s*>\s*([^<\s][^<]*?)\s*<\/key\s*>/;

/**
 * True when this file is a Remote Config defaults file, judged on shape.
 *
 * A `<defaults>` root holding `<entry>` elements with a `<key>` is the format
 * `setDefaultsAsync` reads, and nothing else in an Android project uses it.
 */
export function isRemoteConfigDefaults(path: string, text: string): boolean {
  if (!/\.xml$/i.test(path)) return false;
  if (!/[\\/]res[\\/]xml[^\\/]*[\\/]/.test(path)) return false;
  return /<defaults\s*>/.test(text) && /<key\s*>/.test(text);
}


function lineStartsOf(text: string): number[] {
  const starts = [0];
  for (let i = 0; i < text.length; i++) if (text[i] === '\n') starts.push(i + 1);
  return starts;
}

function posAt(starts: readonly number[], offset: number): { line: number; character: number } {
  let lo = 0;
  let hi = starts.length - 1;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (starts[mid] <= offset) lo = mid;
    else hi = mid - 1;
  }
  return { line: lo, character: offset - starts[lo] };
}

/**
 * Widens an `<entry>` extent to whole lines when nothing else shares them, so
 * removing one leaves no ragged blank line behind.
 */
function wholeLines(text: string, start: number, end: number): { start: number; end: number } {
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
 * The name a `val`/`var` binds this site to, when the site is the whole of its
 * initialiser: `val allValues = remoteConfig.all`.
 */
function boundName(text: string, siteStart: number): string | null {
  const before = text.slice(Math.max(0, siteStart - 160), siteStart);
  const m = /(?:\bva[lr]\s+)?([A-Za-z_]\w*)\s*(?::\s*[^=\n]*)?=\s*$/.exec(before);
  return m ? m[1] : null;
}

/**
 * True when this site only ever asks for keys it names.
 *
 * Two shapes, both observed on one workspace:
 *
 *   remoteConfig.all.getValue(it)            asked on the spot
 *   val allValues = remoteConfig.all         bound, then asked further down
 *   ... allValues[it.key]?.asString()
 */
function onlyAsksForNamedKeys(text: string, siteStart: number, siteEnd: number): boolean {
  if (ASKS_FOR_ONE_KEY.test(text.slice(siteEnd, siteEnd + 48))) return true;

  const name = boundName(text, siteStart);
  if (!name) return false;

  const rest = text.slice(siteEnd);
  const uses = new RegExp(`\\b${name}\\b`, 'g');
  let seen = 0;
  let u: RegExpExecArray | null;
  while ((u = uses.exec(rest)) !== null) {
    seen++;
    const after = u.index + name.length;
    if (!ASKS_FOR_ONE_KEY.test(rest.slice(after, after + 48))) return false;
  }
  return seen > 0;
}

/**
 * The file that reads every key without naming one, or null.
 *
 * Exported because `find` and `explain` must answer the same question: a
 * detector whose two outputs contradict each other cannot have its guards
 * measured.
 */
export function fileReadingEveryKey(sources: readonly SymbolSource[]): string | null {
  const code = sources.filter(s => /\.(kt|java)$/.test(s.path) && !isBuildArtifactPath(s.path));
  const getAllIsOurs = code.some(
    s => /[Rr]emote\s*[Cc]onfig/.test(s.text) && DECLARES_GET_ALL.test(s.text),
  );

  for (const src of code) {
    // The marker says this file's sweep is not a reason to blind the family:
    // an admin screen that dumps every value is a mirror, not a consumer.
    if (src.text.includes(IGNORE_MARKER)) continue;

    TAKES_THE_WHOLE_MAP.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = TAKES_THE_WHOLE_MAP.exec(src.text)) !== null) {
      if (getAllIsOurs && /getAll/.test(m[0])) continue;
      if (onlyAsksForNamedKeys(src.text, m.index, m.index + m[0].length)) continue;
      return src.path;
    }
  }
  return null;
}

/** Every key declared in every defaults file of the corpus. */
export function collectRemoteConfigKeys(
  sources: readonly SymbolSource[],
): Map<string, RemoteConfigKeyDeclaration[]> {
  const byKey = new Map<string, RemoteConfigKeyDeclaration[]>();

  for (const src of sources) {
    if (isBuildArtifactPath(src.path)) continue;
    if (!isRemoteConfigDefaults(src.path, src.text)) continue;
    if (isGeneratedSource(src.text)) continue;
    if (src.text.includes(IGNORE_MARKER)) continue;

    const starts = lineStartsOf(src.text);
    // A commented-out `<entry>` is not a declaration; offsets are preserved.
    const live = stripXmlComments(src.text);
    ENTRY_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = ENTRY_RE.exec(live)) !== null) {
      const key = KEY_RE.exec(m[1]);
      if (!key) continue;
      const keyOffset = m.index + m[0].indexOf(key[0]) + key[0].indexOf(key[1]);
      const extent = wholeLines(src.text, m.index, m.index + m[0].length);
      const list = byKey.get(key[1]) ?? [];
      list.push({
        path: src.path,
        ...posAt(starts, keyOffset),
        removeStart: extent.start,
        removeEnd: extent.end,
      });
      byKey.set(key[1], list);
    }
  }

  return byKey;
}

/**
 * Mentions of each key anywhere OTHER than a defaults file.
 *
 * The defaults files are removed from the corpus first, so a key does not keep
 * itself alive through its own declaration, nor through the copy a sibling
 * build variant carries.
 */
function mentionsOutsideDefaults(
  sources: readonly SymbolSource[],
  keys: ReadonlySet<string>,
): Map<string, number> {
  const outside = sources.filter(s => !isRemoteConfigDefaults(s.path, s.text));
  const harvest = harvestMentions(outside, keys, []);
  // Test sources count as a reference: a key read only by a test is still
  // read, and no removal keeps that test compiling. The harvest still splits
  // the two bags by Gradle convention, so both are added back together here.
  const total = new Map(harvest.main);
  for (const [name, n] of harvest.test) total.set(name, (total.get(name) ?? 0) + n);
  return total;
}

/**
 * The shared harvest skips `.json`, because R8 writes every name of the build
 * into one and reading it would mark the whole project alive. A hand-written
 * JSON naming a key is therefore invisible here. Documented rather than worked
 * around: diverging from the family's idea of a mention would be worse.
 */

export function findUnusedRemoteConfigKeys(
  input: RemoteConfigKeyScanInput,
): UnusedRemoteConfigKey[] {
  if (input.truncated) return [];                                     // contract rule 2

  const byKey = collectRemoteConfigKeys(input.sources);
  if (byKey.size === 0) return [];

  // Iterating `remoteConfig.all` reaches every key without naming one, so no
  // key can be proven unread. A lookup table does not: see `fileReadingEveryKey`.
  if (fileReadingEveryKey(input.sources) !== null) return [];

  const mentions = mentionsOutsideDefaults(input.sources, new Set(byKey.keys()));
  const ignored = input.ignoreNames ?? [];

  const out: UnusedRemoteConfigKey[] = [];
  for (const [name, declarations] of byKey) {
    if ((mentions.get(name) ?? 0) > 0) continue;
    if (ignored.some(p => matchesGlob(name, p))) continue;
    out.push({ name, declarations });
  }

  return out.sort((a, b) => a.name.localeCompare(b.name));
}

export function explainRemoteConfigKeys(
  input: RemoteConfigKeyScanInput,
): RemoteConfigKeyExplanation[] {
  const byKey = collectRemoteConfigKeys(input.sources);
  const mentions = mentionsOutsideDefaults(input.sources, new Set(byKey.keys()));
  const ignored = input.ignoreNames ?? [];
  // The two bail-outs of `find`, modelled here too: an outcome of
  // `unreferenced` must mean the key IS reported, or `--why` explains a
  // finding that never comes.
  const truncated = input.truncated === true;
  const sweeper = truncated ? null : fileReadingEveryKey(input.sources);

  const out: RemoteConfigKeyExplanation[] = [];
  for (const [name, declarations] of byKey) {
    const n = mentions.get(name) ?? 0;
    const outcome = truncated ? 'R0:truncated-corpus'
      : ignored.some(p => matchesGlob(name, p)) ? 'R3:ignored-name'
      : n > 0 ? `alive:${n}`
      : sweeper !== null ? `R4:every-key-read:${sweeper}`
      : 'unreferenced';
    for (const d of declarations) out.push({ name, path: d.path, line: d.line, outcome });
  }
  return out;
}

export function messageFor(key: UnusedRemoteConfigKey): string {
  const n = key.declarations.length;
  const variants = n > 1 ? `, declared in ${n} variants` : '';
  return `Remote Config key '${key.name}' is never read anywhere in this workspace${variants}`;
}

export function deleteTitleFor(key: UnusedRemoteConfigKey): string {
  const n = key.declarations.length;
  return n > 1
    ? `Delete '${key.name}' from all ${n} defaults files`
    : `Delete unread Remote Config key ${key.name}`;
}
