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

import { readFileSync, existsSync } from 'node:fs';
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

let failures = 0;
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
