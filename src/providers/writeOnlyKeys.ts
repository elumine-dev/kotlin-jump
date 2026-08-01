import { sanitizeForUsageScan } from '../util/kotlinScan';
import { isTestSourceSet } from '../util/testPaths';
import { isBuildArtifactPath, isGeneratedSource } from '../util/resourceAllowlists';
import { SymbolSource } from './unusedSymbols';

/**
 * KJ-045: keys written and never read, in three small places.
 *
 *   - an Intent extra put and never gotten: data silently lost in transit
 *   - a SharedPreferences key put and never gotten: state saved for nobody
 *   - a manifest permission nothing in the code exercises
 *
 * These are BUGS more than dead weight: someone wrote the producing half of a
 * hand-off and the consuming half never existed or went away. Measured before
 * building: 2 + 3 + 1 findings on a 6410 file workspace. Small on purpose;
 * each mechanism carries its own poison rule.
 *
 * ## The poison rule, per category
 *
 * A write with an unresolvable key only loses a candidate: dropped silently.
 * A READ with an unresolvable key could be reading anything, so it poisons its
 * whole category, mirroring every proof-side rule in the family.
 */

export interface WriteOnlyKeyScanInput {
  sources: readonly SymbolSource[];
  /** An incomplete corpus cannot prove absence, so it produces nothing. */
  truncated?: boolean;
  testSourceSets: readonly string[];
  ignoreNames?: readonly string[];
}

export type WriteOnlyKind = 'intentExtra' | 'preferenceKey' | 'permission';

export interface WriteOnlyKey {
  kind: WriteOnlyKind;
  /** The key as the wire sees it (the string value when resolvable). */
  key: string;
  path: string;
  line: number;
  character: number;
}

export interface WriteOnlyKeyScan {
  findings: WriteOnlyKey[];
  /** Categories that proved nothing, with the site that blocked each. */
  poisoned: { kind: WriteOnlyKind; path: string; line: number }[];
}

const IGNORE_MARKER = 'kotlin-jump:ignore write-only-key';

/**
 * Extras owned by the platform or another app: the reader is not our code by
 * design (the share sheet, the calendar, the settings screen).
 */
const SDK_EXTRA_OWNERS =
  /\b(?:Intent|Settings|CalendarContract|Events|AppWidgetManager|BatteryManager|Notification|MediaStore|AlarmClock|SearchManager|Telephony)\s*\.\s*EXTRA_/;

/**
 * Permissions that are complete with their declaration alone: normal-level,
 * never requested at runtime, exercised implicitly by the framework.
 */
const SELF_CONTAINED_PERMISSIONS = new Set([
  'INTERNET', 'ACCESS_NETWORK_STATE', 'ACCESS_WIFI_STATE', 'VIBRATE', 'WAKE_LOCK',
  'FOREGROUND_SERVICE', 'RECEIVE_INTERNET', 'DISABLE_KEYGUARD',
]);
const SELF_CONTAINED_PERMISSION_PREFIXES = ['FOREGROUND_SERVICE_'];

const WRITE_EXTRA_RE = /\bputExtra\s*\(\s*([^,)]+)/g;
/** `bundleOf("k" to v)` writes too; navigation args read them off-name. */
const BUNDLE_OF_RE = /\bbundleOf\s*\(\s*([^,)]+?)\s+to\b/g;

const WRITE_PREF_RE = /\.\s*put(?:String|Boolean|Int|Long|Float|StringSet)\s*\(\s*([^,)]+)/g;
/**
 * READS are deliberately generous: any `get*`/`has*` call whose first argument
 * resolves to a string counts as reading that key, whatever the receiver.
 * Over-counting reads only loses findings. `getString(R.string.x)` resolves to
 * nothing and is not a key read, so it neither counts nor poisons.
 */
const GENERIC_READ_RE = /\b(?:get\w+|has[A-Z]\w*)\s*\(\s*([^,)]+)/g;
/** Reads that clearly address a key-value store: these poison when unresolvable. */
const EXTRA_READ_RE = /\b(?:get\w+Extra|hasExtra)\s*\(\s*([^,)]+)/g;

/**
 * Resolves a key argument to its literal value: a string literal in place, or
 * a constant declared IN THE SAME FILE. Anything else is unresolvable, and
 * what that means depends on which side of the hand-off it sits.
 */
