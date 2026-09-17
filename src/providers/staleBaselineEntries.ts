import { plural } from '../util/plural';

/**
 * KJ-059: a detekt baseline entry whose file no longer exists.
 *
 * A baseline is a list of issues the team agreed to live with, one `<ID>` per
 * issue, keyed by rule, file name and signature:
 *
 *   <ID>MayBeConst:AnalyticsPageModelImpl.kt$AnalyticsPageModelImpl.Companion$private val SEPARATOR = "/"</ID>
 *
 * When the file goes, the entry stays: detekt never complains about an
 * issue it cannot find, so nothing ever points at the line. On the reference
 * project the hand written branch removed four such entries, one for each
 * file it deleted, and left three older ones behind whose files had been
 * gone for longer.
 *
 * ONLY the file test is used. An entry whose file exists but whose signature
 * text no longer matches is not reported: detekt normalises signatures in
 * ways a textual comparison cannot reproduce, and a wrong removal here makes
 * a lint task fail on the next run, which is a broken build by another name.
 * A file name is matched by its simple name, as detekt writes it, so a
 * homonymous file anywhere in the corpus keeps the entry.
 *
 * The removal runs inside the fixed point loop, so an entry for a file the
 * same plan deletes becomes stale on the following round, with no coupling
 * between the two families.
 */

export interface StaleBaselineEntry {
  /** The baseline file. */
  path: string;
  /** 0-based line of the `<ID>` element. */
  line: number;
  /** The file name the entry names, `AnalyticsPageModelImpl.kt`. */
  file: string;
  /** The rule, for the label. */
  rule: string;
  /** Whole-line extent, so the removal leaves no blank line behind. */
  removeStart: number;
  removeEnd: number;
}

export interface StaleBaselineScanInput {
  sources: readonly { path: string; text: string }[];
  /** An incomplete corpus cannot prove a file is gone. */
  truncated?: boolean;
}

const BASELINE_RE = /[\\/]baseline\.xml$/;
const ENTRY_RE = /^([ \t]*)<ID>([A-Za-z][\w]*):([^:$<]+\.(?:kt|kts|java))\$/;

/** True for a detekt baseline: the root element says so. */
function isDetektBaseline(text: string): boolean {
  return /<SmellBaseline\b/.test(text);
}

export function findStaleBaselineEntries(input: StaleBaselineScanInput): StaleBaselineEntry[] {
  if (input.truncated) return [];

  const baselines = input.sources.filter(s => BASELINE_RE.test(s.path) && isDetektBaseline(s.text));
  if (baselines.length === 0) return [];

  // Every simple file name of the corpus, once. Built lazily: a project with
  // no baseline pays nothing.
  const present = new Set<string>();
  for (const s of input.sources) {
    const slash = Math.max(s.path.lastIndexOf('/'), s.path.lastIndexOf('\\'));
    present.add(s.path.slice(slash + 1));
  }

  const out: StaleBaselineEntry[] = [];
  for (const b of baselines) {
    const lines = b.text.split('\n');
    let offset = 0;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const m = ENTRY_RE.exec(line);
      if (m && !present.has(m[3])) {
        out.push({
          path: b.path,
          line: i,
          file: m[3],
          rule: m[2],
          removeStart: offset,
          removeEnd: i + 1 < lines.length ? offset + line.length + 1 : b.text.length,
        });
      }
      offset += line.length + 1;
    }
  }
  return out;
}

/** The one line a report ends on. Exported for the witness. */
export function staleBaselineSummary(entries: readonly StaleBaselineEntry[]): string {
  if (entries.length === 0) return 'No stale baseline entry: every file a baseline names still exists.';
  const files = new Set(entries.map(e => e.file)).size;
  return `${plural(entries.length, 'stale baseline entry', 'stale baseline entries')} for ${plural(files, 'file')} that no longer exist.`;
}
