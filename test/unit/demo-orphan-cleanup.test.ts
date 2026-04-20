/**
 * Regression tests for the demo recorder's cleanup guarantees.
 *
 * These tests spawn a real `node dist/demo/record.js` subprocess and verify
 * that, no matter HOW the orchestrator dies (uncaught exception, SIGINT,
 * watchdog), it never leaves a `screencapture` orphan on the system.
 *
 * Slow by nature — each test launches a real VS Code via @vscode/test-electron
 * (~15-20 s). Skipped by default to keep `npm test` snappy; run with:
 *
 *     KJ_RUN_DEMO_INTEGRATION=1 npm test -- demo-orphan-cleanup
 *
 * Prereqs: `npm run compile` must have produced `dist/demo/record.js`.
 */

import { describe, test, expect, beforeAll } from 'vitest';
import { execSync, spawn } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';

const REPO_ROOT  = path.resolve(__dirname, '..', '..');
const RECORD_JS  = path.join(REPO_ROOT, 'dist', 'demo', 'record.js');
const DEMO_FILE  = path.join(REPO_ROOT, 'scripts', 'demo', 'demos', 'find-usages.demo.ts');
const LOCK_FILE  = '/tmp/kj-demo.lock';

const ENABLED = process.env.KJ_RUN_DEMO_INTEGRATION === '1';

function countOrphans(): number {
  try {
    const out = execSync(`pgrep -f "screencapture.*kj-demo-" | wc -l`, { encoding: 'utf8' });
    return parseInt(out.trim(), 10);
  } catch { return 0; }
}

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}

describe.runIf(ENABLED)('demo recorder cleanup (slow integration)', () => {
  beforeAll(() => {
    if (!fs.existsSync(RECORD_JS)) {
      throw new Error(`Missing build artefact: ${RECORD_JS}\nRun: npm run compile`);
    }
    // Start from a clean slate — no pre-existing orphans, no stale lockfile.
    try { execSync(`pkill -f "screencapture.*kj-demo-"`, { stdio: 'ignore' }); } catch { /* none */ }
    try { fs.unlinkSync(LOCK_FILE); } catch { /* none */ }
  });

  test('crashing mid-capture (KJ_DEMO_FORCE_CRASH) leaves no orphan', async () => {
    const before = countOrphans();
    expect(fs.existsSync(LOCK_FILE)).toBe(false);

    const p = spawn('node', [RECORD_JS, DEMO_FILE], {
      env:   { ...process.env, KJ_DEMO_FORCE_CRASH: 'after-capture-start' },
      stdio: 'pipe',
    });

    // Drain stdio so the pipe buffers don't fill and hang the child.
    p.stdout.on('data', () => { /* discard */ });
    p.stderr.on('data', () => { /* discard */ });

    const exitCode = await new Promise<number | null>(r => p.on('exit', code => r(code)));
    await sleep(1500);                                // give cleanup time to finish

    expect(countOrphans()).toBe(before);
    expect(fs.existsSync(LOCK_FILE)).toBe(false);
    // Any non-zero code is acceptable — crash is expected.
    expect(exitCode).not.toBe(0);
  }, 90_000);

  test('SIGINT during capture leaves no orphan', async () => {
    const before = countOrphans();
    expect(fs.existsSync(LOCK_FILE)).toBe(false);

    const p = spawn('node', [RECORD_JS, DEMO_FILE], {
      env:   process.env,
      stdio: 'pipe',
    });

    // Wait until we see `[phase=start-capture] ok` — that means screencapture
    // is actually running and there's something to leak if cleanup is broken.
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('timeout waiting for start-capture phase')), 60_000);
      let buf = '';
      p.stdout.on('data', (chunk: Buffer) => {
        buf += chunk.toString();
        if (buf.includes('[phase=start-capture] ok')) {
          clearTimeout(timer);
          resolve();
        }
      });
      p.stderr.on('data', () => { /* discard */ });
      p.on('exit', () => { clearTimeout(timer); reject(new Error('child exited before start-capture')); });
    });

    // Send SIGINT like Ctrl-C does.
    p.kill('SIGINT');

    const exitCode = await new Promise<number | null>(r => p.on('exit', code => r(code)));
    await sleep(1500);                                // cleanup grace

    expect(countOrphans()).toBe(before);
    expect(fs.existsSync(LOCK_FILE)).toBe(false);
    // exit code 130 is the conventional SIGINT exit.
    expect([130, null, 1]).toContain(exitCode);
  }, 120_000);

  test('concurrent run is rejected with actionable message', async () => {
    // Create a stale lockfile held by our current Node process (which IS alive),
    // so the recorder must refuse rather than clobber it.
    fs.writeFileSync(LOCK_FILE, `${process.pid}\n`);

    const out = await new Promise<{ code: number | null; stderr: string }>(resolve => {
      const p = spawn('node', [RECORD_JS, DEMO_FILE], { stdio: 'pipe' });
      let stderr = '';
      p.stdout.on('data', () => { /* discard */ });
      p.stderr.on('data', (c: Buffer) => { stderr += c.toString(); });
      p.on('exit', code => resolve({ code, stderr }));
    });

    // Clean up the lockfile we planted.
    try { fs.unlinkSync(LOCK_FILE); } catch { /* already gone */ }

    expect(out.code).toBe(1);
    expect(out.stderr + '').toMatch(/Another kjdemo is running/);
    expect(out.stderr + '').toMatch(/kjdemo clean/);
  }, 30_000);
});

// Sanity — if the env is off, ensure the describe block was skipped.
describe.runIf(!ENABLED)('demo recorder cleanup (skipped)', () => {
  test('set KJ_RUN_DEMO_INTEGRATION=1 to run the heavy integration tests', () => {
    expect(ENABLED).toBe(false);
  });
});