function resolveKey(
  raw: string,
  arg: string,
  constTable: ReadonlyMap<string, string[]>,
): string[] | undefined {
  const trimmed = arg.trim();
  const literal = /^"([^"]*)"$/.exec(trimmed);
  if (literal) return [literal[1]];

  const constName = /^(?:[A-Za-z_][\w.]*\.)?([A-Z][A-Z0-9_]*)$/.exec(trimmed);
  if (constName) {
    // The declaring file first, then the corpus-wide table: the key constant
    // very often lives next to the READER, not the writer.
    const decl = new RegExp(
      `\\b${constName[1]}\\s*(?::\\s*String)?\\s*=\\s*"([^"]*)"`).exec(raw)
      ?? new RegExp(`String\\s+${constName[1]}\\s*=\\s*"([^"]*)"`).exec(raw);
    if (decl) return [decl[1]];
    const global = constTable.get(constName[1]);
    if (global && global.length > 0) return global;
  }
  return undefined;
}

/** Every SCREAMING string constant of the corpus, name -> its values. */
function collectStringConstants(sources: readonly SymbolSource[]): Map<string, string[]> {
  const out = new Map<string, string[]>();
  const re = /\b([A-Z][A-Z0-9_]{2,})\s*(?::\s*String)?\s*=\s*"([^"]*)"/g;
  for (const src of sources) {
    if (!/\.(kt|kts|java)$/.test(src.path)) continue;
    if (isBuildArtifactPath(src.path)) continue;
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(src.text)) !== null) {
      const list = out.get(m[1]) ?? [];
      if (!list.includes(m[2])) list.push(m[2]);
      out.set(m[1], list);
    }
  }
  return out;
}

