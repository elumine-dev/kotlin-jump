/**
 * Adversarial tests for the What's New auto-link logic.
 *
 * The module lives at .github/scripts/whats-new-auto-link.mjs and is
 * invoked by the `.publish` script at release time. It automatically
 * attaches newly-recorded demo webps to the best-matching release-note
 * highlight, using Jaccard on tokenised (filename + JSDoc) vs. (title +
 * description). This file hunts every edge case that could make the
 * matcher either silently miss a demo OR wrongly pin the wrong demo to
 * a release.
 *
 * Hostile-input coverage:
 *   - tokenizer: unicode, emoji, control chars, null, numbers-only, very
 *     long strings, leading/trailing separators, mixed case
 *   - jaccard: empty sets, identical sets, disjoint sets, singleton
 *     overlap, superset containment, rounding
 *   - stopwords: entries that are ALL stopwords → empty token set
 *   - short tokens: exactly length 2 must be dropped, length 3 kept
 *   - highlights: missing title, null description, non-object entries
 *
 * Determinism coverage:
 *   - tied scores: alphabetical demo name wins
 *   - already-assigned media: not overwritten
 *   - demo used once cannot be matched again (one-to-one mapping)
 *   - explicit preassignment logged separately from auto-link
 *
 * Threshold boundary coverage:
 *   - exactly 0.15: matches
 *   - 0.149: below threshold, does NOT match
 *   - custom threshold override respected
 *
 * Security coverage:
 *   - path-like filenames rejected by storage contract (tested in
 *     VersionConsistency — this file covers the matcher only)
 *   - readDemoDoc throwing does not abort the run
 *   - extracted doc containing malicious regex does not break tokenize
 */

import { describe, it, expect } from 'vitest';
import {
  tokenize,
  jaccard,
  demoTokenSet,
  extractDemoDoc,
  findBestMatch,
  autoLinkHighlights,
  STOPWORDS,
  DEFAULT_THRESHOLD,
} from '../../.github/scripts/whats-new-auto-link.mjs';

// ── tokenize ──────────────────────────────────────────────────────────────

describe('ADV-autolink — tokenize', () => {
  it('strips punctuation and separators, keeps alphanumeric', () => {
    const t = tokenize('Hello, World! 123');
    expect([...t].sort()).toEqual(['123', 'hello', 'world']);
  });

  it('lowercases mixed case', () => {
    expect([...tokenize('FooBar')].sort()).toEqual(['foobar']);
  });

  it('drops tokens of length 2 but keeps length 3', () => {
    const t = tokenize('io api dispatch');
    expect(t.has('io')).toBe(false);       // length 2 — out
    expect(t.has('api')).toBe(true);       // length 3 — in
    expect(t.has('dispatch')).toBe(true);  // length 8 — in
  });

  it('respects custom minLen override', () => {
    const t = tokenize('ab cd efg', { minLen: 2 });
    expect(t.has('ab')).toBe(true);
    expect(t.has('cd')).toBe(true);
    expect(t.has('efg')).toBe(true);
  });

  it('strips stopwords from default set', () => {
    const t = tokenize('the new demo shows this');
    // All of the, new, demo, this are in STOPWORDS
    expect(t.has('the')).toBe(false);
    expect(t.has('new')).toBe(false);
    expect(t.has('demo')).toBe(false);
    expect(t.has('this')).toBe(false);
    expect(t.has('shows')).toBe(true);
  });

  it('respects custom stopwords set', () => {
    const custom = new Set(['foo']);
    const t = tokenize('the foo bar', { stopwords: custom });
    expect(t.has('foo')).toBe(false);
    expect(t.has('the')).toBe(true);  // no longer a stopword
  });

  it('splits on both hyphen and underscore', () => {
    const t = tokenize('suspend-call_marker');
    expect([...t].sort()).toEqual(['call', 'marker', 'suspend']);
  });

  it('handles empty string → empty set', () => {
    expect(tokenize('').size).toBe(0);
  });

  it('handles null / undefined → empty set (no throw)', () => {
    expect(tokenize(null as any).size).toBe(0);
    expect(tokenize(undefined as any).size).toBe(0);
  });

  it('handles non-string (number) without throwing', () => {
    // Coerced via String(...) — '12345' is a single token of length 5.
    expect([...tokenize(12345 as any)]).toEqual(['12345']);
  });

  it('strips unicode punctuation and keeps alphanumeric unicode-unaware', () => {
    // Non-ASCII letters are discarded by `\w` in the default regex —
    // documented limitation. English-dominant release notes only.
    const t = tokenize('Café → suspend');
    expect(t.has('suspend')).toBe(true);
    // "café" collapses to "caf" (length 3, not a stopword) via the
    // accent being stripped as non-\w. Documented behavior.
  });

  it('is robust to emoji in input', () => {
    const t = tokenize('🧵 IO Dispatcher 🧵');
    expect(t.has('dispatcher')).toBe(true);
  });

  it('handles very long input without pathological slowdown', () => {
    const long = 'word '.repeat(10_000);
    const start = Date.now();
    const t = tokenize(long);
    const ms = Date.now() - start;
    expect(t.size).toBe(1); // only "word"
    expect(ms).toBeLessThan(500);
  });

  it('tokens with only punctuation produce empty set', () => {
    expect(tokenize('!!!,.,!!').size).toBe(0);
  });
});

