// Regression tests for the second verification pass (2026-09-08).
import { describe, it, expect, vi } from 'vitest';
import { analyzeManifest } from '../../src/providers/ManifestNecessityProvider';
import { analyzeLifecyclePairs } from '../../src/providers/LifecyclePairingProvider';
import { escapeAngleBrackets, readSignature } from '../../src/util/SignatureReader';
import { buildLocalScopeIndex, latestBinding } from '../../src/util/LocalScopeIndex';
import { importBlockBounds } from '../../src/util/importBlock';
import { coversTarget } from '../../src/providers/KmpExpectActualProvider';
import { findDisplaySites } from '../../src/providers/StringXmlHoverProvider';
import { SymbolIndex } from '../../src/indexer/SymbolIndex';
import { parse } from '../../src/indexer/KotlinParser';
import { mockDocument } from './helpers';

vi.mock('vscode', async () => import('./__mocks__/vscode'));

describe('Manifest — a library component is simply ok (was: "never referenced" with a removal quick fix behind it)', () => {
  it('reports neither missing-class nor unreferenced for androidx.startup.InitializationProvider', () => {
    const xml = '<manifest package="com.app"><application><provider android:name="androidx.startup.InitializationProvider"><meta-data android:name="x" /></provider></application></manifest>';
    const r = analyzeManifest(xml, { classExists: () => false, packageExists: () => false, searchApiUsage: () => [] });
    expect(r.components).toEqual([{ name: 'androidx.startup.InitializationProvider', status: 'ok' }]);
  });
});

describe('Rx pairing — safe call and typed val', () => {
  it('pairs `val d: Disposable = …subscribe(` with `d?.dispose()`', () => {
    const code = 'class A : Activity() {\n    override fun onStart() { val d: Disposable = observable.subscribe(::render); disposable = d }\n    override fun onStop() { disposable?.dispose() }\n}\n';
    const simple = 'class B : Activity() {\n    override fun onStart() { disposable = observable.subscribe(::render) }\n    override fun onStop() { disposable?.dispose() }\n}\n';
    expect(analyzeLifecyclePairs(simple).orphans).toEqual([]);
    expect(analyzeLifecyclePairs(code).orphans.map(o => o.resource)).not.toContain('Disposable');
  });
});

describe('KDoc escaping keeps a blockquote (was: "\\> ⚠️ Deprecated" shown literally)', () => {
  it('escapes generics only', () => {
    expect(escapeAngleBrackets('> ⚠️ **Deprecated.** use Flow<User> -> now')).toBe('> ⚠️ **Deprecated.** use Flow\\<User\\> -> now');
  });
  it('does not cut a signature at a brace in a char literal', () => {
    const code = 'package p\nval C = \'{\'\n';
    const index = new SymbolIndex();
    index.add(parse('file:///S.kt', code));
    expect(readSignature(mockDocument('file:///S.kt', code) as any, index.lookup('C')[0]!)).toBe("val C = '{'");
  });
});

describe('Java switch arms with several labels', () => {
  it('does not bind GREEN in `case RED, GREEN -> paint()`, still binds a lambda parameter inside an arm', () => {
    const idx = buildLocalScopeIndex(['void f(Color c) {', '    switch (c) {', '        case RED, GREEN -> paint();', '        case BLUE -> items.forEach(i -> log(i));', '    }', '    use(GREEN);', '}'], 'java');
    expect(latestBinding(idx, 'GREEN', 0, 5, 8)).toBeUndefined();
    expect(latestBinding(idx, 'i', 0, 3, 40)?.line).toBe(3);
  });
});

describe('Import block header — strings and the bracket form', () => {
  it('survives a parenthesis inside a string and a multi-line @file:[ … ]', () => {
    expect(importBlockBounds(['@file:Suppress("unused(")', 'package p', 'import a.A', 'class C'], l => /^\s*import\s/.test(l))).toEqual({ first: 2, last: 2 });
    expect(importBlockBounds(['@file:[', '    JvmName("A")', '    Suppress("B")', ']', 'package p', 'import a.A', 'import b.B', 'class C'], l => /^\s*import\s/.test(l))).toEqual({ first: 5, last: 6 });
  });
});

describe('Misc leftovers', () => {
  it('androidNativeMain covers androidNativeArm64', () => {
    expect(coversTarget('androidNative', 'androidNativeArm64')).toBe(true);
  });
  it('a qualified R.string is not a display site', () => {
    const text = '@Composable fun Screen() { Text(stringResource(android.R.string.cancel)) }\nclass Host { fun a() = ctx.getString(R.string.cancel) }\n';
    expect(findDisplaySites('cancel', [{ path: '/a.kt', text }])).toEqual([{ enclosing: 'Host', isComposable: false }]);
  });
});
