import * as fs from 'fs';
import * as path from 'path';
import type { Logger } from '../util/logger';

// ── Types ────────────────────────────────────────────────────────────────────

export type DetectionSource =
  | 'setting'
  | 'active-editor'
  | 'workspace-root'
  | 'depth-1-scan'
  | 'persisted-choice'
  | 'fallback';

export type DetectionResult =
  | { kind: 'resolved';        root: string;        via: DetectionSource }
  | { kind: 'ambiguous';       candidates: string[] }
  | { kind: 'setting-invalid'; settingPath: string }
  | { kind: 'not-found' };

export interface DetectorContext {
  workspaceFolders: readonly string[];      // absolute paths
  activeEditorPath: string | undefined;     // absolute path of open file
  setting:          string | undefined;     // kotlinJump.gradleProjectRoot (raw)
  persistedChoice:  string | undefined;     // workspaceState-saved choice among ambiguous candidates
}

// ── Constants ────────────────────────────────────────────────────────────────

/** Files that mark a Gradle project root (priority ordered: settings.* > build.*). */
export const GRADLE_MARKERS = [
  'settings.gradle.kts',
  'settings.gradle',
  'build.gradle.kts',
  'build.gradle',
] as const;

/**
 * A `settings.gradle(.kts)` *definitively* marks a Gradle build root (per Gradle's own
 * https://docs.gradle.org/current/userguide/multi_project_builds.html walk-up rule).
 */
const SETTINGS_MARKERS = ['settings.gradle.kts', 'settings.gradle'] as const;
/**
 * A bare `build.gradle(.kts)` is only *provisionally* a root — it may belong to a
 * module if a settings file exists higher up the tree.
 */
const BUILD_MARKERS = ['build.gradle.kts', 'build.gradle'] as const;

/** Directories always skipped when scanning depth-1 — never contain a Gradle root. */
export const SCAN_EXCLUDE_DIRS: ReadonlySet<string> = new Set([
  'node_modules', '.git', '.gradle', '.idea', '.vscode', '.vscode-test',
  'build', 'dist', 'out', 'coverage', '__pycache__',
  'tmp', '.next', '.turbo', '.cache',
]);

/** Hard cap on entries read per directory (guards pathological monorepos). */
export const SCAN_CAP = 500;

/**
 * How many directory levels to descend when scanning for Gradle roots.
 * depth=2 covers `kotlin-nav/test/kotlin-jump-demo/` (a very common layout).
 * Excluded dirs are never descended into, regardless of depth.
 */
export const SCAN_MAX_DEPTH = 2;

// ── Public entry point ───────────────────────────────────────────────────────

/**
 * Resolves the Gradle root using a 5-tier algorithm (priority order):
 *   1. `kotlinJump.gradleProjectRoot` setting (absolute or workspace-relative)
 *   2. Walk up from the active editor's file
 *   3. Root of any workspace folder with a Gradle marker
 *   4. Depth-1 scan of workspace folders (monorepos)
 *   5. Fallback: `not-found` (caller decides what to surface)
 *
 * Returns a structured result so the caller can render appropriate UX
 * (resolved / ambiguous / setting-invalid / not-found).
 */
export function detectGradleRoot(ctx: DetectorContext, log?: Logger): DetectionResult {
  log?.debug(`[gradle:detect] start — folders=[${ctx.workspaceFolders.join(', ')}] editor=${ctx.activeEditorPath ?? '∅'} setting=${ctx.setting ?? '∅'}`);

  // ── Tier 1 — Explicit setting ─────────────────────────────────────────────
  if (ctx.setting && ctx.setting.trim().length > 0) {
    const resolved = path.isAbsolute(ctx.setting)
      ? ctx.setting
      : path.resolve(ctx.workspaceFolders[0] ?? '', ctx.setting);

    if (hasGradleMarker(resolved)) {
      log?.debug(`[gradle:detect] (1) setting → ${resolved} ✓`);
      return { kind: 'resolved', root: resolved, via: 'setting' };
    }
    log?.warn(`[gradle:detect] (1) setting → ${resolved} ✗ (missing or no Gradle marker)`);
    return { kind: 'setting-invalid', settingPath: resolved };
  }

  // ── Tier 2 — Active editor walk-up ────────────────────────────────────────
  if (ctx.activeEditorPath) {
    const walked = walkUpToGradleRoot(ctx.activeEditorPath, ctx.workspaceFolders);
    if (walked) {
      log?.debug(`[gradle:detect] (2) active editor → ${walked} ✓`);
      return { kind: 'resolved', root: walked, via: 'active-editor' };
    }
  }

  // ── Tier 3 — Workspace folder roots (legacy behaviour) ────────────────────
  for (const folder of ctx.workspaceFolders) {
    if (hasGradleMarker(folder)) {
      log?.debug(`[gradle:detect] (3) workspace root → ${folder} ✓`);
      return { kind: 'resolved', root: folder, via: 'workspace-root' };
    }
  }

  // ── Tier 4 — Scan workspace folders (up to SCAN_MAX_DEPTH deep) ───────────
  const seen = new Set<string>();
  const candidates: string[] = [];
  for (const folder of ctx.workspaceFolders) {
    for (const hit of scanForGradleRoots(folder, SCAN_MAX_DEPTH, log)) {
      if (!seen.has(hit)) { seen.add(hit); candidates.push(hit); }
    }
  }

  if (candidates.length === 1) {
    log?.debug(`[gradle:detect] (4) depth-1 → ${candidates[0]} ✓`);
    return { kind: 'resolved', root: candidates[0], via: 'depth-1-scan' };
  }
  if (candidates.length >= 2) {
    if (ctx.persistedChoice && candidates.includes(ctx.persistedChoice)) {
      log?.debug(`[gradle:detect] (4) depth-1 → ${ctx.persistedChoice} (persisted choice) ✓`);
      return { kind: 'resolved', root: ctx.persistedChoice, via: 'persisted-choice' };
    }
    log?.warn(`[gradle:detect] (4) depth-1 found ${candidates.length} candidates: [${candidates.join(', ')}] — ambiguous`);
    return { kind: 'ambiguous', candidates };
  }

  // ── Tier 5 — Not found ────────────────────────────────────────────────────
  log?.warn(`[gradle:detect] (5) no Gradle project found in workspace`);
  return { kind: 'not-found' };
}

