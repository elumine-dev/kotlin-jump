/**
 * Re-render a manual demo from its existing artefacts — no recording.
 *
 *   node dist/demo/manual-render.js <name>
 *
 * Reads media/walkthrough/<name>/{raw.mov, timeline.json} and regenerates the
 * .webp + -poster.png. Use this when you want to change labels, add/remove
 * events, or bump encoder quality without re-running `kjdemo manual`.
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { checkRequiredBinaries } from './lib/webp-encoder';
import { runPostProcess }        from './lib/post-process';
import { publishWalkthroughToDemos } from './lib/publish-to-demos';

const REPO_ROOT = path.resolve(__dirname, '..', '..');

// eslint-disable-next-line @typescript-eslint/no-floating-promises
main();

async function main(): Promise<void> {
  const binCheck = checkRequiredBinaries();
  if (!binCheck.ok) {
    die(
      `missing required binaries: ${binCheck.missing.join(', ')}\n` +
      `install with: brew install ffmpeg webp`,
    );
  }

  const name = process.argv[2];
  if (!name) {
    die(
      `usage: manual-render.js <name>\n` +
      `  Re-renders media/walkthrough/<name>/<name>.webp from raw.mov + timeline.json\n` +
      `  Example: manual-render.js android-run`,
    );
  }
  if (!/^[a-z0-9][a-z0-9-]*$/i.test(name)) {
    die(`invalid name: ${JSON.stringify(name)}. Use only letters, digits, and hyphens.`);
  }

  const dir          = path.join(REPO_ROOT, 'media', 'walkthrough', name);
  const rawMov       = path.join(dir, 'raw.mov');
  const timelineJson = path.join(dir, 'timeline.json');
  const outputWebp   = path.join(dir, `${name}.webp`);

  if (!fs.existsSync(rawMov)) {
    die(
      `raw.mov not found: ${rawMov}\n` +
      `  Record it first with: kjdemo manual ${name} [seconds]`,
    );
  }
  if (!fs.existsSync(timelineJson)) {
    die(
      `timeline.json not found: ${timelineJson}\n` +
      `  Record it first with: kjdemo manual ${name} [seconds]`,
    );
  }

  // Lightweight cleanup — we only allocate a tmp dir, no screen recorder / lock.
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kj-demo-render-'));
  let cleaned = false;
  const cleanup = (): void => {
    if (cleaned) return;
    cleaned = true;
    if (!process.env.KJ_DEMO_KEEP_TMP) {
      try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* best-effort */ }
    }
  };
  for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP', 'SIGQUIT'] as const) {
    process.on(sig, () => { cleanup(); process.exit(130); });
  }
  process.on('exit', cleanup);

  log(`▶ Re-rendering "${name}" from ${dir}`);

  await phase('post-process', () => runPostProcess({
    rawMov,
    outputWebp,
    timelineJson,
    sidecarTimeline: timelineJson,  // manual mode: timeline input IS the sidecar
    tmpDir,
    rawOffsetMs:     0,
    trimMode:        'none',
    repoRoot:        REPO_ROOT,
    log,
  }));

  log(``);
  log(`Re-rendered:`);
  log(`  ${outputWebp}`);
  log(`  ${outputWebp.replace(/\.webp$/, '-poster.png')}`);

  // Mirror the freshly-rendered output into media/demos/ so the release
  // pipeline picks up the new content. Same convention as the initial
  // record run.
  log(``);
  log(`Published to media/demos/:`);
  publishWalkthroughToDemos({ name, walkthroughDir: dir, repoRoot: REPO_ROOT, log });

  cleanup();
}

async function phase<T>(name: string, fn: () => Promise<T> | T): Promise<T> {
  const start = Date.now();
  log(`[phase=${name}] start`);
  try {
    const r = await fn();
    log(`[phase=${name}] ok (${Date.now() - start}ms)`);
    return r;
  } catch (e) {
    log(`[phase=${name}] FAIL (${Date.now() - start}ms): ${(e as Error).message}`);
    throw e;
  }
}

function log(msg: string): void {
  // eslint-disable-next-line no-console
  console.log(`[demo] ${msg}`);
}

function die(msg: string): never {
  // eslint-disable-next-line no-console
  console.error(`[demo] ${msg}`);
  process.exit(1);
}
