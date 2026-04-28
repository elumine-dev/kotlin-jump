/**
 * Integration tests — full Gradle root → wrapper → module-path pipeline.
 *
 * Builds REAL filesystem fixtures (mkdtempSync) for representative project
 * structures and exercises the entire chain:
 *
 *     activeEditor → detectGradleRoot()
 *                  → resolveGradleWrapper()
 *                  → findGradleModuleByPath()
 *                  → final spawn args
 *
 * No mocking of `fs` — these tests pass only if the algorithm makes correct
 * decisions on a real filesystem the way it would in production. They are the
 * regression net for issue #1.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';

import { detectGradleRoot, type DetectorContext } from '../../src/testing/GradleRootDetector';
import {
  resolveGradleWrapper,
  findGradleModuleByPath,
  GradleWrapperNotFoundError,
} from '../../src/testing/GradleTestRunner';

// ── Test harness ─────────────────────────────────────────────────────────────

let tmpRoot: string;

beforeEach(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'gradle-int-'));
});
afterEach(() => {
  fs.rmSync(tmpRoot, { recursive: true, force: true });
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
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
function touchExec(rel: string): string {
  const abs = touch(rel, '#!/bin/sh\nexit 0\n');
  fs.chmodSync(abs, 0o755);
  return abs;
}
function asUnix() { vi.stubGlobal('process', { ...process, platform: 'linux' }); }
function asWin()  { vi.stubGlobal('process', { ...process, platform: 'win32' }); }

function ctx(over: Partial<DetectorContext> = {}): DetectorContext {
  return {
    workspaceFolders: [tmpRoot],
    activeEditorPath: undefined,
    setting:          undefined,
    persistedChoice:  undefined,
    ...over,
  };
}

/** Runs the full pipeline and returns what we'd actually spawn. */
function fullPipeline(activeEditor: string, ws = [tmpRoot]): {
  projectRoot: string;
  gradlew: string;
  module: string;
  task: string;
} {
  const det = detectGradleRoot(ctx({ workspaceFolders: ws, activeEditorPath: activeEditor }));
  if (det.kind !== 'resolved') {
    throw new Error(`detection failed: ${det.kind}`);
  }
  const projectRoot = det.root;
  const gradlew = resolveGradleWrapper(projectRoot);
  const module = findGradleModuleByPath(activeEditor, projectRoot);
  const task = module ? `${module}:test` : 'test';
  return { projectRoot, gradlew, module, task };
}

// ── Integration tests ────────────────────────────────────────────────────────