// ── Internals ────────────────────────────────────────────────────────────────

function hasSettingsMarker(dir: string): boolean {
  return SETTINGS_MARKERS.some(m => fs.existsSync(path.join(dir, m)));
}

function hasBuildMarker(dir: string): boolean {
  return BUILD_MARKERS.some(m => fs.existsSync(path.join(dir, m)));
}

function hasGradleMarker(dir: string): boolean {
  try {
    if (!fs.statSync(dir).isDirectory()) return false;
  } catch { return false; }
  return hasSettingsMarker(dir) || hasBuildMarker(dir);
}

/**
 * Walks up from `startPath` looking for the canonical Gradle build root.
 *
 * Per Gradle's own rule (https://docs.gradle.org/current/userguide/multi_project_builds.html),
 * a `settings.gradle(.kts)` *definitively* marks a build root. A `build.gradle(.kts)` may
 * belong to a module — we only treat it as the root if no settings file exists higher up
 * the tree (within the workspace boundary).
 *
 * Stays strictly within `workspaceFolders` (never escalates above the open folder).
 */
function walkUpToGradleRoot(startPath: string, workspaceFolders: readonly string[]): string | undefined {
  let current = fs.existsSync(startPath) && fs.statSync(startPath).isDirectory()
    ? startPath
    : path.dirname(startPath);

  let fallbackBuildRoot: string | undefined;

  while (current) {
    if (workspaceFolders.length > 0 && !isWithinAny(current, workspaceFolders)) break;

    if (hasSettingsMarker(current)) return current;
    if (!fallbackBuildRoot && hasBuildMarker(current)) {
      fallbackBuildRoot = current;
    }

    const next = path.dirname(current);
    if (next === current) break;
    current = next;
  }
  return fallbackBuildRoot;
}

function isWithinAny(p: string, roots: readonly string[]): boolean {
  const normalized = path.resolve(p);
  return roots.some(r => {
    const nr = path.resolve(r);
    return normalized === nr || normalized.startsWith(nr + path.sep);
  });
}

/**
 * Scans descendants of `root` up to `remainingDepth` levels deep for Gradle
 * roots. Once a directory is identified as a Gradle root, its subtree is NOT
 * descended (the root of a multi-module build hides its sub-modules).
 * Excluded directories are never entered, regardless of depth.
 */
function scanForGradleRoots(root: string, remainingDepth: number, log?: Logger): string[] {
  if (remainingDepth <= 0) return [];

  const hits: string[] = [];
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(root, { withFileTypes: true });
  } catch (err) {
    log?.debug(`[gradle:detect] scan ${root} — unreadable (${err})`);
    return hits;
  }

  if (entries.length > SCAN_CAP) {
    log?.warn(`[gradle:detect] scan cap hit at ${root} (${entries.length} entries > ${SCAN_CAP})`);
  }

  for (const entry of entries.slice(0, SCAN_CAP)) {
    if (SCAN_EXCLUDE_DIRS.has(entry.name)) continue;
    if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;

    const child = path.join(root, entry.name);
    if (hasGradleMarker(child)) {
      hits.push(child);
      // Don't descend into a Gradle root — its inner modules are part of the same build.
      continue;
    }
    if (remainingDepth > 1) {
      hits.push(...scanForGradleRoots(child, remainingDepth - 1, log));
    }
  }
  return hits;
}
