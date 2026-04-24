// Auto-link demo webps to What's New highlights.
//
// Inputs are provided through pure-function parameters so this module is
// directly unit-testable without hitting git or the filesystem. The
// .publish script wires the real git/fs readers; tests inject mocks.
//
// Design notes:
//   - Tokens = lowercased alphanumeric sequences ≥ 3 chars, minus
//     stopwords. Hyphens/underscores are token separators.
//   - Scoring = Jaccard of title+description tokens vs. demo name+docblock
//     tokens. Range [0, 1].
//   - Threshold: 0.15 — chosen empirically. 0.10 starts false-positive
//     matches (generic demos stealing specific highlights); 0.20 misses
//     reasonable single-token overlaps (e.g. "suppress-hover" vs "Suppress
//     explained on hover" when description is short).
//   - Determinism: when multiple demos score equally, the one whose NAME
//     sorts first wins. Keeps auto-link stable across publish runs.

export const STOPWORDS = new Set([
  'the', 'and', 'for', 'with', 'from', 'that', 'this', 'new', 'into',
  'your', 'out', 'get', 'has', 'have', 'via', 'but', 'now', 'any',
  'are', 'was', 'will', 'were', 'demo', 'kotlin', 'jump',
]);

export const DEFAULT_THRESHOLD = 0.15;
export const MIN_TOKEN_LENGTH  = 3;

/** Lowercase alphanumeric tokens ≥ `MIN_TOKEN_LENGTH`, excluding stopwords.
 *  Never throws — coerces non-strings via `String(...)`. */
export function tokenize(s, { stopwords = STOPWORDS, minLen = MIN_TOKEN_LENGTH } = {}) {
  return new Set(
    String(s ?? '')
      .toLowerCase()
      .replace(/[^\w\s-]/g, ' ')
      .split(/[\s\-_]+/)
      .filter(t => t.length >= minLen)
      .filter(t => !stopwords.has(t)),
  );
}

/** Jaccard similarity between two Sets of strings. Empty sets → 0. */
export function jaccard(a, b) {
  if (!a || !b) return 0;
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  const union = new Set([...a, ...b]).size;
  return inter / union;
}

/** Build the token set for a single demo. Combines the name and (if
 *  available) the JSDoc comment from the `.demo.ts` file. A `readDemoDoc`
 *  that throws (e.g. disk error, deleted file) is treated as "no doc"
 *  so a single corrupt demo does not abort the whole release pipeline. */
export function demoTokenSet(name, { readDemoDoc } = {}) {
  const tokens = tokenize(name);
  if (readDemoDoc) {
    let doc = '';
    try { doc = readDemoDoc(name) ?? ''; } catch { doc = ''; }
    if (doc) for (const t of tokenize(doc)) tokens.add(t);
  }
  return tokens;
}

/** Extract the leading JSDoc comment text from a demo source string. */
export function extractDemoDoc(src) {
  if (typeof src !== 'string') return '';
  const m = src.match(/\/\*\*([\s\S]*?)\*\//);
  return m ? m[1] : '';
}

/** Pick the best-matching demo for a highlight. Returns null if no demo
 *  clears the threshold or all demos are already used. */
export function findBestMatch(
  highlight,
  demoTokensByName,
  usedDemos = new Set(),
  { threshold = DEFAULT_THRESHOLD } = {},
) {
  const titleTokens = new Set([
    ...tokenize(highlight?.title ?? ''),
    ...tokenize(highlight?.description ?? ''),
  ]);
  if (titleTokens.size === 0) return null;

  // Iterate in sorted order so ties are deterministic across runs.
  const demos = [...demoTokensByName.keys()].sort();
  let best = null;
  for (const name of demos) {
    if (usedDemos.has(name)) continue;
    const score = jaccard(titleTokens, demoTokensByName.get(name));
    if (score >= threshold && (!best || score > best.score)) {
      best = { name, score };
    }
  }
  return best;
}

/** Run the auto-link pass across all highlights + demos. Mutates each
 *  highlight in place to add `media` / `mediaAlt` when a match is
 *  found. Returns a report describing every decision for logging. */
export function autoLinkHighlights(
  highlights,
  demoNames,
  { readDemoDoc, threshold = DEFAULT_THRESHOLD } = {},
) {
  const report = { linked: [], orphaned: [], preassigned: [] };

  // Even when highlights is empty/null, we still want to tell the
  // maintainer "hey, you recorded demos that will have nowhere to land".
  // Compute demo tokens unconditionally so the orphan list is honest.
  const demoTokensByName = new Map(
    (Array.isArray(demoNames) ? demoNames : []).map(n => [n, demoTokenSet(n, { readDemoDoc })]),
  );

  if (!Array.isArray(highlights)) {
    // Null/undefined highlights: every demo is orphaned (nothing consumed them).
    for (const name of demoTokensByName.keys()) report.orphaned.push({ name });
    return report;
  }

  const usedDemos = new Set();
  for (const h of highlights) {
    if (h && h.media) {
      const base = String(h.media).replace(/\.webp$/, '');
      usedDemos.add(base);
      report.preassigned.push({ title: h.title, name: base, source: 'explicit' });
    }
  }

  for (const h of highlights) {
    if (!h || h.media) continue;
    const best = findBestMatch(h, demoTokensByName, usedDemos, { threshold });
    if (!best) continue;
    h.media    = `${best.name}.webp`;
    h.mediaAlt = h.title || h.mediaAlt;
    usedDemos.add(best.name);
    report.linked.push({ title: h.title, name: best.name, score: best.score });
  }

  for (const name of demoTokensByName.keys()) {
    if (!usedDemos.has(name)) report.orphaned.push({ name });
  }

  return report;
}
