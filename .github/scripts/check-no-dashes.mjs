#!/usr/bin/env node
// Scan user-facing copy for em-dash and en-dash.
// Per Kevin's no-dashes rule, both are banned in prose. Hyphens in compounds
// are also banned but harder to lint reliably (file paths, identifiers, proper
// nouns conflict), so we only enforce em/en-dash here.
//
// Backticked code and fenced code blocks are skipped because they may
// legitimately reference the character as data.
//
// Exits 1 if any banned dash is found, 0 otherwise.

import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = dirname(__filename);
const REPO_ROOT  = join(__dirname, '..', '..');

const TARGETS = [
  'package.json',
  'README.md',
  'CHANGELOG.md',
  'media/whats-new.json',
];

const EM_DASH = '—';
const EN_DASH = '–';

function stripCode(text) {
  // Replace code spans with same-length blanks but keep newlines so the
  // line indices stay aligned with the original text.
  const blank = (m) => m.replace(/[^\n]/g, ' ');
  let out = text.replace(/```[\s\S]*?```/g, blank);
  out = out.replace(/`[^`\n]*`/g, blank);
  return out;
}

// Source surfaces the user reads: hovers, notifications, QuickPick titles,
// diagnostics, webview text. The output channel is NOT copy, so a line whose
// statement is a log call is exempt; those tags are how the extension talks to
// its author, not to its reader.
const SOURCE_ROOTS = ['src', 'media/logcat'];
const SOURCE_EXT = /\.(ts|js)$/;
const LOG_CALL = /\.(debug|info|warn|error|appendLine)\s*\(|console\.\w+\s*\(|\blog\s*\(|\btrace\?\.\(/;
// A string literal on one line. Enough for this repo: every banned dash lives
// in a single line literal, and a false negative here only misses a warning.
const LITERAL = /('(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*"|`(?:[^`\\\n]|\\.)*`)/g;

function walkSources(dir, out) {
  let entries;
  try { entries = readdirSync(dir); } catch { return out; }
  for (const name of entries) {
    if (name === 'node_modules') continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walkSources(full, out);
    else if (SOURCE_EXT.test(name)) out.push(full);
  }
  return out;
}

function isLogStatement(lines, i) {
  // The call can sit up to three lines above a concatenated literal.
  for (let k = i; k >= 0 && k > i - 4; k--) if (LOG_CALL.test(lines[k])) return true;
  return false;
}

let failures = 0;

for (const root of SOURCE_ROOTS) {
  for (const abs of walkSources(join(REPO_ROOT, root), [])) {
    const text = readFileSync(abs, 'utf8');
    if (!text.includes(EM_DASH) && !text.includes(EN_DASH)) continue;
    const lines = text.split('\n');
    const rel = abs.slice(REPO_ROOT.length + 1);
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (!line.includes(EM_DASH) && !line.includes(EN_DASH)) continue;
      const bare = line.trim();
      if (bare.startsWith('//') || bare.startsWith('*') || bare.startsWith('/*')) continue;
      if (isLogStatement(lines, i)) continue;
      LITERAL.lastIndex = 0;
      let m;
      while ((m = LITERAL.exec(line)) !== null) {
        if (!m[1].includes(EM_DASH) && !m[1].includes(EN_DASH)) continue;
        const which = m[1].includes(EM_DASH) ? 'em-dash' : 'en-dash';
        console.error(`${rel}:${i + 1}: ${which} in user-facing text`);
        console.error(`  ${bare}`);
        failures++;
      }
    }
  }
}

for (const rel of TARGETS) {
  const abs = join(REPO_ROOT, rel);
  if (!existsSync(abs)) continue;
  const text = readFileSync(abs, 'utf8');
  const stripped = stripCode(text);
  const lines = text.split('\n');
  const strippedLines = stripped.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const sl = strippedLines[i] ?? '';
    if (sl.includes(EM_DASH) || sl.includes(EN_DASH)) {
      const which = sl.includes(EM_DASH) ? 'em-dash' : 'en-dash';
      console.error(`${rel}:${i + 1}: ${which} found`);
      console.error(`  ${lines[i].trim()}`);
      failures++;
    }
  }
}

if (failures > 0) {
  console.error('');
  console.error(`Found ${failures} banned dash(es) in user-facing copy.`);
  console.error('Replace with period, comma, or colon. See feedback_no_dashes.');
  console.error('Backticked references are exempt and are skipped by this scanner.');
  process.exit(1);
}

console.log('No banned dashes in user-facing copy.');
