import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';

import {
  resolveGradleWrapper,
  GradleWrapperNotFoundError,
} from '../../src/testing/GradleTestRunner';

// ── Fixture ──────────────────────────────────────────────────────────────────

let tmpRoot: string;

beforeEach(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'gradle-wrap-'));
});
afterEach(() => {
  fs.rmSync(tmpRoot, { recursive: true, force: true });
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function touchExec(rel: string): string {
  const abs = path.join(tmpRoot, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, '#!/bin/sh\necho ok\n');
  fs.chmodSync(abs, 0o755);
  return abs;
}

function withConfig(overrides: Record<string, any>) {
  const original = vscode.workspace.getConfiguration;
  vi.spyOn(vscode.workspace, 'getConfiguration').mockImplementation(((..._args: any[]) => ({
    get: (key: string, defaultVal: any) => (key in overrides ? overrides[key] : defaultVal),
    update: async () => {},
  })) as any);
  return () => { (vscode.workspace as any).getConfiguration = original; };
}

function asWindows() {
  vi.stubGlobal('process', { ...process, platform: 'win32' });
}
function asUnix() {
  vi.stubGlobal('process', { ...process, platform: 'darwin' });
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('resolveGradleWrapper — wrapper resolution & diagnostics', () => {

  it('R1. Unix defaults: projectRoot/gradlew exists → returns it', () => {
    asUnix();
    const wrapper = touchExec('gradlew');
    expect(resolveGradleWrapper(tmpRoot)).toBe(wrapper);
  });

  it('R2. Windows defaults: projectRoot/gradlew.bat exists → returns .bat', () => {
    asWindows();
    const bat = touchExec('gradlew.bat');
    touchExec('gradlew');                    // also exists; .bat is preferred on Win
    expect(resolveGradleWrapper(tmpRoot)).toBe(bat);
  });

  it('R3. Windows fallback: only gradlew (no .bat) → returns gradlew (Git Bash on Windows)', () => {
    asWindows();
    const wrapper = touchExec('gradlew');
    expect(resolveGradleWrapper(tmpRoot)).toBe(wrapper);
  });

  it('R4. Unix fallback: only gradlew.bat exists → returns .bat', () => {
    asUnix();
    const bat = touchExec('gradlew.bat');
    expect(resolveGradleWrapper(tmpRoot)).toBe(bat);
  });

  it('R5. setting absolute path: returned as-is when it exists', () => {
    asUnix();
    const custom = touchExec('custom/gradlew');
    const restore = withConfig({ gradleWrapper: custom });
    try {
      expect(resolveGradleWrapper(tmpRoot)).toBe(custom);
    } finally { restore(); }
  });

  it('R6. setting workspace-relative path resolves correctly', () => {
    asUnix();
    const custom = touchExec('tools/gradlew');
    const restore = withConfig({ gradleWrapper: './tools/gradlew' });
    try {
      expect(resolveGradleWrapper(tmpRoot)).toBe(custom);
    } finally { restore(); }
  });

  it('R7. nothing found → throws GradleWrapperNotFoundError with attempted paths and projectRoot', () => {
    asUnix();
    expect(() => resolveGradleWrapper(tmpRoot)).toThrowError(GradleWrapperNotFoundError);
    try {
      resolveGradleWrapper(tmpRoot);
    } catch (err) {
      const e = err as GradleWrapperNotFoundError;
      expect(e.projectRoot).toBe(tmpRoot);
      expect(e.attempted.length).toBeGreaterThanOrEqual(2);
      expect(e.attempted.some(p => p.endsWith('gradlew'))).toBe(true);
      expect(e.attempted.some(p => p.endsWith('gradlew.bat'))).toBe(true);
      expect(e.message).toContain('gradlew not found');
      expect(e.message).toContain(tmpRoot);
    }
  });
});
