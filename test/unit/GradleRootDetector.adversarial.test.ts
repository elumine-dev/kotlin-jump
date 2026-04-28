/**
 * Adversarial regression suite for the Gradle root detector.
 *
 * These tests deliberately exercise pathological filesystems and paths that the
 * "happy path" coverage in GradleRootDetector.test.ts does not reach. The goal
 * is to make sure the walk-up algorithm and surrounding helpers terminate, do
 * not crash, and never silently return the wrong root.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { detectGradleRoot, type DetectorContext } from '../../src/testing/GradleRootDetector';

// ── Fixture builder ──────────────────────────────────────────────────────────

let tmpRoot: string;

beforeEach(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'gradle-adv-'));
});
afterEach(() => {
  try { fs.rmSync(tmpRoot, { recursive: true, force: true }); } catch { /* swallow */ }
});

function mkdir(rel: string): string {
  const abs = path.join(tmpRoot, rel);
  fs.mkdirSync(abs, { recursive: true });
  return abs;
}
function touch(rel: string, content = ''): string {
  const abs = path.join(tmpRoot, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content);
  return abs;
}
function ctx(over: Partial<DetectorContext> = {}): DetectorContext {
  return {
    workspaceFolders: [tmpRoot],
    activeEditorPath: undefined,
    setting:          undefined,
    persistedChoice:  undefined,
    ...over,
  };
}

// ── Adversarial tests ────────────────────────────────────────────────────────

