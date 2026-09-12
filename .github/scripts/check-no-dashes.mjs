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
import { pathToFileURL } from 'node:url';
import ts from 'typescript';
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
// A stylesheet or a markup block written inside a webview template carries its
// own comments. They are code, not copy.
const COMMENT_IN_LITERAL = /\/\*[\s\S]*?\*\/|<!--[\s\S]*?-->/g;

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

/**
 * Every banned dash inside a string of `text`, as `{ line, which, source }`.
 *
 * Read by the TypeScript parser rather than line by line. The line based
 * version could only see a literal that opened and closed on one line, so a
 * webview built as a multi line template was never looked into at all, and its
 * own comment said as much: `every banned dash lives in a single line literal`.
 * That held when it was written. It is not a property anything enforced.
 */
export function scanSource(rel, text) {
  const out = [];
  if (!text.includes(EM_DASH) && !text.includes(EN_DASH)) return out;
  const lines = text.split('\n');
  const sf = ts.createSourceFile(rel, text, ts.ScriptTarget.Latest, true);
  const blank = (m) => m.replace(/[^\n]/g, ' ');
  const visit = (node) => {
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)
        || ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node)) {
      const start = node.getStart(sf);
      const brut = text.slice(start, node.getEnd()).replace(COMMENT_IN_LITERAL, blank);
      const at = Math.max(brut.indexOf(EM_DASH), brut.indexOf(EN_DASH)) >= 0
        ? Math.min(...[brut.indexOf(EM_DASH), brut.indexOf(EN_DASH)].filter(i => i >= 0))
        : -1;
      if (at >= 0) {
        const line = sf.getLineAndCharacterOfPosition(start).line
          + brut.slice(0, at).split('\n').length - 1;
        if (!isLogStatement(lines, line)) {
          out.push({
            line: line + 1,
            which: brut[at] === EM_DASH ? 'em-dash' : 'en-dash',
            source: (lines[line] ?? '').trim(),
          });
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return out;
}

// Importable by the test suite: only the command line run scans the repo.
function main() {
  let failures = 0;

  for (const root of SOURCE_ROOTS) {
    for (const abs of walkSources(join(REPO_ROOT, root), [])) {
      const rel = abs.slice(REPO_ROOT.length + 1);
      for (const f of scanSource(rel, readFileSync(abs, 'utf8'))) {
        console.error(`${rel}:${f.line}: ${f.which} in user-facing text`);
        console.error(`  ${f.source}`);
        failures++;
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
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) main();
