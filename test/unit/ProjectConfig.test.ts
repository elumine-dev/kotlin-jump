import { describe, it, expect } from 'vitest';
import * as path from 'path';
import { parseProjectConfig } from '../../src/util/ProjectConfig';

const FOLDER = '/workspace/myproject';

// ── Valid configs ─────────────────────────────────────────────────────────────

describe('parseProjectConfig — modules', () => {
  it('resolves a single module to an absolute path', () => {
    const json   = JSON.stringify({ modules: { ':app': 'app' } });
    const result = parseProjectConfig(json, FOLDER)!;
    expect(result.moduleMap.get(':app')).toBe(path.join(FOLDER, 'app'));
  });

  it('resolves multiple modules', () => {
    const json = JSON.stringify({
      modules: { ':core': 'core', ':feature:home': 'feature/home' },
    });
    const { moduleMap } = parseProjectConfig(json, FOLDER)!;
    expect(moduleMap.get(':core')).toBe(path.join(FOLDER, 'core'));
    expect(moduleMap.get(':feature:home')).toBe(path.join(FOLDER, 'feature/home'));
  });

  it('handles nested relative paths', () => {
    const json   = JSON.stringify({ modules: { ':deep': 'a/b/c/d' } });
    const { moduleMap } = parseProjectConfig(json, FOLDER)!;
    expect(moduleMap.get(':deep')).toBe(path.join(FOLDER, 'a/b/c/d'));
  });

  it('returns empty moduleMap when modules key is absent', () => {
    const json   = JSON.stringify({ sourceRoots: ['src/main/kotlin'] });
    const { moduleMap } = parseProjectConfig(json, FOLDER)!;
    expect(moduleMap.size).toBe(0);
  });
});

describe('parseProjectConfig — sourceRoots', () => {
  it('resolves a single source root to an absolute path', () => {
    const json = JSON.stringify({ sourceRoots: ['src/main/kotlin'] });
    const { sourceRoots } = parseProjectConfig(json, FOLDER)!;
    expect(sourceRoots).toEqual([path.join(FOLDER, 'src/main/kotlin')]);
  });

  it('resolves multiple source roots', () => {
    const json = JSON.stringify({
      sourceRoots: ['src/main/kotlin', 'src/commonMain/kotlin'],
    });
    const { sourceRoots } = parseProjectConfig(json, FOLDER)!;
    expect(sourceRoots).toHaveLength(2);
    expect(sourceRoots[0]).toBe(path.join(FOLDER, 'src/main/kotlin'));
    expect(sourceRoots[1]).toBe(path.join(FOLDER, 'src/commonMain/kotlin'));
  });

  it('returns empty sourceRoots when key is absent', () => {
    const json = JSON.stringify({ modules: { ':app': 'app' } });
    const { sourceRoots } = parseProjectConfig(json, FOLDER)!;
    expect(sourceRoots).toHaveLength(0);
  });
});

describe('parseProjectConfig — empty / partial configs', () => {
  it('handles an empty JSON object without throwing', () => {
    const result = parseProjectConfig('{}', FOLDER);
    expect(result).not.toBeNull();
    expect(result!.moduleMap.size).toBe(0);
    expect(result!.sourceRoots).toHaveLength(0);
  });

  it('handles config with both keys present', () => {
    const json = JSON.stringify({
      modules:     { ':app': 'app' },
      sourceRoots: ['src/main/kotlin'],
    });
    const result = parseProjectConfig(json, FOLDER)!;
    expect(result.moduleMap.size).toBe(1);
    expect(result.sourceRoots).toHaveLength(1);
  });
});

// ── Invalid JSON ──────────────────────────────────────────────────────────────

describe('parseProjectConfig — invalid input', () => {
  it('returns null for malformed JSON', () => {
    expect(parseProjectConfig('{invalid json}', FOLDER)).toBeNull();
  });

  it('returns null for empty string', () => {
    expect(parseProjectConfig('', FOLDER)).toBeNull();
  });

  it('handles JSON array gracefully (not an object)', () => {
    // Arrays are valid JSON but not a valid config — modules and sourceRoots will just be absent
    const result = parseProjectConfig('[]', FOLDER);
    expect(result).not.toBeNull();
    expect(result!.moduleMap.size).toBe(0);
  });

  it('handles null JSON value gracefully', () => {
    const result = parseProjectConfig('null', FOLDER);
    // null has no own-properties so Object.entries({}) produces []
    expect(result).not.toBeNull();
    expect(result!.moduleMap.size).toBe(0);
  });
});

// ── Folder path edge cases ────────────────────────────────────────────────────

describe('parseProjectConfig — folder path edge cases', () => {
  it('works with a trailing separator in folderPath', () => {
    const json   = JSON.stringify({ modules: { ':app': 'app' } });
    const folder = FOLDER + path.sep;
    const { moduleMap } = parseProjectConfig(json, folder)!;
    // path.join normalises double separators, so the result must be correct
    expect(moduleMap.get(':app')).toBeTruthy();
    expect(moduleMap.get(':app')!.includes('app')).toBe(true);
  });

  it('uses the provided folderPath as base for every relative path', () => {
    const other  = '/other/workspace';
    const json   = JSON.stringify({ modules: { ':lib': 'lib' }, sourceRoots: ['src'] });
    const result = parseProjectConfig(json, other)!;
    expect(result.moduleMap.get(':lib')!.startsWith(other)).toBe(true);
    expect(result.sourceRoots[0].startsWith(other)).toBe(true);
  });
});
