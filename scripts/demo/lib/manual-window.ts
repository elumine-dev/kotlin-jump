/**
 * Window detection & positioning for the manual demo recorder.
 *
 * Unlike `record.ts` which positions an Extension Development Host window
 * launched by `@vscode/test-electron`, manual mode operates on the user's
 * real VS Code window — the one with their Copilot auth, adb config,
 * Android emulator connection, etc. These states cannot be reproduced in
 * a sandboxed dev host, so we must work on the live window.
 *
 * Safety: every function that MUTATES a user window (position / size) also
 * reads the original rect first, so the orchestrator can restore it in its
 * cleanup() path even on SIGINT / watchdog / crash. Without that, a Ctrl+C
 * during recording would leave the user's VS Code stuck at 1280×720 in the
 * top-left corner with no explanation.
 */

import { execSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as readline from 'node:readline';

export interface WindowRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface UserVSCodeWindow {
  pid:          number;
  originalRect: WindowRect;
  windowTitle:  string;
}

/** Defaults to "Code" (stable). Set to "Code - Insiders" for Insiders. */
const APP_NAME = process.env.KJ_DEMO_VSCODE_APP_NAME ?? 'Code';

/**
 * List every VS Code window that is NOT an Extension Development Host. The
 * EDH filter is critical: a concurrent `kjdemo <name>` run would create an
 * EDH, and we must not offer to record IT by mistake — that would defeat
 * the whole point of manual mode (we want the user's live state).
 */
export function listUserVSCodeWindows(): UserVSCodeWindow[] {
  if (process.platform !== 'darwin') {
    throw new Error('Manual demo recording is only implemented on macOS');
  }

  const script = `on run
  tell application "System Events"
    set codeProcs to (every application process whose name is "${APP_NAME}")
    set output to ""
    repeat with p in codeProcs
      set procPid to unix id of p
      try
        repeat with w in (every window of p)
          try
            set wName to (name of w) as string
            if wName does not contain "Extension Development Host" ¬
               and wName does not contain "KJ_DEMO_RECORDING_WINDOW" then
              set pos to position of w
              set sz to size of w
              set output to output & procPid & "|" & wName & "|" ¬
                & (item 1 of pos) & "," & (item 2 of pos) & "," ¬
                & (item 1 of sz) & "," & (item 2 of sz) & linefeed
            end if
          end try
        end repeat
      end try
    end repeat
    return output
  end tell
end run
`;
  const scriptFile = path.join(os.tmpdir(), `kj-demo-list-user-windows-${process.pid}.applescript`);
  fs.writeFileSync(scriptFile, script);
  try {
    const out = execSync(`osascript ${JSON.stringify(scriptFile)}`, { encoding: 'utf8', timeout: 5000 }).trim();
    if (!out) return [];
    return out.split('\n').map((line, idx) => {
      const parts = line.split('|');
      if (parts.length !== 3) {
        throw new Error(`Unexpected window line ${idx}: ${JSON.stringify(line)}`);
      }
      const [pidStr, title, rectStr] = parts;
      const pid = parseInt(pidStr.trim(), 10);
      const [x, y, w, h] = rectStr.trim().split(',').map(n => parseInt(n.trim(), 10));
      if ([pid, x, y, w, h].some(n => Number.isNaN(n))) {
        throw new Error(`Non-numeric window coords on line ${idx}: ${JSON.stringify(line)}`);
      }
      return {
        pid,
        windowTitle:  title,
        originalRect: { x, y, w, h },
      };
    });
  } finally {
    try { fs.rmSync(scriptFile, { force: true }); } catch { /* best-effort */ }
  }
}

/**
 * Pick the VS Code window to record. Priority:
 *   1. `KJ_DEMO_USER_VSCODE_PID` env var → use that PID's first window (no prompt)
 *   2. Exactly one window → use it (no prompt)
 *   3. Multiple → interactive prompt
 *   4. Zero → actionable error
 */
export async function pickUserVSCodeWindow(log: (msg: string) => void): Promise<UserVSCodeWindow> {
  const windows = listUserVSCodeWindows();
  if (windows.length === 0) {
    throw new Error(
      `No VS Code user window detected (process name="${APP_NAME}").\n` +
      `  Open VS Code with the workspace you want to record, then retry.\n` +
      `  If you use Insiders: set KJ_DEMO_VSCODE_APP_NAME="Code - Insiders".`,
    );
  }

  const pidOverride = process.env.KJ_DEMO_USER_VSCODE_PID;
  if (pidOverride) {
    const pid = parseInt(pidOverride, 10);
    const match = windows.find(w => w.pid === pid);
    if (!match) {
      throw new Error(
        `KJ_DEMO_USER_VSCODE_PID=${pidOverride} but no VS Code window found for that PID.\n` +
        `  Available PIDs: ${windows.map(w => w.pid).join(', ')}`,
      );
    }
    log(`  Using VS Code window via KJ_DEMO_USER_VSCODE_PID: "${match.windowTitle}" (pid ${match.pid})`);
    return match;
  }

  if (windows.length === 1) {
    log(`  VS Code user window: "${windows[0].windowTitle}" (pid ${windows[0].pid})`);
    return windows[0];
  }

  log(`  VS Code user windows detected:`);
  for (let i = 0; i < windows.length; i++) {
    log(`    ${i + 1}. "${windows[i].windowTitle}" (pid ${windows[i].pid})`);
  }

  const choice = await promptNumber(
    `  Which window to record? [1-${windows.length}, default=1]: `,
    1, windows.length,
  );
  const picked = windows[choice - 1];
  log(`  Selected: "${picked.windowTitle}" (pid ${picked.pid})`);
  return picked;
}

async function promptNumber(prompt: string, min: number, max: number): Promise<number> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    for (;;) {
      const answer = await new Promise<string>(r => rl.question(prompt, r));
      const trimmed = answer.trim();
      if (trimmed === '') return min;
      const n = parseInt(trimmed, 10);
      if (Number.isNaN(n) || n < min || n > max) {
        process.stdout.write(`  Invalid choice. Enter a number between ${min} and ${max} (blank = ${min}).\n`);
        continue;
      }
      return n;
    }
  } finally {
    rl.close();
  }
}