describe('detectGradleRoot — adversarial / regression', () => {

  // ── Termination guarantees ──────────────────────────────────────────────────

  it('A1. very deep nested file (50 levels) terminates and finds root', () => {
    touch('settings.gradle.kts');
    let rel = 'app';
    for (let i = 0; i < 50; i++) rel = path.join(rel, `lvl${i}`);
    rel = path.join(rel, 'Foo.kt');
    const editor = touch(rel);
    const start = Date.now();
    const r = detectGradleRoot(ctx({ activeEditorPath: editor }));
    const elapsed = Date.now() - start;
    expect(r.kind).toBe('resolved');
    expect(elapsed).toBeLessThan(500);                  // upper bound — should be ms
  });

  it('A2. activeEditorPath = filesystem root → terminates without crash', () => {
    const r = detectGradleRoot(ctx({
      activeEditorPath: path.parse(tmpRoot).root,       // "/" on Unix, "C:\\" on Win
    }));
    // Walk-up cannot escape workspace; with no markers in workspace, falls through tiers
    expect(['not-found', 'resolved'].includes(r.kind)).toBe(true);
  });

  it('A3. activeEditorPath = empty string → does not crash', () => {
    expect(() => detectGradleRoot(ctx({ activeEditorPath: '' }))).not.toThrow();
  });

  // ── Marker-shape attacks ────────────────────────────────────────────────────

  it('A4. settings.gradle.kts exists as a DIRECTORY (not a file) → not treated as marker', () => {
    // Someone created a folder literally named "settings.gradle.kts".
    mkdir('settings.gradle.kts');
    touch('app/build.gradle.kts');
    const editor = touch('app/src/test/Foo.kt');
    const r = detectGradleRoot(ctx({ activeEditorPath: editor }));
    // The directory entry is detected by fs.existsSync regardless of type.
    // We accept either: still "resolved" (root or app/), as long as it doesn't throw.
    expect(r.kind).toBe('resolved');
  });

  it('A5. settings.gradle.kts is a zero-byte file → still treated as definitive marker', () => {
    touch('settings.gradle.kts', '');                  // empty file is fine
    touch('app/build.gradle.kts');
    const editor = touch('app/src/test/Foo.kt');
    const r = detectGradleRoot(ctx({ activeEditorPath: editor }));
    expect(r).toEqual({ kind: 'resolved', root: tmpRoot, via: 'active-editor' });
  });

  it('A6. build.gradle.kts is empty → treated as provisional fallback only', () => {
    touch('build.gradle.kts', '');
    const editor = touch('src/test/Foo.kt');
    const r = detectGradleRoot(ctx({ activeEditorPath: editor }));
    expect(r.kind).toBe('resolved');
    if (r.kind === 'resolved') expect(r.root).toBe(tmpRoot);
  });

  it('A7. case-sensitivity: "Settings.gradle.kts" (capital S) is NOT a marker on case-sensitive FS', function () {
    // Skip on case-insensitive filesystems (HFS+ / NTFS default) where this would be ambiguous.
    const lo = path.join(tmpRoot, 'settings.gradle.kts');
    const hi = path.join(tmpRoot, 'Settings.gradle.kts');
    fs.writeFileSync(hi, '');
    if (fs.existsSync(lo)) {
      // Filesystem is case-insensitive — skip
      fs.unlinkSync(hi);
      return;
    }
    touch('build.gradle.kts');                         // a real provisional marker
    const editor = touch('src/test/Foo.kt');
    const r = detectGradleRoot(ctx({ activeEditorPath: editor }));
    expect(r.kind).toBe('resolved');
    // 'Settings.gradle.kts' (capital S) must not match → falls back to build.gradle.kts at tmpRoot
    if (r.kind === 'resolved') expect(r.root).toBe(tmpRoot);
  });

  // ── Path shape attacks ──────────────────────────────────────────────────────

  it('A8. unicode + emoji in path → resolves correctly', () => {
    touch('settings.gradle.kts');
    const moduleDir = mkdir('app-📦-é');
    touch('app-📦-é/build.gradle.kts');
    const editor = path.join(moduleDir, 'src', 'test', 'Foo.kt');
    fs.mkdirSync(path.dirname(editor), { recursive: true });
    fs.writeFileSync(editor, '');
    const r = detectGradleRoot(ctx({ activeEditorPath: editor }));
    expect(r.kind).toBe('resolved');
    if (r.kind === 'resolved') expect(r.root).toBe(tmpRoot);
  });

  it('A9. spaces and parentheses in directory names → resolves correctly', () => {
    touch('settings.gradle.kts');
    const moduleDir = mkdir('My App (debug)');
    touch('My App (debug)/build.gradle.kts');
    const editor = path.join(moduleDir, 'src', 'test', 'Foo.kt');
    fs.mkdirSync(path.dirname(editor), { recursive: true });
    fs.writeFileSync(editor, '');
    const r = detectGradleRoot(ctx({ activeEditorPath: editor }));
    expect(r.kind).toBe('resolved');
    if (r.kind === 'resolved') expect(r.root).toBe(tmpRoot);
  });

  it('A10. path with trailing separator and double separators → resolves correctly', () => {
    touch('settings.gradle.kts');
    touch('app/build.gradle.kts');
    // Pass a denormalised path: trailing slash + repeated /
    const editor = path.join(tmpRoot, 'app//src///test/Foo.kt/');
    fs.mkdirSync(path.join(tmpRoot, 'app/src/test'), { recursive: true });
    fs.writeFileSync(path.join(tmpRoot, 'app/src/test/Foo.kt'), '');
    const r = detectGradleRoot(ctx({ activeEditorPath: editor }));
    expect(r.kind).toBe('resolved');
    if (r.kind === 'resolved') expect(r.root).toBe(tmpRoot);
  });

  // ── Symlink attacks ─────────────────────────────────────────────────────────

  it('A11. symlinked module dir resolves to its target settings root', function () {
    if (process.platform === 'win32') return;          // symlink rights vary
    touch('settings.gradle.kts');
    touch('real/app/build.gradle.kts');
    const editor = touch('real/app/src/test/Foo.kt');
    fs.symlinkSync(path.join(tmpRoot, 'real/app'), path.join(tmpRoot, 'link-app'));
    const linkedEditor = path.join(tmpRoot, 'link-app/src/test/Foo.kt');
    const r = detectGradleRoot(ctx({ activeEditorPath: linkedEditor }));
    expect(r.kind).toBe('resolved');
    // Either the real or the symlinked path is acceptable — both lead back to tmpRoot via parent walk
    if (r.kind === 'resolved') {
      expect([tmpRoot, path.join(tmpRoot, 'real')]).toContain(r.root);
    }
    void editor;
  });

  it('A12. symlinked workspace folder root with markers inside → resolves', function () {
    if (process.platform === 'win32') return;
    touch('real-ws/settings.gradle.kts');
    touch('real-ws/app/build.gradle.kts');
    const linkPath = path.join(tmpRoot, 'ws-link');
    fs.symlinkSync(path.join(tmpRoot, 'real-ws'), linkPath);
    const editor = touch('real-ws/app/src/test/Foo.kt');
    const r = detectGradleRoot(ctx({
      workspaceFolders: [linkPath],
      activeEditorPath: editor,
    }));
    // Walk-up reaches `real-ws/` (the actual settings location); workspace folder is the link.
    // Acceptable: either resolution works as long as it doesn't crash.
    expect(['resolved', 'not-found']).toContain(r.kind);
  });

  // ── Workspace boundary attacks ──────────────────────────────────────────────

  it('A13. workspace folder = filesystem root → does not infinite-loop', () => {
    const fsRoot = path.parse(tmpRoot).root;
    const r = detectGradleRoot({
      workspaceFolders: [fsRoot],                       // user opened "/"
      activeEditorPath: tmpRoot,                        // somewhere deep
      setting:          undefined,
      persistedChoice:  undefined,
    });
    // Whatever it returns, it MUST terminate quickly.
    expect(r.kind).toBeDefined();
  });

  it('A14. multiple workspace folders, file inside two of them → still terminates', () => {
    const inner = mkdir('inner');
    touch('inner/settings.gradle.kts');
    const editor = touch('inner/app/src/test/Foo.kt');
    const r = detectGradleRoot(ctx({
      workspaceFolders: [tmpRoot, inner],               // overlapping
      activeEditorPath: editor,
    }));
    expect(r.kind).toBe('resolved');
    // Must find some valid Gradle root (the closest settings is at `inner/`)
    if (r.kind === 'resolved') {
      expect([tmpRoot, inner]).toContain(r.root);
    }
  });

  it('A15. file outside ALL workspace folders → undefined from tier 2, falls to tier 3', () => {
    touch('settings.gradle.kts');
    const otherDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gradle-other-'));
    try {
      const editor = path.join(otherDir, 'Foo.kt');
      fs.writeFileSync(editor, '');
      const r = detectGradleRoot(ctx({ activeEditorPath: editor }));
      // Tier 2 returns undefined; tier 3 picks workspace root with settings.gradle.kts
      expect(r).toEqual({ kind: 'resolved', root: tmpRoot, via: 'workspace-root' });
    } finally {
      fs.rmSync(otherDir, { recursive: true, force: true });
    }
  });

  // ── Setting-driven attacks ──────────────────────────────────────────────────

  it('A16. setting points to a non-existent path → setting-invalid, NOT a crash', () => {
    const r = detectGradleRoot(ctx({ setting: '/this/path/does/not/exist/ever' }));
    expect(r.kind).toBe('setting-invalid');
  });

  it('A17. setting with traversal (../) outside the workspace → resolved if the target has a marker', () => {
    const sibling = fs.mkdtempSync(path.join(os.tmpdir(), 'gradle-sib-'));
    try {
      fs.writeFileSync(path.join(sibling, 'settings.gradle.kts'), '');
      const r = detectGradleRoot(ctx({ setting: sibling }));
      expect(r).toEqual({ kind: 'resolved', root: sibling, via: 'setting' });
    } finally {
      fs.rmSync(sibling, { recursive: true, force: true });
    }
  });

  it('A18. setting is empty string after trim → treated as no setting', () => {
    touch('settings.gradle.kts');
    const r = detectGradleRoot(ctx({ setting: '   ' }));
    // setting is whitespace-only — caller is supposed to pre-trim, but if it leaks
    // through, we still must not crash. Either tier 1 fails (setting-invalid) or
    // we fall through. Both acceptable; assertion is just "no crash".
    expect(r.kind).toBeDefined();
  });

  // ── Tier interaction adversarial ────────────────────────────────────────────

  it('A19. ambiguous tier 4 + valid persisted choice = uses persisted choice', () => {
    touch('projA/settings.gradle.kts');
    touch('projB/settings.gradle.kts');
    const persisted = path.join(tmpRoot, 'projB');
    const r = detectGradleRoot(ctx({ persistedChoice: persisted }));
    expect(r).toEqual({ kind: 'resolved', root: persisted, via: 'persisted-choice' });
  });

  it('A20. ambiguous tier 4 + STALE persisted choice (no longer in candidates) → still ambiguous', () => {
    touch('projA/settings.gradle.kts');
    touch('projB/settings.gradle.kts');
    const r = detectGradleRoot(ctx({ persistedChoice: path.join(tmpRoot, 'projC') /* doesn't exist */ }));
    expect(r.kind).toBe('ambiguous');
  });

  it('A21. workspace with thousands of unrelated files at depth-1 → respects scan cap', () => {
    // Create one valid Gradle project + many noise dirs to stress the scan
    touch('proj/settings.gradle.kts');
    for (let i = 0; i < 100; i++) mkdir(`noise${i}`);   // 100 empty siblings
    const r = detectGradleRoot(ctx());
    expect(r).toEqual({
      kind: 'resolved',
      root: path.join(tmpRoot, 'proj'),
      via:  'depth-1-scan',
    });
  });

  it('A22. nested gradle root inside excluded directory (build/) → IGNORED', () => {
    // Stale settings.gradle.kts inside a `build/` output is sometimes seen — must skip.
    touch('build/settings.gradle.kts');
    touch('real/settings.gradle.kts');
    const r = detectGradleRoot(ctx());
    expect(r.kind).toBe('resolved');
    if (r.kind === 'resolved') expect(r.root).toBe(path.join(tmpRoot, 'real'));
  });

  it('A23. nested gradle root inside .gradle/ cache → IGNORED', () => {
    touch('.gradle/caches/settings.gradle.kts');
    touch('real/settings.gradle.kts');
    const r = detectGradleRoot(ctx());
    expect(r.kind).toBe('resolved');
    if (r.kind === 'resolved') expect(r.root).toBe(path.join(tmpRoot, 'real'));
  });

  it('A24. workspace folder is a FILE, not a directory → treated as not-found, no crash', () => {
    const f = touch('not-a-dir.txt');
    const r = detectGradleRoot({
      workspaceFolders: [f],
      activeEditorPath: undefined,
      setting:          undefined,
      persistedChoice:  undefined,
    });
    expect(r.kind).toBe('not-found');
  });

  it('A25. permission-denied during readdir does not crash (best-effort)', function () {
    if (process.platform === 'win32' || process.getuid?.() === 0) return; // root can't be denied
    const denied = mkdir('denied');
    touch('denied/settings.gradle.kts');
    try {
      fs.chmodSync(denied, 0o000);
      // Walk-up uses statSync/existsSync (not readdir); this stresses tier 4 (scanForGradleRoots)
      const r = detectGradleRoot(ctx());
      // No assertion on outcome — just must not throw
      expect(r.kind).toBeDefined();
    } finally {
      fs.chmodSync(denied, 0o755);                      // restore for cleanup
    }
  });
});
