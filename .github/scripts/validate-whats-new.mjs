#!/usr/bin/env node
// Strict validation for media/whats-new.json.
//
// This is the hard gate between "whatever Claude + the auto-link produced"
// and "what lands in the Marketplace VSIX". If ANY check here fails, the
// process exits with a non-zero code, which aborts `.publish` before it
// commits, tags, or pushes. Shipping is blocked until a human fixes the
// offending field.
//
// Why a separate script (not unit tests):
//   - Runs as part of `.publish`, not at `npm test` time.
//   - Emits structured, actionable error messages that a release-time human
//     can act on immediately without digging through a test runner.
//   - CI can invoke this same script in a pre-publish step for defence-
//     in-depth, so the exact same rules gate both local and CI releases.
//
// Invocation:
//   node .github/scripts/validate-whats-new.mjs [--version X.Y.Z]
//
// When --version is provided, the file's `version` field must match it
// EXACTLY. `.publish` passes the version it's about to ship, so this
// catches drift between the version the webview advertises and the
// version the extension binary carries.

import { readFileSync, existsSync, statSync } from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);
const REPO_ROOT  = path.resolve(__dirname, '..', '..');

const WHATS_NEW_PATH = path.join(REPO_ROOT, 'media', 'whats-new.json');
const DEMOS_DIR      = path.join(REPO_ROOT, 'assets', 'demos');
const PACKAGE_JSON   = path.join(REPO_ROOT, 'package.json');

// Limits cross-checked with WhatsNewPanel.buildHtml (cards slice to 3).
const MAX_HIGHLIGHTS          = 3;
const MAX_SECTION_BULLETS     = 5;
const MAX_TITLE_LEN           = 120;
const MAX_TAGLINE_LEN         = 200;
const MAX_SUMMARY_LEN         = 800;
const MAX_DESCRIPTION_LEN     = 1200;
const MAX_BULLET_LEN          = 600;
const VALID_KINDS             = new Set(['feature', 'improvement', 'fix', 'note']);
const SEMVER_RE               = /^\d+\.\d+\.\d+([.-][0-9A-Za-z.-]+)?(\+[0-9A-Za-z.-]+)?$/;
const PLAUSIBLE_URL_RE        = /^https?:\/\//;
const MEDIA_FILENAME_RE       = /^[a-z0-9][a-z0-9\-_.]*\.webp$/i;