export function findWriteOnlyKeys(input: WriteOnlyKeyScanInput): WriteOnlyKeyScan {
  const empty: WriteOnlyKeyScan = { findings: [], poisoned: [] };
  if (input.truncated) return empty;                                  // contract rule 2

  interface Site { key: string; path: string; line: number; character: number }
  const writes: Record<'intentExtra' | 'preferenceKey', Site[]> = { intentExtra: [], preferenceKey: [] };
  const readKeys = new Set<string>();
  const poisoned: WriteOnlyKeyScan['poisoned'] = [];

  const lineOf = (text: string, offset: number): number => {
    let line = 0;
    for (let i = 0; i < offset; i++) if (text[i] === '\n') line++;
    return line;
  };
  const constTable = collectStringConstants(input.sources);

  for (const src of input.sources) {
    if (!/\.(kt|kts|java)$/.test(src.path)) continue;
    if (isBuildArtifactPath(src.path) || isGeneratedSource(src.text)) continue;
    if (src.text.includes(IGNORE_MARKER)) continue;
    const isTest = isTestSourceSet(src.path, input.testSourceSets);
    const clean = sanitizeForUsageScan(src.text);

    const argOf = (m: RegExpExecArray): string =>
      src.text.slice(m.index, m.index + m[0].length).replace(/^[^(]*\(\s*/, '');

    // Generous read pass: every resolvable get/has key, whatever the receiver.
    GENERIC_READ_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = GENERIC_READ_RE.exec(clean)) !== null) {
      const keys = resolveKey(src.text, argOf(m), constTable);
      // A read resolves generously: every value an ambiguous constant can
      // hold counts as read.
      if (keys) for (const k of keys) readKeys.add(k);
    }

    // Poison pass, scoped to calls that unambiguously read a key-value store.
    EXTRA_READ_RE.lastIndex = 0;
    while ((m = EXTRA_READ_RE.exec(clean)) !== null) {
      const arg = argOf(m).trim();
      if (SDK_EXTRA_OWNERS.test(arg) || /^R\./.test(arg)) continue;
      if (resolveKey(src.text, arg, constTable) === undefined) {
        poisoned.push({ kind: 'intentExtra', path: src.path, line: lineOf(src.text, m.index) });
      }
    }
    const prefReadRe = /\.\s*get(?:String|Boolean|Int|Long|Float|StringSet)\s*\(\s*([^,)]+)/g;
    while ((m = prefReadRe.exec(clean)) !== null) {
      const before = clean.slice(Math.max(0, m.index - 60), m.index + 1);
      if (!/(?:pref|Pref|editor|Editor)\w*\s*[\n\s]*\.$/.test(before.trimEnd().slice(0, -0))
        && !/(?:pref|Pref|editor|Editor)/.test(before)) continue;
      const arg = argOf(m).trim();
      if (/^R\./.test(arg)) continue;
      if (resolveKey(src.text, arg, constTable) === undefined) {
        poisoned.push({ kind: 'preferenceKey', path: src.path, line: lineOf(src.text, m.index) });
      }
    }

    if (isTest) continue;   // a test write satisfies nothing and claims nothing

    const harvestWrites = (kind: 'intentExtra' | 'preferenceKey', re: RegExp) => {
      re.lastIndex = 0;
      let w: RegExpExecArray | null;
      while ((w = re.exec(clean)) !== null) {
        const arg = argOf(w);
        const context = src.text.slice(Math.max(0, w.index - 10), w.index + w[0].length + 20);
        if (kind === 'intentExtra' && SDK_EXTRA_OWNERS.test(context)) continue;
        if (kind === 'intentExtra' && /^"android\./.test(arg.trim())) continue;
        if (kind === 'preferenceKey'
          && !/(?:pref|Pref|editor|Editor)/.test(clean.slice(Math.max(0, w.index - 60), w.index))) continue;
        const keys = resolveKey(src.text, arg, constTable);
        // A write with an AMBIGUOUS constant would claim the wrong key: drop.
        if (keys === undefined || keys.length !== 1) continue;
        writes[kind].push({ key: keys[0], path: src.path, line: lineOf(src.text, w.index), character: 0 });
      }
    };
    harvestWrites('intentExtra', WRITE_EXTRA_RE);
    harvestWrites('intentExtra', BUNDLE_OF_RE);
    harvestWrites('preferenceKey', WRITE_PREF_RE);
  }

  const ignored = new Set(input.ignoreNames ?? []);
  const findings: WriteOnlyKey[] = [];
  for (const kind of ['intentExtra', 'preferenceKey'] as const) {
    if (poisoned.some(p => p.kind === kind)) continue;
    const seen = new Set<string>();
    for (const site of writes[kind]) {
      if (readKeys.has(site.key)) continue;
      if (ignored.has(site.key)) continue;
      if (seen.has(`${site.key}@${site.path}:${site.line}`)) continue;
      seen.add(`${site.key}@${site.path}:${site.line}`);
      findings.push({ kind, key: site.key, path: site.path, line: site.line, character: site.character });
    }
  }

  findings.push(...findUnusedPermissions(input, ignored));
  findings.sort((a, b) => a.path.localeCompare(b.path) || a.line - b.line);
  return { findings, poisoned };
}

/** Permissions declared in a MAIN manifest that no line of code exercises. */
function findUnusedPermissions(
  input: WriteOnlyKeyScanInput,
  ignored: ReadonlySet<string>,
): WriteOnlyKey[] {
  const declared: { short: string; full: string; path: string; line: number }[] = [];
  for (const src of input.sources) {
    if (!/AndroidManifest\.xml$/.test(src.path)) continue;
    // Only main manifests: a debug or androidTest manifest declares tooling
    // permissions that rightly never appear in application code.
    if (!/[\\/]src[\\/]main[\\/]/.test(src.path)) continue;
    if (isBuildArtifactPath(src.path)) continue;
    const lines = src.text.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const m = /<uses-permission[^>]*android:name="([^"]+)"/.exec(lines[i]);
      if (!m) continue;
      const short = m[1].split('.').pop()!;
      declared.push({ short, full: m[1], path: src.path, line: i });
    }
  }
  if (declared.length === 0) return [];

  // One pass over the code for all the short names at once.
  const mentioned = new Set<string>();
  for (const src of input.sources) {
    if (!/\.(kt|kts|java)$/.test(src.path)) continue;
    if (isBuildArtifactPath(src.path)) continue;
    for (const d of declared) {
      if (mentioned.has(d.short)) continue;
      if (src.text.includes(d.short) || src.text.includes(d.full)) mentioned.add(d.short);
    }
  }

  const out: WriteOnlyKey[] = [];
  const reported = new Set<string>();
  for (const d of declared) {
    if (SELF_CONTAINED_PERMISSIONS.has(d.short)) continue;
    if (SELF_CONTAINED_PERMISSION_PREFIXES.some(p => d.short.startsWith(p))) continue;
    if (mentioned.has(d.short)) continue;
    if (ignored.has(d.short) || ignored.has(d.full)) continue;
    if (reported.has(d.full)) continue;
    reported.add(d.full);
    out.push({ kind: 'permission', key: d.full, path: d.path, line: d.line, character: 0 });
  }
  return out;
}

export function messageFor(f: WriteOnlyKey): string {
  switch (f.kind) {
    case 'intentExtra':
      return `Intent extra '${f.key}' is written here and never read: the data is silently lost`;
    case 'preferenceKey':
      return `Preference key '${f.key}' is written here and never read back`;
    default:
      return `Permission '${f.key}' is declared but nothing in the code exercises it`;
  }
}
