import { isBuildArtifactPath, isGeneratedSource } from '../util/resourceAllowlists';
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

function matchesGlob(name: string, pattern: string): boolean {
  const re = new RegExp('^' + pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '.*') + '$');
  return re.test(name);
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
    ENTRY_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = ENTRY_RE.exec(src.text)) !== null) {
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

  const out: RemoteConfigKeyExplanation[] = [];
  for (const [name, declarations] of byKey) {
    const n = mentions.get(name) ?? 0;
    const outcome = ignored.some(p => matchesGlob(name, p)) ? 'R3:ignored-name'
      : n > 0 ? `alive:${n}` : 'unreferenced';
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
