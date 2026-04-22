import * as fs from 'fs/promises';
import * as path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import * as vscode from 'vscode';

const exec = promisify(execFile);

/**
 * Result of locating a JDK home with sources.
 *
 * `jdkHome` is the JAVA_HOME-style directory (contains `bin/`, `lib/`,
 * `conf/` etc.). `srcZip` is the path to `lib/src.zip` (present in
 * standard OpenJDK distributions since JDK 9). When `srcZip` is
 * `undefined`, the JDK was found but no sources are bundled — the
 * caller should surface a "install OpenJDK with sources" hint via UI.
 */
export interface JdkLocation {
  jdkHome: string;
  /** Path to lib/src.zip, or undefined if absent. */
  srcZip:  string | undefined;
  /** Major version (8, 11, 17, 21, …) when detectable from path/name. */
  majorVersion?: number;
  /** How this JDK was located (for diagnostics). */
  source: 'setting' | 'env' | 'macos-libexec' | 'linux-update-alts' | 'linux-scan' | 'windows-scan';
}

/**
 * Resolves a JDK home suitable for sources indexing. Returns `undefined`
 * if no JDK can be located on the host.
 *
 * Priority order:
 *   1. `kotlinJump.jdkHome` setting (user override, absolute)
 *   2. `JAVA_HOME` environment variable
 *   3. Platform-specific defaults:
 *      - macOS: `/usr/libexec/java_home` (multi-JDK aware via `-v`)
 *      - Linux: `update-alternatives --query java` parsing
 *      - Windows: filesystem scan of common install dirs
 *
 * When multiple JDKs are detected, prefers JDK 17+ (the most common
 * baseline for modern Kotlin), then most recent version.
 *
 * The function never throws — silent fallback to `undefined` so the
 * extension stays functional even on machines without a JDK.
 */
export async function detectJdkHome(): Promise<JdkLocation | undefined> {
  // 1. Setting override (absolute priority)
  const settingPath = vscode.workspace
    .getConfiguration('kotlinJump')
    .get<string>('jdkHome', '')
    .trim();
  if (settingPath) {
    const validated = await validateJdk(settingPath, 'setting');
    if (validated) return validated;
    // Fall through if setting points to invalid path — try other methods.
  }

  // 2. JAVA_HOME env var (most common)
  const envHome = (process.env['JAVA_HOME'] ?? '').trim();
  if (envHome) {
    const validated = await validateJdk(envHome, 'env');
    if (validated) return validated;
  }

  // 3. Platform-specific
  const platform = process.platform;
  if (platform === 'darwin') return detectMacOs();
  if (platform === 'linux')  return detectLinux();
  if (platform === 'win32')  return detectWindows();
  return undefined;
}

/** Validates that `home` is a usable JDK directory and locates `lib/src.zip`. */
async function validateJdk(
  home: string,
  source: JdkLocation['source'],
): Promise<JdkLocation | undefined> {
  try {
    const stat = await fs.stat(home);
    if (!stat.isDirectory()) return undefined;
  } catch { return undefined; }

  // Require at least bin/java(.exe) or bin/javac(.exe) to confirm it's a JDK.
  const binDir = path.join(home, 'bin');
  const javaExe = process.platform === 'win32' ? 'java.exe' : 'java';
  try {
    await fs.access(path.join(binDir, javaExe));
  } catch { return undefined; }

  const srcZipPath = path.join(home, 'lib', 'src.zip');
  let srcZip: string | undefined;
  try {
    await fs.access(srcZipPath);
    srcZip = srcZipPath;
  } catch { srcZip = undefined; }

  const majorVersion = parseJdkVersionFromPath(home);
  return { jdkHome: home, srcZip, majorVersion, source };
}

/** Extracts a major version digit from a JDK path (e.g. "jdk-17.0.5" → 17). */
function parseJdkVersionFromPath(home: string): number | undefined {
  // Match patterns like jdk-17, jdk-11.0.5, jdk1.8.0_322 (legacy), 21.0.2-tem
  const m = path.basename(home).match(/(?:jdk[-_]?)?(\d+)(?:\.(\d+))?/i);
  if (!m) return undefined;
  const major = parseInt(m[1], 10);
  // Legacy "1.8" naming: "1" is the spec version, real major is the next digit.
  if (major === 1 && m[2]) return parseInt(m[2], 10);
  return major;
}

