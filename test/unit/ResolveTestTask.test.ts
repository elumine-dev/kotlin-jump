import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';

import { resolveTestTask } from '../../src/testing/GradleTestRunner';
import { NullLogger } from '../../src/util/logger';

// ── Fixture ──────────────────────────────────────────────────────────────────

let tmpRoot: string;

beforeEach(() => { tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'resolve-task-')); });
afterEach(() => {
  fs.rmSync(tmpRoot, { recursive: true, force: true });
  vi.restoreAllMocks();
});

function touch(rel: string, content = ''): string {
  const abs = path.join(tmpRoot, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content);
  return abs;
}

/** Spies on getConfiguration, recording every (section, resource) call it received. */
function withConfig(overrides: Record<string, any>) {
  const calls: any[][] = [];
  vi.spyOn(vscode.workspace, 'getConfiguration').mockImplementation(((...args: any[]) => {
    calls.push(args);
    return {
      get: (key: string, defaultVal: any) => (key in overrides ? overrides[key] : defaultVal),
      update: async () => {},
    };
  }) as any);
  return calls;
}

const log = new NullLogger() as unknown as import('../../src/util/logger').Logger;

// ── Tests ────────────────────────────────────────────────────────────────────

describe('resolveTestTask — multi-root config resource scoping', () => {
  it('T1. reads kotlinJump config scoped to the module path, not window-wide', () => {
    const buildFile = touch('app/build.gradle.kts', 'plugins { id("com.android.application") }');
    const modulePath = path.dirname(buildFile);
    const calls = withConfig({});

    resolveTestTask(modulePath, ':app', log);

    expect(calls.length).toBeGreaterThan(0);
    const [section, resource] = calls[0];
    expect(section).toBe('kotlinJump');
    expect(resource?.fsPath).toBe(modulePath);
  });

  it('T2. explicit testTaskOverrides entry wins over Android auto-detection', () => {
    const buildFile = touch('app/build.gradle.kts', 'plugins { id("com.android.application") }');
    const modulePath = path.dirname(buildFile);
    withConfig({ testTaskOverrides: { ':app': 'testDemoFreeDebugUnitTest' } });

    expect(resolveTestTask(modulePath, ':app', log)).toBe('testDemoFreeDebugUnitTest');
  });

  it('T3. Android module without an override falls back to testDebugUnitTest', () => {
    const buildFile = touch('app/build.gradle.kts', 'android {\n  compileSdk = 34\n}');
    const modulePath = path.dirname(buildFile);
    withConfig({});

    expect(resolveTestTask(modulePath, ':app', log)).toBe('testDebugUnitTest');
  });

  it('T4. plain JVM module (no android block) falls back to "test"', () => {
    const buildFile = touch('lib/build.gradle.kts', 'plugins {\n  kotlin("jvm")\n}');
    const modulePath = path.dirname(buildFile);
    withConfig({});

    expect(resolveTestTask(modulePath, ':lib', log)).toBe('test');
  });
});