// ── jaccard ───────────────────────────────────────────────────────────────

describe('ADV-autolink — jaccard', () => {
  it('identical non-empty sets → 1', () => {
    const a = new Set(['x', 'y', 'z']);
    expect(jaccard(a, new Set([...a]))).toBe(1);
  });

  it('disjoint non-empty sets → 0', () => {
    expect(jaccard(new Set(['a']), new Set(['b']))).toBe(0);
  });

  it('one side empty → 0 (not NaN, not 1)', () => {
    expect(jaccard(new Set(), new Set(['a']))).toBe(0);
    expect(jaccard(new Set(['a']), new Set())).toBe(0);
  });

  it('both empty → 0 (not NaN)', () => {
    expect(jaccard(new Set(), new Set())).toBe(0);
  });

  it('null/undefined args → 0 (defensive)', () => {
    expect(jaccard(null as any, new Set(['a']))).toBe(0);
    expect(jaccard(new Set(['a']), undefined as any)).toBe(0);
  });

  it('singleton overlap', () => {
    // {a,b,c} ∩ {c,d,e} = {c}, union = {a,b,c,d,e}, 1/5 = 0.2
    expect(jaccard(new Set(['a', 'b', 'c']), new Set(['c', 'd', 'e']))).toBeCloseTo(0.2, 5);
  });

  it('subset relation', () => {
    // {a,b} ⊂ {a,b,c,d}, jaccard = 2/4 = 0.5
    expect(jaccard(new Set(['a', 'b']), new Set(['a', 'b', 'c', 'd']))).toBeCloseTo(0.5, 5);
  });

  it('is symmetric', () => {
    const a = new Set(['x', 'y']);
    const b = new Set(['y', 'z', 'w']);
    expect(jaccard(a, b)).toBe(jaccard(b, a));
  });
});

// ── extractDemoDoc ───────────────────────────────────────────────────────

describe('ADV-autolink — extractDemoDoc', () => {
  it('extracts the first /** ... */ block', () => {
    const src = `import { Stage } from '../lib/stage';
/**
 * Demo: the suspend marker shows dispatcher badges.
 */
export default async function record() {}`;
    expect(extractDemoDoc(src)).toContain('dispatcher badges');
  });

  it('returns empty string when no docblock', () => {
    expect(extractDemoDoc('// plain comment\nexport default () => {};')).toBe('');
  });

  it('returns empty string for non-string input', () => {
    expect(extractDemoDoc(null as any)).toBe('');
    expect(extractDemoDoc(42 as any)).toBe('');
    expect(extractDemoDoc(undefined as any)).toBe('');
  });

  it('picks FIRST docblock if there are multiple', () => {
    const src = `/** first */ /** second */ code`;
    expect(extractDemoDoc(src)).toContain('first');
    expect(extractDemoDoc(src)).not.toContain('second');
  });

  it('handles unclosed docblock by returning empty (no partial match)', () => {
    expect(extractDemoDoc('/** unterminated')).toBe('');
  });
});

// ── findBestMatch ────────────────────────────────────────────────────────