// ── Platform detectors ───────────────────────────────────────────────────────

async function detectMacOs(): Promise<JdkLocation | undefined> {
  // Try preferred versions first (17+ for modern Kotlin), then default.
  const preferredVersions = [21, 17, 11, 8];
  for (const v of preferredVersions) {
    const home = await runJavaHomeCmd(['-v', String(v)]);
    if (home) {
      const validated = await validateJdk(home, 'macos-libexec');
      if (validated) return validated;
    }
  }
  // Fallback: no version filter.
  const def = await runJavaHomeCmd([]);
  if (def) {
    const validated = await validateJdk(def, 'macos-libexec');
    if (validated) return validated;
  }
  return undefined;
}

async function runJavaHomeCmd(args: string[]): Promise<string | undefined> {
  try {
    const { stdout } = await exec('/usr/libexec/java_home', args, { timeout: 3000 });
    const home = stdout.trim();
    return home || undefined;
  } catch { return undefined; }
}

async function detectLinux(): Promise<JdkLocation | undefined> {
  // 1. update-alternatives — gives the system default java's path; we then
  //    walk back to the JDK home (it points to bin/java).
  try {
    const { stdout } = await exec('update-alternatives', ['--query', 'java'], { timeout: 3000 });
    const m = /^Best:\s*(.+)$/m.exec(stdout) || /^Value:\s*(.+)$/m.exec(stdout);
    if (m) {
      // Path like /usr/lib/jvm/java-17-openjdk-amd64/bin/java → climb 2 levels.
      const javaPath = m[1].trim();
      const home = path.dirname(path.dirname(javaPath));
      const validated = await validateJdk(home, 'linux-update-alts');
      if (validated) return validated;
    }
  } catch { /* update-alternatives not available — fall through */ }

  // 2. Scan /usr/lib/jvm/ for jdk-* directories.
  const jvmDir = '/usr/lib/jvm';
  try {
    const entries = await fs.readdir(jvmDir);
    const candidates: { home: string; version: number | undefined }[] = [];
    for (const entry of entries) {
      const home = path.join(jvmDir, entry);
      const validated = await validateJdk(home, 'linux-scan');
      if (validated) candidates.push({ home, version: validated.majorVersion });
    }
    return pickPreferredJdk(candidates, 'linux-scan');
  } catch { return undefined; }
}

async function detectWindows(): Promise<JdkLocation | undefined> {
  const candidates: { home: string; version: number | undefined }[] = [];
  // Common install roots — Oracle/OpenJDK + Eclipse Adoptium (Temurin) +
  // Microsoft Build of OpenJDK + Amazon Corretto.
  const roots = [
    'C:\\Program Files\\Java',
    'C:\\Program Files\\Eclipse Adoptium',
    'C:\\Program Files\\Microsoft\\jdk',
    'C:\\Program Files\\Amazon Corretto',
  ];
  for (const root of roots) {
    try {
      const entries = await fs.readdir(root);
      for (const entry of entries) {
        const home = path.join(root, entry);
        const validated = await validateJdk(home, 'windows-scan');
        if (validated) candidates.push({ home, version: validated.majorVersion });
      }
    } catch { /* root missing */ }
  }
  return pickPreferredJdk(candidates, 'windows-scan');
}

async function pickPreferredJdk(
  candidates: { home: string; version: number | undefined }[],
  source: JdkLocation['source'],
): Promise<JdkLocation | undefined> {
  if (candidates.length === 0) return undefined;
  // Prefer JDK 17+ (modern Kotlin baseline); within that, prefer most recent.
  candidates.sort((a, b) => {
    const va = a.version ?? 0;
    const vb = b.version ?? 0;
    const inMod = (v: number) => (v >= 17 ? 1 : 0);
    if (inMod(va) !== inMod(vb)) return inMod(vb) - inMod(va);
    return vb - va;
  });
  const best = candidates[0];
  // Re-validate to retrieve srcZip path + final flags.
  return validateJdk(best.home, source);
}
