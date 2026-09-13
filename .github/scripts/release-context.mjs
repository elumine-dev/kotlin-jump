#!/usr/bin/env node
// Builds the part of the release notes prompt that explains WHY each change
// was made. `.publish` used to do this in bash, and two things went wrong:
//
// 1. It piped `git diff` into `head -600` under `set -euo pipefail`. Once the
//    patch outgrew the pipe buffer (about 64 KB), `head` closed early, git died
//    of SIGPIPE, the pipeline returned 141, and the whole script stopped with
//    no message before the prompt existed. A base 70 releases back was enough.
//
// 2. It printed the FIRST comment block of every test file that changed. For a
//    test that already existed, that block describes the fix it was written
//    for, which shipped in an earlier release. The reason for the new change
//    lives in the comment blocks ADDED to the file, and those were never read.
//
// Git is read here without any pipe, and truncation happens on strings.

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const git = (cwd, args) =>
  execFileSync('git', args, { cwd, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] });

/** Comment blocks opening with `/**`, in order, each capped, until `maxLines` are taken. */
function commentBlocks(lines, maxLines) {
  const out = [];
  let inBlock = false;
  for (const line of lines) {
    if (!inBlock && /^\s*\/\*\*/.test(line)) inBlock = true;
    if (inBlock) {
      out.push(line);
      if (out.length >= maxLines) break;
      if (/\*\//.test(line)) inBlock = false;
    }
  }
  return out;
}

/** The first `/**` block of a file: the reason a NEW test was written. */
function firstBlock(text, maxLines) {
  const blocks = commentBlocks(text.split('\n'), maxLines);
  const end = blocks.findIndex(l => /\*\//.test(l));
  return end === -1 ? blocks : blocks.slice(0, end + 1);
}

export function releaseContext({ cwd, base, maxSrcLines = 600, maxCommentLines = 80 }) {
  const out = [];
  out.push('Why each change was made:');
  out.push('(This repository writes the reason for a fix in a comment block of its test: the failure a');
  out.push(' user saw, a small example, and what was measured. For a NEW test file that is its header;');
  out.push(' for a test file that already existed, only the comment blocks ADDED in this release count,');
  out.push(' because its header describes an earlier fix. These comments are in French.)');

  const entries = new Map();
  for (const row of git(cwd, ['diff', '--name-status', base, '--', 'test/*.test.ts']).split('\n')) {
    if (!row.trim()) continue;
    const [status, first, second] = row.split('\t');
    const path = status.startsWith('R') || status.startsWith('C') ? second : first;
    entries.set(path, status[0]);
  }
  for (const path of git(cwd, ['ls-files', '--others', '--exclude-standard', '--', 'test/*.test.ts']).split('\n')) {
    if (path.trim()) entries.set(path.trim(), 'A');
  }

  for (const [path, status] of [...entries].sort((a, b) => a[0].localeCompare(b[0]))) {
    const abs = join(cwd, path);
    if (status === 'D' || !existsSync(abs)) continue;
    if (status === 'A') {
      out.push(`--- new test ${path}`);
      out.push(...firstBlock(readFileSync(abs, 'utf8'), maxCommentLines));
    } else {
      const added = git(cwd, ['diff', base, '--', path]).split('\n')
        .filter(l => l.startsWith('+') && !l.startsWith('+++ '))
        .map(l => l.slice(1));
      const blocks = commentBlocks(added, maxCommentLines);
      if (blocks.length === 0) continue;
      out.push(`--- comment blocks added to ${path}`);
      out.push(...blocks);
    }
  }

  out.push('');
  const patch = git(cwd, ['diff', base, '--', 'src']).split('\n');
  if (patch.length > 0 && patch[patch.length - 1] === '') patch.pop();
  out.push(`Shipped source changes (patch of src/${patch.length > maxSrcLines ? `, first ${maxSrcLines} of ${patch.length} lines` : ''}):`);
  out.push(...patch.slice(0, maxSrcLines));
  return out.join('\n') + '\n';
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const i = process.argv.indexOf('--base');
  const base = i === -1 ? 'HEAD' : process.argv[i + 1];
  process.stdout.write(releaseContext({ cwd: process.cwd(), base }));
}
