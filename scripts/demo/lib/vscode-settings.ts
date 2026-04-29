import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { execSync } from 'node:child_process';

export interface AccessibilityToggleHandle {
  restore: () => void;
  variant: string;
  path:    string;
}

interface VariantInfo {
  variant: string;
  userDir: string;
}

/**
 * Map a VS Code-family PID to the User settings directory used by that
 * variant on macOS. Supports Code (stable), Code Insiders, and Cursor —
 * a Cursor or Insiders user picks their own variant when running the
 * demo, so we look at the actual process being recorded rather than
 * hard-coding stable.
 */
function detectVariantFromPid(pid: number): VariantInfo | null {
  let cmd: string;
  try {
    cmd = execSync(`ps -p ${pid} -o command=`, { encoding: 'utf8' }).trim();
  } catch { return null; }
  if (!cmd) return null;

  // ps output looks like: /Applications/Visual Studio Code.app/Contents/MacOS/Electron --type=…
  const m = cmd.match(/\/([^/]+)\.app\//);
  if (!m) return null;
  const appName = m[1];

  let dirName: string;
  switch (appName) {
    case 'Visual Studio Code':            dirName = 'Code';            break;
    case 'Visual Studio Code - Insiders': dirName = 'Code - Insiders'; break;
    case 'Cursor':                        dirName = 'Cursor';          break;
    default: return null;
  }
  return {
    variant: appName,
    userDir: path.join(os.homedir(), 'Library', 'Application Support', dirName, 'User'),
  };
}

/**
 * Set `editor.accessibilitySupport: "on"` on the variant of VS Code that
 * owns the given PID, and return a handle that restores the file
 * byte-for-byte on cleanup.
 *
 * Why we need it: Monaco only exposes its full AX text tree (selection
 * range, character ranges, parameterized string-for-range) when this
 * setting is "on". Without it, `kAXStringForRangeParameterizedAttribute`
 * returns nothing useful, so single-click → word detection in the editor
 * is silently empty.
 *
 * Implementation notes:
 *   - settings.json is JSONC (allows comments). We avoid parsing/serialising
 *     because that would strip comments and reformat. Instead, we either
 *     replace an existing value via regex, or append a single line right
 *     before the closing brace.
 *   - On restore() we write back the EXACT original content. No diff math.
 *   - Returns null if the variant can't be identified or settings.json is
 *     unparseable — caller should treat that as a soft-fail.
 */
export function enableAccessibilitySupport(
  pid: number,
  log: (m: string) => void,
): AccessibilityToggleHandle | null {
  const detected = detectVariantFromPid(pid);
  if (!detected) {
    log(`  ⚠ could not detect VS Code variant for pid ${pid} — accessibility setting not toggled`);
    return null;
  }

  const settingsPath = path.join(detected.userDir, 'settings.json');

  let original: string;
  let createdEmpty = false;
  try {
    original = fs.readFileSync(settingsPath, 'utf8');
  } catch {
    fs.mkdirSync(detected.userDir, { recursive: true });
    fs.writeFileSync(settingsPath, '{}\n');
    original    = '{}\n';
    createdEmpty = true;
  }

  const valueRe = /("editor\.accessibilitySupport"\s*:\s*)("(?:auto|on|off)")/;
  const match   = original.match(valueRe);

  let modified: string;
  if (match) {
    if (match[2] === '"on"') {
      log(`  ✓ ${detected.variant}: editor.accessibilitySupport already "on"`);
      return {
        variant: detected.variant,
        path:    settingsPath,
        restore: () => { /* no-op — was already "on" */ },
      };
    }
    modified = original.replace(valueRe, `$1"on"`);
  } else {
    const lastBrace = original.lastIndexOf('}');
    if (lastBrace === -1) {
      log(`  ⚠ ${settingsPath}: no closing brace — skipping accessibility toggle`);
      return null;
    }
    const before      = original.slice(0, lastBrace).replace(/\s+$/, '');
    const needsComma  = before.length > 0 && !before.endsWith('{') && !before.endsWith(',');
    const insertion   = (needsComma ? ',\n' : '\n') + '  "editor.accessibilitySupport": "on"\n';
    modified = before + insertion + original.slice(lastBrace);
  }

  let mtimeAfterWrite: number;
  try {
    fs.writeFileSync(settingsPath, modified);
    mtimeAfterWrite = fs.statSync(settingsPath).mtimeMs;
  } catch (e) {
    log(`  ⚠ could not write ${settingsPath}: ${(e as Error).message}`);
    if (createdEmpty) { try { fs.unlinkSync(settingsPath); } catch { /* nothing */ } }
    return null;
  }

  log(`  ✓ ${detected.variant}: enabled editor.accessibilitySupport (will restore on exit)`);

  return {
    variant: detected.variant,
    path:    settingsPath,
    restore: () => {
      // If the user edited settings.json manually during the demo (or VS
      // Code rewrote it via a Settings UI change), the mtime won't match.
      // In that case, do NOT clobber their edits — leave the setting in
      // place and tell them to revert if they care.
      try {
        const currentMtime = fs.statSync(settingsPath).mtimeMs;
        if (currentMtime !== mtimeAfterWrite) {
          log(`  ⚠ ${settingsPath} was modified during the demo — leaving editor.accessibilitySupport in place to avoid clobbering external edits.`);
          return;
        }
        if (createdEmpty) {
          fs.unlinkSync(settingsPath);
        } else {
          fs.writeFileSync(settingsPath, original);
        }
      } catch (e) {
        log(`  ⚠ failed to restore ${settingsPath}: ${(e as Error).message}`);
      }
    },
  };
}