describe('Gradle pipeline — full integration (real fs)', () => {

  // ── I1. The exact bug from issue #1 ─────────────────────────────────────────

  it('I1. Android-style multi-module: gradlew at root, build.gradle in app, test in app/src', () => {
    asUnix();
    touch('settings.gradle.kts', "include(':app', ':lib:sub')");
    touch('build.gradle.kts');
    touchExec('gradlew');
    touch('app/build.gradle.kts');
    touch('lib/sub/build.gradle.kts');
    const editor = touch('app/src/test/kotlin/com/example/FooTest.kt');

    const r = fullPipeline(editor);

    expect(r.projectRoot).toBe(tmpRoot);                                    // not app/
    expect(r.gradlew).toBe(path.join(tmpRoot, 'gradlew'));                  // not app/gradlew
    expect(r.module).toBe(':app');
    expect(r.task).toBe(':app:test');
  });

  // ── I2. Sub-modules deeper than 1 level ─────────────────────────────────────

  it('I2. Deep sub-module: lib/sub/build.gradle, test in lib/sub/src/test', () => {
    asUnix();
    touch('settings.gradle.kts', "include(':lib:sub')");
    touchExec('gradlew');
    touch('lib/sub/build.gradle.kts');
    const editor = touch('lib/sub/src/test/kotlin/Foo.kt');

    const r = fullPipeline(editor);

    expect(r.projectRoot).toBe(tmpRoot);
    expect(r.module).toBe(':lib:sub');
    expect(r.task).toBe(':lib:sub:test');
  });

  // ── I3. Single-module Kotlin/JVM (no settings.gradle) ───────────────────────

  it('I3. Single-module without settings.gradle: build.gradle.kts is the root', () => {
    asUnix();
    touch('build.gradle.kts');
    touchExec('gradlew');
    const editor = touch('src/test/kotlin/Foo.kt');

    const r = fullPipeline(editor);

    expect(r.projectRoot).toBe(tmpRoot);
    expect(r.gradlew).toBe(path.join(tmpRoot, 'gradlew'));
    expect(r.module).toBe('');                                              // root project
    expect(r.task).toBe('test');
  });

  // ── I4. buildSrc trap (file inside has build.gradle but real root is up) ───

  it('I4. buildSrc/: file inside walks past buildSrc/build.gradle.kts to root', () => {
    asUnix();
    touch('settings.gradle.kts');
    touchExec('gradlew');
    touch('buildSrc/build.gradle.kts');
    const editor = touch('buildSrc/src/main/kotlin/MyPlugin.kt');

    const r = fullPipeline(editor);

    expect(r.projectRoot).toBe(tmpRoot);                                    // critical: NOT buildSrc/
    expect(r.gradlew).toBe(path.join(tmpRoot, 'gradlew'));
  });

  // ── I5. Composite include build (build-logic) ───────────────────────────────

  it('I5. Composite includeBuild: file in build-logic/convention uses build-logic root', () => {
    asUnix();
    touch('settings.gradle.kts', 'includeBuild("build-logic")');
    touch('build-logic/settings.gradle.kts');
    touchExec('gradlew');
    touchExec('build-logic/gradlew');
    touch('build-logic/convention/build.gradle.kts');
    const editor = touch('build-logic/convention/src/main/kotlin/MyPlugin.kt');

    const r = fullPipeline(editor);

    // Per Gradle convention: included builds have their own settings + gradlew.
    expect(r.projectRoot).toBe(path.join(tmpRoot, 'build-logic'));
    expect(r.gradlew).toBe(path.join(tmpRoot, 'build-logic', 'gradlew'));
    expect(r.module).toBe(':convention');
  });

  // ── I6. Workspace = module (Q1 = strict workspace) ──────────────────────────

  it('I6. workspace opened at module level (NOT root) → strict, no escalation', () => {
    asUnix();
    // Filesystem has settings at parent, but workspace is just app/.
    touch('settings.gradle.kts');                                           // outside workspace
    touchExec('gradlew');
    const moduleDir = mkdir('app');
    touch('app/build.gradle.kts');
    touchExec('app/gradlew');                                               // pretend module also has one
    const editor = touch('app/src/test/kotlin/Foo.kt');

    // Workspace is JUST the module dir
    const r = fullPipeline(editor, [moduleDir]);

    // Must stay inside workspace (Q1 = strict). app/ becomes the root via build.gradle fallback.
    expect(r.projectRoot).toBe(moduleDir);
    expect(r.gradlew).toBe(path.join(moduleDir, 'gradlew'));
  });

  // ── I7. Wrapper missing → diagnostic-rich error ─────────────────────────────

  it('I7. Wrapper missing produces GradleWrapperNotFoundError with diagnostic info', () => {
    asUnix();
    touch('settings.gradle.kts');
    // No gradlew anywhere
    const editor = touch('app/src/test/kotlin/Foo.kt');
    touch('app/build.gradle.kts');

    const det = detectGradleRoot(ctx({ activeEditorPath: editor }));
    expect(det.kind).toBe('resolved');

    if (det.kind === 'resolved') {
      try {
        resolveGradleWrapper(det.root);
        throw new Error('should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(GradleWrapperNotFoundError);
        const e = err as GradleWrapperNotFoundError;
        expect(e.projectRoot).toBe(tmpRoot);
        expect(e.attempted.length).toBeGreaterThanOrEqual(2);
        expect(e.message).toContain('settings.gradle');                     // points user to fix
      }
    }
  });

  // ── I8. Windows multi-module (uses .bat) ────────────────────────────────────

  it('I8. Windows multi-module: prefers gradlew.bat over gradlew', () => {
    asWin();
    touch('settings.gradle.kts');
    touchExec('gradlew');
    touchExec('gradlew.bat');
    touch('app/build.gradle.kts');
    const editor = touch('app/src/test/Foo.kt');

    const r = fullPipeline(editor);

    expect(r.projectRoot).toBe(tmpRoot);
    expect(r.gradlew).toBe(path.join(tmpRoot, 'gradlew.bat'));              // Windows preference
    expect(r.module).toBe(':app');
  });

  // ── I9. Spring Boot style: Groovy-only settings.gradle ──────────────────────

  it('I9. Groovy settings.gradle (no .kts) treated as definitive root marker', () => {
    asUnix();
    touch('settings.gradle');
    touch('build.gradle');
    touchExec('gradlew');
    touch('spring-boot-app/build.gradle');
    const editor = touch('spring-boot-app/src/test/java/com/example/FooTest.java');

    const r = fullPipeline(editor);

    expect(r.projectRoot).toBe(tmpRoot);
    expect(r.module).toBe(':spring-boot-app');
  });

  // ── I10. Monorepo: gradle project nested in services/backend ────────────────

  it('I10. Monorepo: workspace has no Gradle, project at services/backend', () => {
    asUnix();
    touch('frontend/package.json');
    touch('services/backend/settings.gradle.kts');
    touchExec('services/backend/gradlew');
    touch('services/backend/api/build.gradle.kts');
    const editor = touch('services/backend/api/src/test/kotlin/Foo.kt');

    const r = fullPipeline(editor);

    expect(r.projectRoot).toBe(path.join(tmpRoot, 'services/backend'));
    expect(r.gradlew).toBe(path.join(tmpRoot, 'services/backend/gradlew'));
    expect(r.module).toBe(':api');
    expect(r.task).toBe(':api:test');
  });

  // ── I11. Multi-root workspace, file in second root ──────────────────────────

  it('I11. Multi-root workspace: walk-up disambiguates by active editor', () => {
    asUnix();
    const ws1 = mkdir('ws1');
    const ws2 = mkdir('ws2');
    touch('ws1/settings.gradle.kts');
    touchExec('ws1/gradlew');
    touch('ws2/settings.gradle.kts');
    touchExec('ws2/gradlew');
    touch('ws2/feature/build.gradle.kts');
    const editor = touch('ws2/feature/src/test/kotlin/Foo.kt');

    const r = fullPipeline(editor, [ws1, ws2]);

    expect(r.projectRoot).toBe(ws2);
    expect(r.gradlew).toBe(path.join(ws2, 'gradlew'));
    expect(r.module).toBe(':feature');
  });

  // ── I12. Module path detection through nested src layout ────────────────────

  it('I12. Module path is correct even when src/ has many intermediate dirs', () => {
    asUnix();
    touch('settings.gradle.kts');
    touchExec('gradlew');
    touch('feature/auth/build.gradle.kts');
    const editor = touch('feature/auth/src/test/kotlin/com/example/auth/login/LoginTest.kt');

    const r = fullPipeline(editor);

    expect(r.module).toBe(':feature:auth');
    expect(r.task).toBe(':feature:auth:test');
  });

  // ── I13. KMP-style module with multiple source sets ─────────────────────────

  it('I13. KMP-style sourceSet (sharedTest): module is still the immediate build.gradle ancestor', () => {
    asUnix();
    touch('settings.gradle.kts');
    touchExec('gradlew');
    touch('shared/build.gradle.kts');
    const editor = touch('shared/src/sharedTest/kotlin/Foo.kt');

    const r = fullPipeline(editor);

    expect(r.projectRoot).toBe(tmpRoot);
    expect(r.module).toBe(':shared');
  });

  // ── I14. Race condition: file appears between detectGradleRoot calls ────────

  it('I14. Adding a settings.gradle later changes subsequent detection (no caching surprise)', () => {
    asUnix();
    touchExec('gradlew');
    touch('app/build.gradle.kts');
    const editor = touch('app/src/test/Foo.kt');

    // First call: no settings.gradle anywhere, app/build.gradle.kts is the closest provisional root.
    const r1 = detectGradleRoot(ctx({ activeEditorPath: editor }));
    expect(r1.kind).toBe('resolved');
    if (r1.kind === 'resolved') expect(r1.root).toBe(path.join(tmpRoot, 'app'));

    // Add a definitive marker higher up; subsequent detection returns it (no stale cache).
    touch('settings.gradle.kts');
    const r2 = detectGradleRoot(ctx({ activeEditorPath: editor }));
    expect(r2.kind).toBe('resolved');
    if (r2.kind === 'resolved') expect(r2.root).toBe(tmpRoot);
  });

  // ── I15. End-to-end smoke: realistic Android project layout ─────────────────

  it('I15. Realistic Android project: app + library + buildSrc, multiple test files', () => {
    asUnix();
    touch('settings.gradle.kts', `include(':app', ':lib', ':feature:auth')`);
    touch('build.gradle.kts');
    touchExec('gradlew');
    touchExec('gradlew.bat');
    touch('buildSrc/build.gradle.kts');
    touch('buildSrc/src/main/kotlin/MyPlugin.kt');
    touch('app/build.gradle.kts');
    touch('lib/build.gradle.kts');
    touch('feature/auth/build.gradle.kts');

    const cases: Array<{ file: string; expectedModule: string }> = [
      { file: 'app/src/test/kotlin/AppTest.kt',                    expectedModule: ':app' },
      { file: 'app/src/androidTest/kotlin/AppInstrumentTest.kt',   expectedModule: ':app' },
      { file: 'lib/src/test/kotlin/LibTest.kt',                    expectedModule: ':lib' },
      { file: 'feature/auth/src/test/kotlin/AuthTest.kt',          expectedModule: ':feature:auth' },
      // buildSrc files conventionally have NO module path — they belong to the root build
      { file: 'buildSrc/src/main/kotlin/MyPluginTest.kt',          expectedModule: ':buildSrc' },
    ];

    for (const c of cases) {
      const editor = touch(c.file);
      const r = fullPipeline(editor);
      expect(r.projectRoot).toBe(tmpRoot);
      expect(r.gradlew).toBe(path.join(tmpRoot, 'gradlew'));
      expect(r.module).toBe(c.expectedModule);
    }
  });
});

// ── Setting-driven integration ──────────────────────────────────────────────

describe('Gradle pipeline — explicit setting (kotlinJump.gradleProjectRoot)', () => {

  it('I16. Setting overrides walk-up entirely', () => {
    asUnix();
    // File looks like it's in proj1, but setting points to proj2
    const proj1 = mkdir('proj1');
    const proj2 = mkdir('proj2');
    touch('proj1/settings.gradle.kts');
    touchExec('proj1/gradlew');
    touch('proj2/settings.gradle.kts');
    touchExec('proj2/gradlew');
    const editor = touch('proj1/src/test/Foo.kt');

    const r = detectGradleRoot(ctx({
      activeEditorPath: editor,
      setting: proj2,                                                 // explicit override
    }));

    expect(r).toEqual({ kind: 'resolved', root: proj2, via: 'setting' });
    void proj1;
  });

  it('I17. workspace-relative setting resolves correctly', () => {
    asUnix();
    touch('test/kotlin-jump-demo/settings.gradle.kts');
    touchExec('test/kotlin-jump-demo/gradlew');
    const r = detectGradleRoot(ctx({ setting: 'test/kotlin-jump-demo' }));
    expect(r.kind).toBe('resolved');
    if (r.kind === 'resolved') expect(r.root).toBe(path.join(tmpRoot, 'test/kotlin-jump-demo'));
  });
});

// ── Wrapper resolution edge cases (integration with real config) ────────────

describe('Gradle pipeline — wrapper config integration', () => {

  it('I18. Custom relative wrapper path via setting', () => {
    asUnix();
    touch('settings.gradle.kts');
    const customWrapper = touchExec('tools/my-gradlew');

    const original = vscode.workspace.getConfiguration;
    vi.spyOn(vscode.workspace, 'getConfiguration').mockImplementation(((..._args: any[]) => ({
      get: (k: string, def: any) => k === 'gradleWrapper' ? './tools/my-gradlew' : def,
      update: async () => {},
    })) as any);
    try {
      const wrapper = resolveGradleWrapper(tmpRoot);
      expect(wrapper).toBe(customWrapper);
    } finally {
      (vscode.workspace as any).getConfiguration = original;
    }
  });
});
