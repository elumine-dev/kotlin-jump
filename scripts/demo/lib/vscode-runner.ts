/**
 * Runs inside the VS Code extension host (loaded via `runTests({ extensionTestsPath })`).
 *
 * Reads these environment variables:
 *   - KJ_DEMO_FILE      Absolute path to the compiled demo module (JS)
 *   - KJ_DEMO_TIMELINE  Absolute path to write the recorded timeline JSON
 *   - KJ_DEMO_WORKSPACE Absolute path to the demo workspace root (opened in VS Code)
 *   - KJ_DEMO_READY     Marker file the runner writes when VS Code is fully ready
 *   - KJ_DEMO_START     Marker file the orchestrator writes when ffmpeg is rolling
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { Stage } from './stage';

export async function run(): Promise<void> {
  const demoFile     = requireEnv('KJ_DEMO_FILE');
  const timelinePath = requireEnv('KJ_DEMO_TIMELINE');
  const workspace    = requireEnv('KJ_DEMO_WORKSPACE');
  const readyMarker  = requireEnv('KJ_DEMO_READY');
  const startMarker  = requireEnv('KJ_DEMO_START');

  log('runner starting');
  log(`demo: ${demoFile}`);
  log(`workspace: ${workspace}`);
  log(`extension-host pid: ${process.pid}, parent pid: ${process.ppid}`);

  // 1. Wait for VS Code to actually be ready (focused, workspace loaded).
  await waitFor(() => vscode.workspace.workspaceFolders !== undefined, 5000, 'workspace folders');
  log('workspace folders loaded');

  // 2. Signal to the orchestrator that VS Code is up and focused — it can now
  //    start ffmpeg. We also write our process ancestry so the orchestrator
  //    can identify THIS specific VS Code window (vs. the user's regular one).
  fs.writeFileSync(readyMarker, String(process.ppid));

  // 3. Wait for the orchestrator to confirm ffmpeg is rolling before the demo
  //    begins (so we don't lose the opening frames).
  await waitFor(() => fs.existsSync(startMarker), 10000, 'start marker');
  log('start marker seen — demo begins');

  // 4. Load the compiled demo module and execute it.
  const stage  = new Stage({ workspaceRoot: workspace });
  const module = require(demoFile);               // eslint-disable-line @typescript-eslint/no-require-imports
  const record = (module.default ?? module.record ?? module) as (s: Stage) => Promise<void>;
  if (typeof record !== 'function') {
    throw new Error(`Demo module ${demoFile} does not export a default function`);
  }

  try {
    await record(stage);
    log(`demo completed — ${stage.timeline.all().length} events captured`);
  } catch (err) {
    log(`demo threw: ${(err as Error).message}`);
    throw err;
  } finally {
    // 5. Persist the timeline for the overlay pass — even if the demo threw.
    fs.mkdirSync(path.dirname(timelinePath), { recursive: true });
    stage.timeline.writeJson(timelinePath);
  }
}

function log(msg: string): void {
  // eslint-disable-next-line no-console
  console.log(`[runner] ${msg}`);
}

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} environment variable is required`);
  return v;
}

async function waitFor(predicate: () => boolean, timeoutMs: number, what: string): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise(r => setTimeout(r, 100));
  }
  throw new Error(`waitFor timeout: ${what}`);
}
