/**
 * Demo end-to-end validation.
 *
 *   npx tsx scripts/demo/e2e.ts scripts/demo/demos/<name>.demo.ts
 *
 * Records a demo (via the existing `record.ts` pipeline) and then runs
 * pixel-level assertions against semantic keyframes of the resulting
 * WebP. Produces a self-contained HTML report at
 * `tmp-demo-e2e/<name>/report.html`.
 *
 * Flags:
 *   --skip-record       Assume the WebP + <name>.timeline.json sidecar are
 *                       already on disk; skip the record pipeline and only
 *                       run extraction + assertions + report.
 *
 *   --accept-baseline   Copy the freshly-extracted keyframes into
 *                       `scripts/demo/e2e/baselines/<name>/` as the new
 *                       golden reference. Commit the diff after verifying
 *                       the demo still looks right. Used explicitly after
 *                       intentional visual changes (font, palette, layout).
 *
 * Exit code:
 *   0  all assertions pass
 *   1  bad arguments or missing input
 *   2  at least one assertion failed (regression)
 */

import * as fs   from 'node:fs';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';

import type { TimelineEvent } from './lib/timeline';
import { probeWebp, extractFrameAsPng } from './e2e/extract-frames';
import { computeKeyframes, type Keyframe } from './e2e/keyframes';
import { buildAssertions, buildSsimAssertions, runAssertion } from './e2e/assertions';
import { generateReport }                                     from './e2e/report';

const REPO_ROOT = path.resolve(__dirname, '..', '..');

function die(msg: string, code = 1): never {
  // eslint-disable-next-line no-console
  console.error(`[demo:e2e] ${msg}`);
  process.exit(code);
}

function log(msg: string): void {
  // eslint-disable-next-line no-console
  console.log(`[demo:e2e] ${msg}`);
}

