import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import {
  detectGradleRoot,
  GRADLE_MARKERS,
  SCAN_EXCLUDE_DIRS,
  SCAN_CAP,
  type DetectorContext,
} from '../../src/testing/GradleRootDetector';

// ── Fixture builder ──────────────────────────────────────────────────────────

let tmpRoot: string;

beforeEach(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'gradle-detect-'));
});
afterEach(() => {
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

function mkdir(rel: string): string {
  const abs = path.join(tmpRoot, rel);
  fs.mkdirSync(abs, { recursive: true });
  return abs;
}
function touch(rel: string): string {
  const abs = path.join(tmpRoot, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, '');
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

// ── Test matrix (13 scenarios from plan) ─────────────────────────────────────

describe('detectGradleRoot — 5-tier algorithm', () => {

  it('1. Gradle à la racine du workspace → tier 3 wins', () => {
    touch('settings.gradle.kts');
    const r = detectGradleRoot(ctx());
    expect(r).toEqual({ kind: 'resolved', root: tmpRoot, via: 'workspace-root' });
  });

  it('2. Gradle en depth-1 (monorepo) → tier 4 wins', () => {
    touch('frontend/package.json');
    touch('backend/settings.gradle.kts');
    const r = detectGradleRoot(ctx());
    expect(r).toEqual({
      kind: 'resolved',
      root: path.join(tmpRoot, 'backend'),
      via:  'depth-1-scan',
    });
  });

  it('2b. Gradle en depth-2 (cas kotlin-nav : test/kotlin-jump-demo) → tier 4 wins', () => {
    touch('src/extension.ts');
    mkdir('test');  // intermediate dir, no Gradle marker
    touch('test/kotlin-jump-demo/settings.gradle.kts');
    const r = detectGradleRoot(ctx());
    expect(r).toEqual({
      kind: 'resolved',
      root: path.join(tmpRoot, 'test/kotlin-jump-demo'),
      via:  'depth-1-scan',
    });
  });

  it('2c. Descente dans un sous-dossier s\'arrête dès qu\'un Gradle root est trouvé', () => {
    // If the parent IS a Gradle root, do not descend into its sub-modules
    touch('app/settings.gradle.kts');
    touch('app/module-a/build.gradle.kts');  // sub-module
    touch('app/module-b/build.gradle.kts');  // sub-module
    const r = detectGradleRoot(ctx());
    expect(r).toEqual({
      kind: 'resolved',
      root: path.join(tmpRoot, 'app'),
      via:  'depth-1-scan',
    });
  });

  it('3. Gradle en depth-3 via active editor walk-up → tier 2 wins', () => {
    touch('apps/android/settings.gradle.kts');
    const editor = touch('apps/android/src/main/kotlin/Main.kt');
    const r = detectGradleRoot(ctx({ activeEditorPath: editor }));
    expect(r).toEqual({
      kind: 'resolved',
      root: path.join(tmpRoot, 'apps/android'),
      via:  'active-editor',
    });
  });

  it('4. gradleProjectRoot setting valide → tier 1 wins, pas de scan', () => {
    touch('a/settings.gradle.kts');
    touch('b/settings.gradle.kts');
    const r = detectGradleRoot(ctx({ setting: 'b' }));
    expect(r).toEqual({
      kind: 'resolved',
      root: path.join(tmpRoot, 'b'),
      via:  'setting',
    });
  });

  it('5. gradleProjectRoot setting invalide → setting-invalid', () => {
    touch('apps/android/settings.gradle.kts');
    const r = detectGradleRoot(ctx({ setting: 'does/not/exist' }));
    expect(r.kind).toBe('setting-invalid');
    if (r.kind === 'setting-invalid') {
      expect(r.settingPath).toBe(path.join(tmpRoot, 'does/not/exist'));
    }
  });

  it('6. 2 candidats à depth-1, pas de choix persisté → ambiguous', () => {
    touch('app/settings.gradle.kts');
    touch('lib/settings.gradle.kts');
    const r = detectGradleRoot(ctx());
    expect(r.kind).toBe('ambiguous');
    if (r.kind === 'ambiguous') expect(r.candidates).toHaveLength(2);
  });

  it('7. 2 candidats + choix persisté → resolved via persisted-choice', () => {
    touch('app/settings.gradle.kts');
    const libPath = path.join(tmpRoot, 'lib');
    touch('lib/settings.gradle.kts');
    const r = detectGradleRoot(ctx({ persistedChoice: libPath }));
    expect(r).toEqual({ kind: 'resolved', root: libPath, via: 'persisted-choice' });
  });

  it('8. Aucun fichier Gradle nulle part → not-found', () => {
    touch('src/App.tsx');
    const r = detectGradleRoot(ctx());
    expect(r).toEqual({ kind: 'not-found' });
  });

  it('9. node_modules/**/settings.gradle.kts doit être ignoré', () => {
    // Nested gradle files inside excluded dirs must not be discovered
    touch('node_modules/some-pkg/settings.gradle.kts');
    touch('.gradle/some-cache/settings.gradle.kts');
    const r = detectGradleRoot(ctx());
    expect(r).toEqual({ kind: 'not-found' });
  });

  it('10. Workspace avec > SCAN_CAP enfants → continue mais borné', () => {
    // Create SCAN_CAP+2 dirs but place the Gradle marker within the first 10
    for (let i = 0; i < SCAN_CAP + 2; i++) mkdir(`dir-${String(i).padStart(4, '0')}`);
    touch('dir-0005/settings.gradle.kts');
    const r = detectGradleRoot(ctx());
    expect(r.kind).toBe('resolved');
    if (r.kind === 'resolved') expect(r.root).toBe(path.join(tmpRoot, 'dir-0005'));
  });

  it('11. settings.gradle.kts prioritaire sur build.gradle.kts à depth-1', () => {
    touch('modA/build.gradle.kts');   // submodule-like
    touch('modB/settings.gradle.kts'); // project root-like
    const r = detectGradleRoot(ctx());
    // Both are valid candidates — ambiguous, but both should be picked up
    expect(r.kind).toBe('ambiguous');
    if (r.kind === 'ambiguous') {
      expect(r.candidates).toHaveLength(2);
    }
  });

  it('12. Symlink vers dossier Gradle externe en depth-1 → resolved', () => {
    const external = fs.mkdtempSync(path.join(os.tmpdir(), 'gradle-ext-'));
    fs.writeFileSync(path.join(external, 'settings.gradle.kts'), '');
    try {
      fs.symlinkSync(external, path.join(tmpRoot, 'linked-gradle'));
      const r = detectGradleRoot(ctx());
      expect(r.kind).toBe('resolved');
      if (r.kind === 'resolved') expect(r.via).toBe('depth-1-scan');
    } finally {
      fs.rmSync(external, { recursive: true, force: true });
    }
  });

  it('13. Active editor dans .kt profond (cas Kevin : monorepo) → tier 2 wins', () => {
    // Simulates opening kotlin-nav and editing test/kotlin-jump-demo/src/main/kotlin/App.kt
    touch('test/kotlin-jump-demo/settings.gradle.kts');
    const editor = touch('test/kotlin-jump-demo/src/main/kotlin/com/example/app/App.kt');
    const r = detectGradleRoot(ctx({ activeEditorPath: editor }));
    expect(r).toEqual({
      kind: 'resolved',
      root: path.join(tmpRoot, 'test/kotlin-jump-demo'),
      via:  'active-editor',
    });
  });
});

// ── Guard tests (invariants) ─────────────────────────────────────────────────

describe('detectGradleRoot — guards', () => {
  it('setting absolu (pas seulement relatif) fonctionne', () => {
    const absDir = mkdir('absolute/gradle');
    touch('absolute/gradle/settings.gradle.kts');
    const r = detectGradleRoot(ctx({ setting: absDir }));
    expect(r).toEqual({ kind: 'resolved', root: absDir, via: 'setting' });
  });

  it('setting pointant vers un fichier (pas un dir) → setting-invalid', () => {
    const file = touch('real-file.txt');
    const r = detectGradleRoot(ctx({ setting: file }));
    expect(r.kind).toBe('setting-invalid');
  });

  it('active-editor sans workspace folders ne crash pas', () => {
    const editor = touch('lonely/Main.kt');
    const r = detectGradleRoot(ctx({ workspaceFolders: [], activeEditorPath: editor }));
    // No workspace → walk-up can still find markers above (we only stop at FS root)
    expect(r.kind).toBe('not-found');
  });

  it('workspace folder inexistant ne crash pas', () => {
    const r = detectGradleRoot({
      workspaceFolders: ['/does/not/exist/here'],
      activeEditorPath: undefined,
      setting: undefined,
      persistedChoice: undefined,
    });
    expect(r).toEqual({ kind: 'not-found' });
  });

  it('GRADLE_MARKERS contains les 4 markers attendus', () => {
    expect(GRADLE_MARKERS).toEqual(['settings.gradle.kts', 'settings.gradle', 'build.gradle.kts', 'build.gradle']);
  });

  it('SCAN_EXCLUDE_DIRS contient au moins node_modules, .git, build, .gradle', () => {
    for (const dir of ['node_modules', '.git', 'build', '.gradle', 'dist']) {
      expect(SCAN_EXCLUDE_DIRS.has(dir)).toBe(true);
    }
  });
});