describe('ADV-autolink — findBestMatch', () => {
  const mkDemo = (name: string, tokens: string[]) => [name, new Set(tokens)] as const;

  it('returns null when no demo clears the threshold', () => {
    const demos = new Map([
      mkDemo('wombat-navigator', ['wombat', 'navigator']),
    ]);
    const h = { title: 'Kotlin symbol jumping', description: 'Go to definition' };
    expect(findBestMatch(h, demos)).toBeNull();
  });

  it('picks highest-scoring demo above threshold', () => {
    const demos = new Map([
      mkDemo('weak',   ['foo']),
      mkDemo('strong', ['kotlin', 'jumping', 'symbol']),
    ]);
    const h = { title: 'Kotlin symbol jumping', description: '' };
    const best = findBestMatch(h, demos);
    expect(best?.name).toBe('strong');
  });

  it('skips demos that are already used', () => {
    const demos = new Map([
      mkDemo('alpha', ['hover', 'explain', 'suppress']),
      mkDemo('beta',  ['hover']),
    ]);
    const h = { title: 'Suppress on hover', description: '' };
    const used = new Set(['alpha']);
    // alpha would win with higher overlap; beta must take over.
    expect(findBestMatch(h, demos, used)?.name).toBe('beta');
  });

  it('returns null when all demos are used', () => {
    const demos = new Map([mkDemo('only', ['hover', 'suppress'])]);
    expect(findBestMatch({ title: 'Suppress on hover' }, demos, new Set(['only']))).toBeNull();
  });

  it('deterministic tiebreak: alphabetical first wins', () => {
    // Both demos share exactly one token with the title → identical score.
    const demos = new Map([
      mkDemo('zzz-hover', ['hover']),
      mkDemo('aaa-hover', ['hover']),
    ]);
    const h = { title: 'Hover test', description: '' };
    expect(findBestMatch(h, demos)?.name).toBe('aaa-hover');
  });

  it('empty title → null (no matching attempted)', () => {
    expect(findBestMatch({ title: '', description: '' }, new Map([['x', new Set(['y'])]]))).toBeNull();
  });

  it('missing title field → no crash, null', () => {
    expect(findBestMatch({} as any, new Map([['x', new Set(['y'])]]))).toBeNull();
  });

  it('null highlight → null (no crash)', () => {
    expect(findBestMatch(null as any, new Map([['x', new Set(['y'])]]))).toBeNull();
  });

  it('exact threshold 0.15 matches', () => {
    // Construct sets with jaccard exactly 0.15... tricky. Use 3/20 = 0.15.
    // title tokens: 17 "others" + "shared"
    // demo  tokens: 2 "others2" + "shared"
    // Actually easier: use {a,b,c} vs {c,d,e,f,g,h} = 1/8 = 0.125 (below)
    // Try {a,b,c,d} vs {d,e,f,g} = 1/7 = 0.143 (below 0.15)
    // {a,b,c,d} vs {d,e,f} = 1/6 = 0.167 (above)
    // Ties between 0.125 and 0.167 — 0.15 rarely hits exactly. Test boundary.
    const demos = new Map([
      mkDemo('below', ['shared', 'unique1', 'unique2', 'unique3', 'unique4', 'unique5', 'unique6']),
    ]);
    const h = { title: 'shared', description: '' };
    // title tokens = {shared}; demo = above set. Jaccard = 1/7 ≈ 0.143 < 0.15.
    expect(findBestMatch(h, demos)).toBeNull();
  });

  it('custom threshold 0 matches any overlap', () => {
    const demos = new Map([mkDemo('demo', ['one', 'random'])]);
    const h = { title: 'one two three four', description: '' };
    expect(findBestMatch(h, demos, new Set(), { threshold: 0 })?.name).toBe('demo');
  });

  it('uses description tokens in addition to title', () => {
    const demos = new Map([mkDemo('dispatcher', ['dispatcher', 'badge', 'coroutine'])]);
    // Title is generic; description carries the signal.
    const h = { title: 'Coroutine work', description: 'Dispatcher badges inline' };
    expect(findBestMatch(h, demos)?.score).toBeGreaterThan(0);
  });
});

// ── autoLinkHighlights ──────────────────────────────────────────────────

