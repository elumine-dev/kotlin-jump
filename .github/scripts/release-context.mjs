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
//
// 3. Nothing of the maintainer's demo tooling may reach the prompt. The rest of
//    `.publish` excludes `scripts/**` and the demo assets from every part of
//    the context, and refuses to write notes that name the recorder, ffmpeg or
//    the demo pipeline. This collection read the header of EVERY test, the
//    demo ones included, and the patch of `src/` without the line filter the
//    old context applied, although `src/logcat/index.ts` carries KJ_DEMO_MODE.

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const git = (cwd, args) =>
  execFileSync('git', args, { cwd, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] });

/**
 * Every term the `.publish` safety net refuses, plus the identifiers its old
 * diff filter dropped. Matched case insensitively, as the net does. A test in
 * ReleaseContext.adversarial reads the net's list out of `.publish` and checks
 * each term against this one, so the two cannot drift apart.
 */
export const DEV_ONLY_RE = new RegExp([
  'demo:record', 'demo:workspace', 'predemo:', 'scripts/demo', 'recorder-ext',
  'kotlin-jump-demo-recorder', 'kotlinJumpDemo', 'KJ_DEMO', '\\.kotlin-jump-dev-mode',
  'demo recording', 'demo recorder', 'demo pipeline', 'screencapture', 'ffmpeg',
  'webp demo', 'record demo',
].join('|'), 'i');

/** A test of maintainer tooling: it imports from `scripts/`, which the whole context excludes. */
const testsDevTooling = text => /(?:from\s+|require\()\s*['"](?:\.\.\/)+scripts\//.test(text);

/** The `/**` comment blocks of `lines`, in order, each one a list of lines. */
function commentBlocks(lines) {
  const blocks = [];
  let current = null;
  for (const line of lines) {
    if (current === null && /^\s*\/\*\*/.test(line)) current = [];
    if (current !== null) {
      current.push(line);
      if (/\*\//.test(line)) { blocks.push(current); current = null; }
    }
  }
  if (current !== null) blocks.push(current);
  return blocks;
}

/** Blocks free of dev only material, flattened, until `maxLines` are taken. */
function keep(blocks, maxLines) {
  const out = [];
  for (const block of blocks) {
    if (block.some(l => DEV_ONLY_RE.test(l))) continue;
    for (const line of block) {
      if (out.length >= maxLines) return out;
      out.push(line);
    }
  }
  return out;
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
    const text = readFileSync(abs, 'utf8');
    if (testsDevTooling(text)) continue;
    if (status === 'A') {
      const header = keep(commentBlocks(text.split('\n')).slice(0, 1), maxCommentLines);
      if (header.length === 0) continue;
      out.push(`--- new test ${path}`);
      out.push(...header);
    } else {
      const added = git(cwd, ['diff', base, '--', path]).split('\n')
        .filter(l => l.startsWith('+') && !l.startsWith('+++ '))
        .map(l => l.slice(1));
      const blocks = keep(commentBlocks(added), maxCommentLines);
      if (blocks.length === 0) continue;
      out.push(`--- comment blocks added to ${path}`);
      out.push(...blocks);
    }
  }

  out.push('');
  const patch = git(cwd, ['diff', base, '--', 'src']).split('\n').filter(l => !DEV_ONLY_RE.test(l));
  if (patch.length > 0 && patch[patch.length - 1] === '') patch.pop();
  out.push(`Shipped source changes (patch of src/${patch.length > maxSrcLines ? `, first ${maxSrcLines} of ${patch.length} lines` : ''}):`);
  out.push(...patch.slice(0, maxSrcLines));
  return out.join('\n') + '\n';
}

// Run as a command, not imported. Compared on REAL paths: `import.meta.url` is
// resolved through symlinks and `process.argv[1]` is the path as typed, so a
// script reached through a link (macOS puts /tmp behind one) skipped this
// block, printed nothing and exited 0, and the notes lost every reason.
const invoked = (() => {
  try { return process.argv[1] !== undefined && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href; }
  catch { return false; }
})();
if (invoked) {
  const i = process.argv.indexOf('--base');
  const base = i === -1 ? 'HEAD' : process.argv[i + 1];
  process.stdout.write(releaseContext({ cwd: process.cwd(), base }));
}
