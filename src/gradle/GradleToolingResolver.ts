import { execFile } from 'child_process';
import * as fs from 'fs/promises';
import * as fsSync from 'fs';
import * as os from 'os';
import * as path from 'path';
import { promisify } from 'util';
import { detectProjectRoot } from '../testing/GradleTestRunner';
import type { Logger } from '../util/logger';

const execFileAsync = promisify(execFile);

/**
 * Gradle Tooling Resolver — opt-in, zero-JVM approach.
 *
 * Spawns `./gradlew` (or `gradlew.bat` on Windows) with a lightweight Groovy
 * init script that resolves source JARs for the current project and prints their
 * absolute paths to stdout.
 *
 * Returns `null` on any failure (Gradle unavailable, resolution error, timeout)
 * so the caller can fall back transparently to the full filesystem scan.
 *
 * Activation: set `kotlinJump.useGradleTooling: true` (default: false).
 * Timeout:    controlled by `kotlinJump.gradleToolingTimeoutMs` (default: 30 000 ms).
 */

// ── Init script ───────────────────────────────────────────────────────────────

/**
 * Groovy init script injected via `--init-script`.
 * Registers a task `:kotlinJumpListSources` that iterates all resolvable
 * configurations, collects `sources` artifacts, and prints their paths.
 */
const INIT_SCRIPT = `
allprojects {
  tasks.register('kotlinJumpListSources') {
    doLast {
      def seen = [] as Set
      configurations.each { config ->
        if (!config.canBeResolved) return
        try {
          config.incoming.artifactView {
            attributes {
              attribute(
                Attribute.of('artifactType', String),
                'sources'
              )
            }
            lenient(true)
          }.artifacts.each { artifact ->
            def f = artifact.file
            if (f.exists() && f.name.endsWith('-sources.jar') && seen.add(f.absolutePath)) {
              println f.absolutePath
            }
          }
        } catch (ignored) {}
      }
    }
  }
}
`;

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Attempts to resolve the exact set of source JARs for the given workspace folder
 * by spawning `./gradlew kotlinJumpListSources`.
 *
 * @returns Array of absolute source JAR paths, or `null` when unavailable / failed.
 */
export async function resolveSourceJarPaths(
  workspaceRoot: string,
  timeoutMs = 30_000,
  log?: Logger,
): Promise<string[] | null> {
  // Use the detected Gradle project root (falls back to the workspace folder).
  // Handles structures where gradlew is not at the workspace root (e.g. koin/projects/).
  const detection = detectProjectRoot(log);
  const projectRoot = detection.kind === 'resolved' ? detection.root : workspaceRoot;

  const gradlew = findGradleWrapper(projectRoot);
  if (!gradlew) return null;

  const initScript = await writeInitScript();
  if (!initScript) return null;

  try {
    const { stdout } = await execFileAsync(
      gradlew,
      ['-q', '--init-script', initScript, '--no-daemon', 'kotlinJumpListSources'],
      { cwd: projectRoot, timeout: timeoutMs },
    );

    const paths = stdout
      .split('\n')
      .map(l => l.trim())
      .filter(l => l.endsWith('-sources.jar') && fsSync.existsSync(l));

    return paths.length > 0 ? paths : null;
  } catch {
    return null; // Gradle failed — caller falls back to filesystem scan
  } finally {
    fs.unlink(initScript).catch(() => {});
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function findGradleWrapper(projectRoot: string): string | null {
  // Platform-aware ordering: Windows prefers .bat, Unix prefers bare wrapper.
  // Tries both so Git Bash on Windows or Unix-with-only-.bat layouts still work.
  const candidates = process.platform === 'win32'
    ? ['gradlew.bat', 'gradlew']
    : ['gradlew', 'gradlew.bat'];
  for (const name of candidates) {
    const c = path.join(projectRoot, name);
    if (fsSync.existsSync(c)) return c;
  }
  return null;
}

async function writeInitScript(): Promise<string | null> {
  const tmpPath = path.join(os.tmpdir(), `kotlin-jump-init-${process.pid}.gradle`);
  try {
    await fs.writeFile(tmpPath, INIT_SCRIPT, 'utf8');
    return tmpPath;
  } catch {
    return null;
  }
}