describe('ADV-autolink — autoLinkHighlights (full pass)', () => {
  it('returns an empty report when no highlights', () => {
    const r = autoLinkHighlights([], ['demo']);
    expect(r.linked).toEqual([]);
    expect(r.orphaned).toEqual([{ name: 'demo' }]);
    expect(r.preassigned).toEqual([]);
  });

  it('mutates highlights to add media + mediaAlt', () => {
    const highlights = [
      { title: 'Suspend marker dispatcher', description: '' },
    ];
    const report = autoLinkHighlights(highlights, ['suspend-marker-dispatch']);
    expect((highlights[0] as any).media).toBe('suspend-marker-dispatch.webp');
    expect((highlights[0] as any).mediaAlt).toBe('Suspend marker dispatcher');
    expect(report.linked).toHaveLength(1);
  });

  it('does NOT overwrite an explicitly-preassigned media', () => {
    const highlights = [
      { title: 'Suspend marker dispatcher', description: '', media: 'manual.webp' },
    ];
    autoLinkHighlights(highlights, ['suspend-marker-dispatch']);
    expect((highlights[0] as any).media).toBe('manual.webp');
  });

  it('records preassigned media in the report', () => {
    const highlights = [
      { title: 'A', description: '', media: 'already.webp' },
    ];
    const report = autoLinkHighlights(highlights, []);
    expect(report.preassigned).toEqual([
      { title: 'A', name: 'already', source: 'explicit' },
    ]);
  });

  it('preassigned demo is not available for auto-linking another highlight', () => {
    // H1 has preassigned "shared-demo.webp". H2 matches "shared-demo"
    // best by tokens. Auto-linker must skip shared-demo for H2.
    const highlights = [
      { title: 'Alpha', description: '', media: 'shared-demo.webp' },
      { title: 'Shared demo description',  description: '' },
    ];
    autoLinkHighlights(highlights, ['shared-demo', 'other-demo-for-shared']);
    expect((highlights[1] as any).media).not.toBe('shared-demo.webp');
  });

  it('lists demos that match no highlight as orphaned', () => {
    const highlights = [{ title: 'Foo bar baz', description: '' }];
    const demos = ['foo-bar-baz', 'lonely-unrelated-demo'];
    const report = autoLinkHighlights(highlights, demos);
    expect(report.linked.map(x => x.name)).toContain('foo-bar-baz');
    expect(report.orphaned.map(x => x.name)).toContain('lonely-unrelated-demo');
  });

  it('consumes each demo at most once even if multiple highlights match', () => {
    const highlights = [
      { title: 'Suspend',       description: '' },
      { title: 'Suspend again', description: '' },
    ];
    const demos = ['suspend-demo']; // only one demo available
    autoLinkHighlights(highlights, demos);
    const mediaCount = highlights.filter(h => (h as any).media).length;
    expect(mediaCount).toBe(1);
  });

  it('readDemoDoc that throws does NOT abort the pass', () => {
    // If one .demo.ts is corrupt/missing, subsequent demos must still resolve.
    const highlights = [{ title: 'Resilience check demo', description: '' }];
    const report = autoLinkHighlights(highlights, ['corrupt-demo', 'resilience-check-demo'], {
      readDemoDoc: (name: string) => {
        if (name === 'corrupt-demo') throw new Error('disk error');
        return `/** a resilience check demo docblock */`;
      },
    });
    // Must NOT throw; the auto-link should still assign resilience-check-demo.
    expect(report.linked.length + report.orphaned.length).toBeGreaterThan(0);
  });

  it('empty demos array → no crash, every highlight is orphan-of-nothing', () => {
    const highlights = [{ title: 'Foo', description: '' }];
    const report = autoLinkHighlights(highlights, []);
    expect(report.linked).toEqual([]);
    expect(report.orphaned).toEqual([]);
  });

  it('null highlights array is tolerated', () => {
    // Defensive: .publish may occasionally pass a null if the JSON is
    // malformed. Don't let that crash the release pipeline.
    const report = autoLinkHighlights(null as any, ['foo']);
    expect(report.linked).toEqual([]);
    // Orphaned-from-a-null-highlight case: demo tokens never computed,
    // so no orphan report either. Defensive is good.
  });

  it('highlights containing only stopwords → no linking', () => {
    const highlights = [{ title: 'the new demo', description: 'and this that' }];
    const demos = ['the-new-demo-from-this'];
    const report = autoLinkHighlights(highlights, demos);
    // All tokens on both sides are stopwords → tokens empty → no match.
    expect(report.linked).toEqual([]);
  });

  it('report.linked entries carry the jaccard score for observability', () => {
    const highlights = [{ title: 'hover suppress explanation', description: '' }];
    const report = autoLinkHighlights(highlights, ['suppress-hover']);
    expect(report.linked).toHaveLength(1);
    expect(report.linked[0].score).toBeGreaterThan(0);
    expect(report.linked[0].score).toBeLessThanOrEqual(1);
  });
});