// Patterns that suggest Claude leaked chain-of-thought, placeholders, or
// ALL-CAPS filler. These must never reach the Marketplace webview.
const LEAK_PATTERNS = [
  { re: /\bI(?:'m| am| will)\b/i,                 why: 'first-person phrasing (possible LLM leak)'      },
  { re: /\b(?:TODO|FIXME|XXX)\b/,                 why: 'todo/fixme marker'                              },
  { re: /lorem ipsum/i,                           why: 'placeholder text'                               },
  { re: /<placeholder>|<insert .*?>/i,            why: 'bracketed placeholder'                          },
  { re: /\bclaude\b/i,                            why: 'bare "claude" reference (prompt leak)'          },
  { re: /\b(?:draft|drafted|drafting) (?:the |these )?notes\b/i, why: 'meta-text about the drafting process' },
  { re: /^\s*```/m,                               why: 'markdown code fence (not rendered by webview)'  },
  { re: /\{[a-z_]+\}/i,                           why: 'unsubstituted template variable'                },
];

const args = process.argv.slice(2);
let expectedVersion = null;
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--version' && args[i + 1]) {
    expectedVersion = args[i + 1];
    i++;
  }
}

const errors = [];
function err(msg)  { errors.push(msg); }
function fatal(msg) { process.stderr.write(`validate-whats-new: ERROR ${msg}\n`); process.exit(2); }

// ── Load + parse ──────────────────────────────────────────────────────────

if (!existsSync(WHATS_NEW_PATH)) fatal(`media/whats-new.json does not exist`);

let raw;
try { raw = readFileSync(WHATS_NEW_PATH, 'utf8'); }
catch (e) { fatal(`cannot read ${WHATS_NEW_PATH}: ${e.message}`); }

let data;
try { data = JSON.parse(raw); }
catch (e) { fatal(`media/whats-new.json is not valid JSON: ${e.message}`); }

if (typeof data !== 'object' || data === null || Array.isArray(data)) {
  fatal(`media/whats-new.json must be a JSON object`);
}

// ── Top-level structural fields ───────────────────────────────────────────

for (const field of ['version', 'summary']) {
  if (typeof data[field] !== 'string' || data[field].trim().length === 0) {
    err(`field \`${field}\` must be a non-empty string`);
  }
}

if (typeof data.version === 'string' && !SEMVER_RE.test(data.version)) {
  err(`field \`version\` "${data.version}" is not a valid semver`);
}

if (expectedVersion && data.version !== expectedVersion) {
  err(`field \`version\` is "${data.version}" but release wants "${expectedVersion}"`);
}

if (typeof data.tagline === 'string' && data.tagline.length > MAX_TAGLINE_LEN) {
  err(`\`tagline\` exceeds ${MAX_TAGLINE_LEN} chars (got ${data.tagline.length})`);
}
if (typeof data.summary === 'string' && data.summary.length > MAX_SUMMARY_LEN) {
  err(`\`summary\` exceeds ${MAX_SUMMARY_LEN} chars (got ${data.summary.length})`);
}

// ── Cross-check against package.json ─────────────────────────────────────

let pkgVersion = null;
try {
  pkgVersion = JSON.parse(readFileSync(PACKAGE_JSON, 'utf8')).version;
} catch {
  err(`cannot read package.json to cross-check version`);
}

if (pkgVersion && data.version && semverCompare(data.version, pkgVersion) < 0) {
  err(`whats-new.json version (${data.version}) is BEHIND package.json (${pkgVersion}) — client would see stale notes`);
}

// ── Highlights (cards) ────────────────────────────────────────────────────

if (!Array.isArray(data.highlights)) {
  // optional, but if present, must be an array
  if (data.highlights !== undefined) err(`\`highlights\` must be an array (got ${typeof data.highlights})`);
} else {
  if (data.highlights.length > MAX_HIGHLIGHTS) {
    err(`\`highlights\` has ${data.highlights.length} entries; only the first ${MAX_HIGHLIGHTS} render — the rest are silently dropped. Trim or promote.`);
  }
  const seenMedia = new Set();
  for (let i = 0; i < data.highlights.length; i++) {
    const h = data.highlights[i];
    const prefix = `highlights[${i}]`;

    if (typeof h !== 'object' || h === null || Array.isArray(h)) {
      err(`${prefix} must be an object`);
      continue;
    }
    if (typeof h.title !== 'string' || h.title.trim().length === 0) {
      err(`${prefix}.title must be a non-empty string`);
    }
    if (typeof h.title === 'string' && h.title.length > MAX_TITLE_LEN) {
      err(`${prefix}.title exceeds ${MAX_TITLE_LEN} chars (got ${h.title.length})`);
    }
    if (h.description !== undefined) {
      if (typeof h.description !== 'string') err(`${prefix}.description must be a string`);
      else if (h.description.length > MAX_DESCRIPTION_LEN) {
        err(`${prefix}.description exceeds ${MAX_DESCRIPTION_LEN} chars`);
      }
    }
    if (h.kind !== undefined && !VALID_KINDS.has(h.kind)) {
      err(`${prefix}.kind "${h.kind}" is not one of ${[...VALID_KINDS].join(', ')}`);
    }
    if (h.media !== undefined) {
      if (typeof h.media !== 'string') {
        err(`${prefix}.media must be a string`);
      } else if (PLAUSIBLE_URL_RE.test(h.media)) {
        err(`${prefix}.media "${h.media}" looks like a URL — must be a bare filename relative to assets/demos/`);
      } else if (!MEDIA_FILENAME_RE.test(h.media)) {
        err(`${prefix}.media "${h.media}" is not a valid webp filename (lowercase, alphanumeric, ends .webp)`);
      } else {
        const abs = path.join(DEMOS_DIR, h.media);
        if (!existsSync(abs)) {
          err(`${prefix}.media "${h.media}" does not exist in assets/demos/`);
        } else if (statSync(abs).size < 1024) {
          err(`${prefix}.media "${h.media}" is suspiciously small (<1 KB) — probably a broken recording`);
        }
        if (seenMedia.has(h.media)) err(`${prefix}.media "${h.media}" is assigned to more than one highlight`);
        seenMedia.add(h.media);
      }
    }
    if (h.mediaAlt !== undefined && typeof h.mediaAlt !== 'string') {
      err(`${prefix}.mediaAlt must be a string when present`);
    }
  }
}

// ── Sections ──────────────────────────────────────────────────────────────

if (!Array.isArray(data.sections) || data.sections.length === 0) {
  err(`\`sections\` must be a non-empty array (webview expects at least one section)`);
} else {
  for (let i = 0; i < data.sections.length; i++) {
    const s = data.sections[i];
    const prefix = `sections[${i}]`;
    if (typeof s !== 'object' || s === null) { err(`${prefix} must be an object`); continue; }
    if (typeof s.heading !== 'string' || s.heading.trim().length === 0) {
      err(`${prefix}.heading must be a non-empty string`);
    }
    if (!Array.isArray(s.bullets) || s.bullets.length === 0) {
      err(`${prefix}.bullets must be a non-empty array`);
    } else if (s.bullets.length > MAX_SECTION_BULLETS) {
      err(`${prefix}.bullets has ${s.bullets.length} entries; webview shows up to ${MAX_SECTION_BULLETS}`);
    } else {
      for (let j = 0; j < s.bullets.length; j++) {
        const b = s.bullets[j];
        if (typeof b !== 'string' || b.trim().length === 0) {
          err(`${prefix}.bullets[${j}] must be a non-empty string`);
        } else if (b.length > MAX_BULLET_LEN) {
          err(`${prefix}.bullets[${j}] exceeds ${MAX_BULLET_LEN} chars`);
        }
      }
    }
  }
}

// ── Leak / hallucination detection across all text ───────────────────────

const inspect = [];
if (typeof data.title    === 'string') inspect.push(['title',    data.title]);
if (typeof data.tagline  === 'string') inspect.push(['tagline',  data.tagline]);
if (typeof data.summary  === 'string') inspect.push(['summary',  data.summary]);
for (let i = 0; i < (data.highlights || []).length; i++) {
  const h = data.highlights[i];
  if (typeof h?.title       === 'string') inspect.push([`highlights[${i}].title`,       h.title]);
  if (typeof h?.description === 'string') inspect.push([`highlights[${i}].description`, h.description]);
}
for (let i = 0; i < (data.sections || []).length; i++) {
  const s = data.sections[i];
  if (typeof s?.heading === 'string') inspect.push([`sections[${i}].heading`, s.heading]);
  for (let j = 0; j < (s?.bullets || []).length; j++) {
    const b = s.bullets[j];
    if (typeof b === 'string') inspect.push([`sections[${i}].bullets[${j}]`, b]);
  }
}

for (const [where, text] of inspect) {
  for (const { re, why } of LEAK_PATTERNS) {
    if (re.test(text)) {
      const m = text.match(re);
      err(`${where} looks like ${why}: "${(m && m[0]) || text.slice(0, 40)}..."`);
    }
  }
}

// ── Report + exit ─────────────────────────────────────────────────────────

if (errors.length > 0) {
  process.stderr.write(`validate-whats-new: ${errors.length} problem(s) in media/whats-new.json\n`);
  for (const e of errors) process.stderr.write(`  - ${e}\n`);
  process.stderr.write(`\nRefusing to ship. Fix media/whats-new.json and re-run the publish.\n`);
  process.exit(1);
}

process.stdout.write(
  `validate-whats-new: OK — version ${data.version}, ` +
  `${(data.highlights || []).length} highlight(s), ` +
  `${(data.sections || []).length} section(s).\n`,
);

// ── util ─────────────────────────────────────────────────────────────────

function semverCompare(a, b) {
  const pa = a.split(/[.-]/).map(n => parseInt(n, 10));
  const pb = b.split(/[.-]/).map(n => parseInt(n, 10));
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const x = Number.isFinite(pa[i]) ? pa[i] : 0;
    const y = Number.isFinite(pb[i]) ? pb[i] : 0;
    if (x !== y) return x < y ? -1 : 1;
  }
  return 0;
}
