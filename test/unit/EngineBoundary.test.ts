import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

/**
 * The dead code engine must run with no editor at all: it is meant to leave
 * this repository and be driven from a command line. Every file reachable from
 * its entry points is checked for an import of `vscode`, type imports included,
 * because a type that mentions `vscode.Uri` cannot be compiled elsewhere.
 */

const ROOT = path.resolve(__dirname, '../..');
const ENTRY_POINTS = [
  'src/cleanup/passe.ts',
  'src/cleanup/simulation.ts',
  'src/cleanup/planner.ts',
  'src/cleanup/exports.ts',
  'src/providers/DeadCodeSweep.ts',
  'src/providers/dormantCode.ts',
  'src/providers/testCoRemoval.ts',
  'src/providers/testCoRemovalClosure.ts',
  'src/providers/unusedDtoFields.ts',
  'src/providers/writeOnlyKeys.ts',
  'src/git/GitFacts.ts',
];
// What the engine may ask of its host: one glob matcher, and a process to run git in.
const ALLOWED_OUTSIDE = new Set(['picomatch', 'child_process']);

const MODULE_SPECIFIER_RE = /(?:^|\n)\s*(?:import|export)\s+(?:type\s+)?[^;'"]*?from\s+['"]([^'"]+)['"]/g;

function resolve(from: string, spec: string): string | undefined {
  const base = path.resolve(path.dirname(from), spec);
  return [`${base}.ts`, path.join(base, 'index.ts')].find(c => fs.existsSync(c));
}

function closure(entries: readonly string[]): { files: Map<string, string | undefined>; packages: Map<string, string> } {
  const files = new Map<string, string | undefined>();
  const packages = new Map<string, string>();
  const walk = (file: string, via: string | undefined): void => {
    if (files.has(file)) return;
    files.set(file, via);
    for (const m of fs.readFileSync(file, 'utf8').matchAll(MODULE_SPECIFIER_RE)) {
      if (!m[1].startsWith('.')) { if (!packages.has(m[1])) packages.set(m[1], file); continue; }
      const target = resolve(file, m[1]);
      if (target) walk(target, file);
    }
  };
  for (const e of entries) walk(path.join(ROOT, e), undefined);
  return { files, packages };
}

const rel = (f: string): string => path.relative(ROOT, f);

describe('the dead code engine stands without an editor', () => {
  const { files, packages } = closure(ENTRY_POINTS);

  it('reaches the detectors, so the walk is not looking at nothing', () => {
    const reached = [...files.keys()].map(rel);
    expect(reached.length).toBeGreaterThan(50);
    for (const f of ['src/providers/unusedSymbols.ts', 'src/providers/unusedMembers.ts', 'src/providers/deadIslands.ts',
      'src/providers/unusedResources.ts', 'src/indexer/KotlinParser.ts']) {
      expect(reached, f).toContain(f);
    }
  });

  it('imports nothing from outside but picomatch, and child_process for git', () => {
    const outside = [...packages].filter(([name]) => !ALLOWED_OUTSIDE.has(name)).map(([name, from]) => `${name} <- ${rel(from)}`);
    expect(outside).toEqual([]);
  });

  it('holds no editor file, wherever it sits', () => {
    const editor = [...files.keys()].map(rel).filter(f => /^src\/(commands|extension)|Provider\.ts$|Panel\.ts$/.test(f));
    expect(editor).toEqual([]);
  });
});