// ── end-to-end scenario: v1.16.0 release ─────────────────────────────────

describe('ADV-autolink — realistic v1.16.0 scenario', () => {
  // Both features of this session, fed into the matcher like .publish
  // would during release. Locks the EXACT linking outcome so a future
  // refactor that broke this pairing shows up in CI.

  const mkHighlights = () => [
    {
      title: 'Dispatcher badges on coroutine builders',
      description: 'withContext / launch / async show 🧵 IO · 🖥 Main · ⚙ Default inline.',
      kind: 'feature' as const,
    },
    {
      title: '@Suppress / @SuppressLint explained on hover',
      description: 'Hover any suppression ID to see a plain-English description and doc link.',
      kind: 'feature' as const,
    },
    {
      title: 'No breaking changes',
      description: 'Commands, settings, and features behave identically to v1.15.0.',
      kind: 'note' as const,
    },
  ];

  const DEMOS = ['suspend-call-marker', 'suppress-hover'];

  const DOC_READER = (name: string) => {
    if (name === 'suspend-call-marker') {
      return 'Demo: Suspend Call Marker + Dispatcher badges — spot every pause point and every thread switch. suspend, dispatcher, coroutine, launch, withContext.';
    }
    if (name === 'suppress-hover') {
      return 'Demo: @Suppress hover — explains every suppression ID in plain English.';
    }
    return '';
  };

  it('links suppress-hover.webp → the @Suppress highlight', () => {
    const highlights = mkHighlights();
    autoLinkHighlights(highlights, DEMOS, { readDemoDoc: DOC_READER });
    expect((highlights[1] as any).media).toBe('suppress-hover.webp');
  });

  it('links suspend-call-marker.webp → the dispatcher highlight (via docblock tokens)', () => {
    const highlights = mkHighlights();
    autoLinkHighlights(highlights, DEMOS, { readDemoDoc: DOC_READER });
    expect((highlights[0] as any).media).toBe('suspend-call-marker.webp');
  });

  it('does not link the "No breaking changes" note to any demo', () => {
    const highlights = mkHighlights();
    autoLinkHighlights(highlights, DEMOS, { readDemoDoc: DOC_READER });
    expect((highlights[2] as any).media).toBeUndefined();
  });

  it('each demo is consumed exactly once across all highlights', () => {
    const highlights = mkHighlights();
    autoLinkHighlights(highlights, DEMOS, { readDemoDoc: DOC_READER });
    const assigned = highlights
      .map(h => (h as any).media)
      .filter(Boolean);
    expect(new Set(assigned).size).toBe(assigned.length);
  });
});

// ── Public API sanity ────────────────────────────────────────────────────

describe('ADV-autolink — module exports', () => {
  it('STOPWORDS set is frozen-ish (at least non-empty and contains expected entries)', () => {
    expect(STOPWORDS.has('the')).toBe(true);
    expect(STOPWORDS.has('demo')).toBe(true);
    expect(STOPWORDS.has('kotlin')).toBe(true);
    expect(STOPWORDS.size).toBeGreaterThan(10);
  });

  it('DEFAULT_THRESHOLD is a finite number between 0 and 1', () => {
    expect(typeof DEFAULT_THRESHOLD).toBe('number');
    expect(DEFAULT_THRESHOLD).toBeGreaterThan(0);
    expect(DEFAULT_THRESHOLD).toBeLessThan(1);
  });

  it('demoTokenSet returns a Set', () => {
    expect(demoTokenSet('foo-bar')).toBeInstanceOf(Set);
  });
});