/**
 * Confirm with the user before resizing their window. Returns true if they
 * typed "y" or "yes" (case-insensitive). Anything else, including blank, is
 * treated as "no" — resizing someone's VS Code by accident is bad UX.
 */
export async function confirmResize(
  original: WindowRect,
  target:   WindowRect,
  log:      (msg: string) => void,
): Promise<boolean> {
  log(`  ⚠ Target window will be resized to ${target.w}×${target.h} at (${target.x},${target.y}).`);
  log(`    Current: ${original.w}×${original.h} at (${original.x},${original.y}).`);
  log(`    Position will be restored after recording.`);

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = await new Promise<string>(r => rl.question('    Continue? [y/N]: ', r));
    return /^y(es)?$/i.test(answer.trim());
  } finally {
    rl.close();
  }
}

/**
 * Position the user's VS Code window at `target` and return the realised
 * rect (AppleScript reports back actual values, which may be clamped to
 * display bounds or tweaked by the WM).
 */
export function positionUserVSCodeWindow(pid: number, target: WindowRect): WindowRect {
  if (process.platform !== 'darwin') {
    throw new Error('Manual demo recording is only implemented on macOS');
  }
  const script = `on run
  tell application "System Events"
    try
      set targetProc to first application process whose unix id is ${pid}
    on error
      return "ERROR:no-process-with-pid-${pid}"
    end try
    try
      set allWins to (every window of targetProc)
    on error errMsg
      return "ERROR:window-list-failed; " & errMsg
    end try
    if (count of allWins) = 0 then return "ERROR:no-windows-for-pid-${pid}"
    set targetWindow to item 1 of allWins
    set frontmost of targetProc to true
    set position of targetWindow to {${target.x}, ${target.y}}
    set size of targetWindow to {${target.w}, ${target.h}}
    try
      perform action "AXRaise" of targetWindow
    end try
    delay 0.3
    set pos to position of targetWindow
    set sz to size of targetWindow
    return ((item 1 of pos) as string) & "," & ((item 2 of pos) as string) & "," ¬
      & ((item 1 of sz) as string) & "," & ((item 2 of sz) as string)
  end tell
end run
`;
  return runAppleScriptReturningRect(script, `position-${pid}`);
}

/**
 * Restore a window's rect. Called from cleanup paths (including SIGINT /
 * watchdog), so this MUST NOT throw — swallow errors and let the orchestrator
 * log them. The user already has bigger problems if we're in cleanup.
 */
export function restoreWindowRect(pid: number, rect: WindowRect): void {
  if (process.platform !== 'darwin') return;
  const script = `on run
  tell application "System Events"
    try
      set targetProc to first application process whose unix id is ${pid}
    on error
      return "ERROR:no-process-with-pid-${pid}"
    end try
    try
      set allWins to (every window of targetProc)
    on error
      return "ERROR:window-list-failed"
    end try
    if (count of allWins) = 0 then return "ERROR:no-windows-for-pid-${pid}"
    set targetWindow to item 1 of allWins
    set position of targetWindow to {${rect.x}, ${rect.y}}
    set size of targetWindow to {${rect.w}, ${rect.h}}
    return "OK"
  end tell
end run
`;
  const scriptFile = path.join(os.tmpdir(), `kj-demo-manual-window-restore-${pid}-${process.pid}.applescript`);
  try {
    fs.writeFileSync(scriptFile, script);
    execSync(`osascript ${JSON.stringify(scriptFile)}`, { encoding: 'utf8', timeout: 5000 });
  } catch {
    // best-effort — cleanup path cannot propagate errors
  } finally {
    try { fs.rmSync(scriptFile, { force: true }); } catch { /* best-effort */ }
  }
}

function runAppleScriptReturningRect(script: string, tag: string): WindowRect {
  const scriptFile = path.join(os.tmpdir(), `kj-demo-manual-window-${tag}-${process.pid}.applescript`);
  fs.writeFileSync(scriptFile, script);
  try {
    const out = execSync(`osascript ${JSON.stringify(scriptFile)}`, { encoding: 'utf8', timeout: 5000 }).trim();
    if (!out || out.startsWith('ERROR:')) throw new Error(out || 'empty osascript output');
    const parts = out.split(',').map(s => parseInt(s.trim(), 10));
    if (parts.length !== 4 || parts.some(n => Number.isNaN(n))) {
      throw new Error(`unexpected osascript output: ${JSON.stringify(out)}`);
    }
    return { x: parts[0], y: parts[1], w: parts[2], h: parts[3] };
  } finally {
    try { fs.rmSync(scriptFile, { force: true }); } catch { /* best-effort */ }
  }
}
