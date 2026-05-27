import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('vscode', async () => import('./__mocks__/vscode'));

let existsImpl: (p: string) => boolean = () => false;
vi.mock('fs', async () => {
  const actual = await vi.importActual<typeof import('fs')>('fs');
  return {
    ...actual,
    existsSync: (p: string) => existsImpl(p),
  };
});

// Imported AFTER vi.mock so the mocked `fs` is in scope.
import { invalidateAdbPathCache, resolveAdbPath } from '../../src/android/AdbBinary';

describe('resolveAdbPath', () => {
  beforeEach(() => {
    invalidateAdbPathCache();
    delete process.env['ANDROID_HOME'];
    delete process.env['ANDROID_SDK_ROOT'];
    existsImpl = () => false;
  });

  it('falls back to bare adb when nothing is configured', () => {
    expect(resolveAdbPath()).toBe(process.platform === 'win32' ? 'adb.exe' : 'adb');
  });

  it('honors $ANDROID_HOME/platform-tools/adb when it exists', () => {
    process.env['ANDROID_HOME'] = '/mock/sdk';
    const exe = process.platform === 'win32' ? 'adb.exe' : 'adb';
    const expected = `/mock/sdk/platform-tools/${exe}`;
    existsImpl = p => p === expected;
    expect(resolveAdbPath()).toBe(expected);
  });

  it('caches the resolved path until invalidated', () => {
    process.env['ANDROID_HOME'] = '/mock/sdk';
    const exe = process.platform === 'win32' ? 'adb.exe' : 'adb';
    const expected = `/mock/sdk/platform-tools/${exe}`;
    let calls = 0;
    existsImpl = p => { calls++; return p === expected; };
    resolveAdbPath();
    resolveAdbPath();
    resolveAdbPath();
    const callsAfterCache = calls;

    invalidateAdbPathCache();
    resolveAdbPath();
    expect(calls).toBeGreaterThan(callsAfterCache);
  });

  it('falls back from missing ANDROID_HOME to ANDROID_SDK_ROOT', () => {
    process.env['ANDROID_SDK_ROOT'] = '/sdk-root';
    const exe = process.platform === 'win32' ? 'adb.exe' : 'adb';
    const expected = `/sdk-root/platform-tools/${exe}`;
    existsImpl = p => p === expected;
    expect(resolveAdbPath()).toBe(expected);
  });
});
