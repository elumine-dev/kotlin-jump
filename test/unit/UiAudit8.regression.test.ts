// Regression tests for the sixth audit (2026-09-08): removal extents, shared
// catalog versions, files "emptied" by test-only findings, Organize Imports
// comments, smart join with a trailing comment.
import { describe, it, expect, vi } from 'vitest';
import { findUnusedSymbols } from '../../src/providers/unusedSymbols';
import { findUnusedGradleDependencies } from '../../src/providers/unusedGradleDependencies';
import { organizeImports } from '../../src/providers/OrganizeImportsProvider';
import { smartJoin } from '../../src/commands/smartJoinLines';

vi.mock('vscode', async () => import('./__mocks__/vscode'));

const lineOf = (text: string, offset: number) => text.slice(0, offset).split('\n').length - 1;

describe('Unreferenced symbol removal extent (was: a trailing /* warm */ climbed to the licence header; @Inject lines were absorbed)', () => {
  const src = (body: string) => [{ path: '/p/app/src/main/kotlin/com/x/Repo.kt', text: body }];

  it('starts at the declaration when the line above only ends a code comment', () => {
    const text = ['/*', ' * Copyright 2024', ' */', 'package com.x', '', 'val cache = mutableMapOf<String, Int>() /* warm */', 'fun unusedHelper() = 1', 'fun keep() = cache', ''].join('\n');
    const [f] = findUnusedSymbols({ sources: src(text), testSourceSets: [] }).filter(x => x.name === 'unusedHelper');
    expect(f).toBeDefined();
    expect(lineOf(text, f!.removeStart)).toBe(6);
  });

  it('does not absorb an annotation line that declares something of its own', () => {
    const text = ['package com.x', '@JvmField val analytics: Int = 1', 'fun unusedHelper() = 1', 'fun keep() = analytics', ''].join('\n');
    const [f] = findUnusedSymbols({ sources: src(text), testSourceSets: [] }).filter(x => x.name === 'unusedHelper');
    expect(f).toBeDefined();
    expect(lineOf(text, f!.removeStart)).toBe(2);
  });

  it('still takes the doc comment and a bare annotation above the declaration', () => {
    const text = ['package com.x', 'val keep = 1', '/** Dead. */', '@Suppress("unused_x")', 'fun unusedHelper() = keep', ''].join('\n');
    const [f] = findUnusedSymbols({ sources: src(text), testSourceSets: [] }).filter(x => x.name === 'unusedHelper');
    expect(f).toBeDefined();
    expect(lineOf(text, f!.removeStart)).toBe(2);
  });
});

describe('"Delete X.kt (nothing else in it)" (was: computed over test-only findings too, so the file holding a test helper was offered for deletion)', () => {
  it('keeps the file when a test-only symbol remains', () => {
    const utils = 'package com.x\n\nfun a() = 1\n\nfun b() = 2\n';
    const test = 'package com.x\nimport org.junit.Test\nclass UtilsTest { @Test fun t() { b() } }\n';
    const out = findUnusedSymbols({
      sources: [
        { path: '/p/app/src/main/kotlin/com/x/Utils.kt', text: utils },
        { path: '/p/app/src/test/kotlin/com/x/UtilsTest.kt', text: test },
      ],
      testSourceSets: [],
    });
    const a = out.find(f => f.name === 'a')!;
    const b = out.find(f => f.name === 'b')!;
    expect(a.verdict).toBe('unreferenced');
    expect(b.verdict).toBe('testOnly');
    expect(a.fileBecomesEmpty).toBe(false);
  });
});

describe('Version catalog — shared [versions] entry (was: freed with the first dead alias, the second then pointed at nothing)', () => {
  it('leaves a version referenced by two dead aliases in place', () => {
    const toml = ['[versions]', 'coroutines = "1.8.0"', 'lone = "2.0.0"', '[libraries]', 'coroutines-core = { module = "org.jetbrains.kotlinx:kotlinx-coroutines-core", version.ref = "coroutines" }', 'coroutines-android = { module = "org.jetbrains.kotlinx:kotlinx-coroutines-android", version.ref = "coroutines" }', 'okio = { module = "com.squareup.okio:okio", version.ref = "lone" }', ''].join('\n');
    const found = findUnusedGradleDependencies({
      sources: [
        { path: '/p/gradle/libs.versions.toml', text: toml },
        { path: '/p/app/build.gradle.kts', text: 'plugins { }\ndependencies { }\n' },
      ],
      ignoreNames: [],
    });
    const byName = new Map(found.map(f => [f.name, f]));
    expect(byName.get('coroutines-core')?.orphanedVersion).toBeUndefined();
    expect(byName.get('coroutines-android')?.orphanedVersion).toBeUndefined();
    expect(byName.get('okio')?.orphanedVersion?.name).toBe('lone');
  });
});

describe('Organize Imports — comments inside the block (was: dropped without a word)', () => {
  it('keeps a comment where it stands and sorts each run around it', () => {
    const text = ['package p', '', 'import z.Z', 'import a.A', '// ktlint-disable no-wildcard-imports', 'import b.*', '', 'val x = listOf(A(), Z())', ''].join('\n');
    const r = organizeImports(text, { removeUnused: true })!;
    expect(r.replacement.split('\n')).toEqual(['import a.A', 'import z.Z', '// ktlint-disable no-wildcard-imports', 'import b.*']);
  });
});

describe('Smart join — call chain after a trailing comment (was: the chain became comment text)', () => {
  it('moves the comment after the glued chain', () => {
    expect(smartJoin('val x = listOf(1) // ints', '    .map { it * 2 }').joined).toBe('val x = listOf(1).map { it * 2 } // ints');
    expect(smartJoin('val url = "http://x" ', '    .trim()').joined).toBe('val url = "http://x".trim()');
  });
});

describe('@VisibleForTesting quick fix (was: the annotation was inserted without its import)', () => {
  it('adds the androidx.annotation import alongside the annotation, once', async () => {
    const { UnusedSymbolProvider } = await import('../../src/providers/UnusedSymbolProvider');
    const { Position, Range } = await import('./__mocks__/vscode');
    const { mockDocument } = await import('./helpers');
    const path = '/p/app/src/main/kotlin/com/x/Utils.kt';
    const utils = 'package com.x\n\nimport com.x.other.Thing\n\nfun b() = 2\n';
    const test = 'package com.x\nimport org.junit.Test\nclass UtilsTest { @Test fun t() { b() } }\n';
    const findings = findUnusedSymbols({
      sources: [{ path, text: utils }, { path: '/p/app/src/test/kotlin/com/x/UtilsTest.kt', text: test }],
      testSourceSets: [],
    });
    expect(findings.find(f => f.name === 'b')?.verdict).toBe('testOnly');
    const provider = new UnusedSymbolProvider();
    provider.setFindings(findings);
    const doc = Object.assign(mockDocument(`file://${path}`, utils), { uri: { fsPath: path, path, toString: () => `file://${path}`, scheme: 'file' } });
    const actions = await provider.provideCodeActions(doc as any, new Range(new Position(4, 4), new Position(4, 4)));
    const annotate = actions.find(a => a.title.includes('@VisibleForTesting'))!;
    expect(annotate).toBeDefined();
    const serialized = JSON.stringify((annotate.edit as any).entries?.() ?? (annotate.edit as any)._edits ?? annotate.edit);
    expect(serialized).toContain('@VisibleForTesting\\n');
    expect(serialized).toContain('import androidx.annotation.VisibleForTesting\\n');
    expect(serialized).toContain('"line":2'); // alphabetically before `import com.x.other.Thing`, inside the header block
  });
});
