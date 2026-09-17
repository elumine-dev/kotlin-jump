import { findUnheardEvents, unprovenPostExtent, UnheardEventScanInput } from './unheardEvents';
import { buildLineStarts, sanitizeForUsageScan } from '../util/kotlinScan';

/**
 * KJ-061: the posts of an unheard event that the safe removal refused.
 *
 * `findUnheardEvents` proves an event has no subscriber, then refuses to cut
 * a post whose removal is not obviously safe: an argument that calls
 * something, a post alone in a branch whose chain does other things. The
 * refusal is right for a command that applies without a reader. On the
 * reference project it kept one event alive through a single post,
 *
 *   BusProvider.getInstance().post(ApplicationOpenedByExternalLinkEvent(newsletterSourceUrl.decode(), SOURCE_NEWSLETTER))
 *
 * where `decode()` is a Base64 helper with no side effect, which a textual
 * scan cannot know. The human removed it, then the event class, then the
 * constant it carried, then twenty nine lines of tests.
 *
 * This lists those posts with their whole statement and the reason they were
 * refused, for the review command that shows every box unticked. Nothing
 * here removes anything: the reason travels on the label, and the reader who
 * knows `decode()` is pure ticks the box. Once the post is gone, the class
 * and its tests are what the next round finds on its own.
 */

export interface RefusedPost {
  /** Event simple name, what the label shows. */
  name: string;
  path: string;
  /** 0-based position of the `post` token. */
  line: number;
  character: number;
  /** Whole-line extent of the statement, guards ignored. */
  start: number;
  end: number;
  /** The guard that refused it, as `findUnheardEvents` wrote it. */
  reason: string;
}

export function findRefusedPosts(input: UnheardEventScanInput): RefusedPost[] {
  const scan = findUnheardEvents(input);
  // An unreadable subscription means the scan proved nothing; offering a
  // post then would offer the removal of a message someone may still hear.
  if (scan.unreadable.length > 0) return [];

  const textByPath = new Map(input.sources.map(s => [s.path, s.text]));
  const cleanCache = new Map<string, { clean: string; lineStarts: number[] }>();
  const out: RefusedPost[] = [];
  for (const e of scan.events) {
    if (e.verdict !== 'unheard' || e.removeStart >= 0 || !e.withheld) continue;
    const raw = textByPath.get(e.path);
    if (raw === undefined) continue;
    let cached = cleanCache.get(e.path);
    if (!cached) {
      const clean = sanitizeForUsageScan(raw);
      cached = { clean, lineStarts: buildLineStarts(clean) as number[] };
      cleanCache.set(e.path, cached);
    }
    const { clean, lineStarts } = cached;
    const postIdx = (lineStarts[e.line] ?? 0) + e.character;
    // `post` then its parenthesis, balanced on the sanitized text.
    let i = postIdx;
    while (i < clean.length && /\w/.test(clean[i])) i++;
    while (i < clean.length && /\s/.test(clean[i])) i++;
    if (clean[i] !== '(') continue;
    const openIdx = i;
    let depth = 0;
    let closeIdx = -1;
    for (let k = openIdx; k < clean.length; k++) {
      if (clean[k] === '(') depth++;
      else if (clean[k] === ')' && --depth === 0) { closeIdx = k; break; }
    }
    if (closeIdx < 0) continue;
    const ext = unprovenPostExtent(raw, clean, lineStarts, postIdx, openIdx, closeIdx);
    if (ext.start < 0 || ext.end <= ext.start) continue;
    out.push({ name: e.name, path: e.path, line: e.line, character: e.character, start: ext.start, end: ext.end, reason: e.withheld });
  }
  return out.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : a.line - b.line));
}