function main(): void {
  const args           = process.argv.slice(2);
  const skipRecord     = args.includes('--skip-record');
  const acceptBaseline = args.includes('--accept-baseline');
  const demoArg        = args.find(a => !a.startsWith('--'));
  if (!demoArg) die('usage: e2e.ts <path-to-*.demo.ts | path-to-*.webp> [--skip-record] [--accept-baseline]');

  // Resolve the demo name, the WebP path, and the sidecar timeline path.
  let name: string;
  let webpPath: string;
  let demoTsPath: string | null = null;

  if (demoArg.endsWith('.demo.ts')) {
    name       = path.basename(demoArg, '.demo.ts');
    webpPath   = path.join(REPO_ROOT, 'assets', 'demos', `${name}.webp`);
    demoTsPath = path.resolve(demoArg);
  } else if (demoArg.endsWith('.webp')) {
    name     = path.basename(demoArg, '.webp');
    webpPath = path.resolve(demoArg);
    if (!skipRecord) die('passing a .webp requires --skip-record (no source demo to re-record)');
  } else {
    die(`unsupported input: ${demoArg} — expected .demo.ts or .webp`);
  }

  const timelineJson = webpPath.replace(/\.webp$/, '.timeline.json');
  const outDir       = path.join(REPO_ROOT, 'tmp-demo-e2e', name);
  const framesDir    = path.join(outDir, 'frames');
  const baselineDir  = path.join(REPO_ROOT, 'scripts', 'demo', 'e2e', 'baselines', name);

  // Clean the output dir — stale PNGs would make the gallery misleading.
  fs.rmSync(outDir, { recursive: true, force: true });
  fs.mkdirSync(framesDir, { recursive: true });

  // Step 1: (re)record unless --skip-record.
  if (!skipRecord) {
    if (!demoTsPath) die('internal: expected a .demo.ts path when not skipping record');
    log(`▶ Recording ${demoTsPath}`);
    const recordScript = path.join(REPO_ROOT, 'dist', 'demo', 'record.js');
    if (!fs.existsSync(recordScript)) die(`record script not built: ${recordScript} — run \`npm run compile\` first`);
    const r = spawnSync('node', [recordScript, demoTsPath], { stdio: 'inherit' });
    if (r.status !== 0) die(`record pipeline exited with status ${r.status}`, r.status ?? 1);
  }

  if (!fs.existsSync(webpPath))      die(`WebP not found: ${webpPath}`);
  if (!fs.existsSync(timelineJson))  die(`timeline sidecar not found: ${timelineJson} — (re-)record to generate it`);

  // Step 2: probe + compute keyframes.
  const info   = probeWebp(webpPath);
  const events = JSON.parse(fs.readFileSync(timelineJson, 'utf8')) as TimelineEvent[];
  const fps    = info.frameCount / info.durationSec;

  log(`WebP: ${info.frameCount} frames @ ${fps.toFixed(2)} fps, canvas ${info.canvasW}×${info.canvasH}, duration ${info.durationSec.toFixed(2)}s`);
  log(`timeline: ${events.length} events`);

  const keyframes = computeKeyframes(events, {
    fps,
    totalSec:     info.durationSec,
    fadeMs:       150,
    fadeToDarkMs: 500,
  });
  log(`extracting ${keyframes.length} keyframes`);

  // Step 3: extract every keyframe as PNG.
  const framePngs: Record<string, string> = {};
  for (const k of keyframes) {
    const png = path.join(framesDir, `${k.label}.png`);
    extractFrameAsPng(webpPath, k.frameNumber, png);
    framePngs[k.label] = path.relative(outDir, png);
  }

  // Step 3b (optional): update the committed baseline with the freshly
  // extracted frames. Explicit opt-in via --accept-baseline after a
  // visually-verified change (font, palette, layout). Overwrites atomically:
  // remove stale baseline + copy the full current keyframe set.
  if (acceptBaseline) {
    fs.rmSync(baselineDir, { recursive: true, force: true });
    fs.mkdirSync(baselineDir, { recursive: true });
    let copied = 0;
    for (const k of keyframes) {
      const src = path.join(framesDir, `${k.label}.png`);
      const dst = path.join(baselineDir, `${k.label}.png`);
      fs.copyFileSync(src, dst);
      copied++;
    }
    log(`accepted ${copied} keyframes as the new baseline at ${baselineDir}`);
  }

  // Step 4: build + run assertions.
  const webpSizeKb = Math.round(fs.statSync(webpPath).size / 1024);
  const assertions = buildAssertions(events);

  // SSIM assertions: one per keyframe whose baseline PNG exists on disk.
  // Missing baselines are surfaced as a non-fatal warning so the run can
  // still produce a report; the developer's next move is --accept-baseline.
  const ssimAssertions = buildSsimAssertions(keyframes, baselineDir);
  const allAssertions  = [...assertions, ...ssimAssertions];
  const baselineExists = fs.existsSync(baselineDir) && fs.readdirSync(baselineDir).some(f => f.endsWith('.png'));
  if (!baselineExists) {
    log(`⚠ no baseline at ${baselineDir} — SSIM checks skipped. Run with --accept-baseline after visually verifying this demo.`);
  } else if (ssimAssertions.length < keyframes.length) {
    log(`⚠ baseline covers only ${ssimAssertions.length}/${keyframes.length} keyframes — probably stale after a keyframe-layout change. Re-run with --accept-baseline once the demo is reviewed.`);
  }

  log(`running ${allAssertions.length} assertions`);
  const keyframeByLbl: Record<string, typeof keyframes[number]> = {};
  const pngByKeyframe: Record<string, string> = {};
  for (const k of keyframes) {
    keyframeByLbl[k.label] = k;
    pngByKeyframe[k.label] = path.join(framesDir, `${k.label}.png`);
  }
  const ctx = {
    pngByKeyframe,
    keyframeByLbl,
    scalars: {
      frameCount:  info.frameCount,
      durationSec: info.durationSec,
      webpSizeKb,
      loopCount:   info.loopCount,
      canvasW:     info.canvasW,
      canvasH:     info.canvasH,
    },
  };
  const results = allAssertions.map(a => runAssertion(a, ctx));

  // Step 5: report.
  const reportPath = generateReport(outDir, {
    demoName:    name,
    webpPath,
    webpFrames:  info.frameCount,
    webpSeconds: info.durationSec,
    recordedAt:  fs.statSync(webpPath).mtime,
    results,
    keyframes,
    framePngs,
  });

  const passCount = results.filter(r => r.pass).length;
  const failCount = results.length - passCount;

  // Print a compact table to stdout.
  log(`\n  Results:`);
  for (const r of results) {
    const marker = r.pass ? '✓' : '✗';
    const kind   = `[${r.assertion.kind}]`.padEnd(16);
    // eslint-disable-next-line no-console
    console.log(
      `    ${marker} ${kind} ${r.assertion.name.padEnd(68)}  ${r.verdict}`,
    );
  }
  log(``);
  log(`  Report: ${reportPath}`);
  log(`  ${passCount}/${results.length} pass${failCount > 0 ? ` — ${failCount} FAIL` : ' — ALL GREEN'}`);

  if (failCount > 0) process.exit(2);
}

main();
