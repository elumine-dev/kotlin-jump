// Regression tests for the eighth audit (2026-09-08): wrong content shown.
import { describe, it, expect, vi } from 'vitest';
import * as vscodeMock from './__mocks__/vscode';
import { Position } from './__mocks__/vscode';
import { analyzeManifest } from '../../src/providers/ManifestNecessityProvider';
import { analyzeDispatcherScopes } from '../../src/providers/DispatcherLensProvider';
import { analyzeLifecyclePairs } from '../../src/providers/LifecyclePairingProvider';
import { coversTarget, coverageLabel } from '../../src/providers/KmpExpectActualProvider';
import { findDisplaySites } from '../../src/providers/StringXmlHoverProvider';
import { escapeAngleBrackets, readSignature } from '../../src/util/SignatureReader';
import { describeCron } from '../../src/providers/LiteralTooltipProvider';
import { KotlinSignatureHelpProvider } from '../../src/providers/SignatureHelpProvider';
import { ResourceDiagnosticProvider } from '../../src/providers/ResourceDiagnosticProvider';
import { StringResourceIndex } from '../../src/indexer/StringResourceIndex';
import { ColorResourceIndex } from '../../src/indexer/ColorResourceIndex';
import { SymbolIndex } from '../../src/indexer/SymbolIndex';
import { parse } from '../../src/indexer/KotlinParser';
import { mockDocument } from './helpers';

vi.mock('vscode', async () => import('./__mocks__/vscode'));

describe('Resource diagnostics — qualified R (was: android.R.string.ok flagged "Cannot resolve")', () => {
  it('ignores android.R and a library R, still flags the project R', () => {
    vi.spyOn(vscodeMock.workspace, 'onDidOpenTextDocument').mockReturnValue({ dispose: vi.fn() } as any);
    vi.spyOn(vscodeMock.workspace, 'onDidSaveTextDocument').mockReturnValue({ dispose: vi.fn() } as any);
    vi.spyOn(vscodeMock.workspace, 'onDidCloseTextDocument').mockReturnValue({ dispose: vi.fn() } as any);
    vi.spyOn(vscodeMock.workspace, 'onDidChangeTextDocument').mockReturnValue({ dispose: vi.fn() } as any);
    vi.spyOn(vscodeMock.workspace, 'onDidChangeConfiguration').mockReturnValue({ dispose: vi.fn() } as any);
    const collection = { set: vi.fn(), delete: vi.fn(), dispose: vi.fn() };
    vi.spyOn(vscodeMock.languages, 'createDiagnosticCollection').mockReturnValue(collection as any);
    const lines = ['getString(android.R.string.ok)', 'val c = com.google.android.material.R.color.abc', 'val mine = R.string.nope'];
    const doc = { languageId: 'kotlin', lineCount: lines.length, lineAt: (i: number) => ({ text: lines[i] }), uri: { toString: () => 'file:///T.kt' } };
    vi.spyOn(vscodeMock.window, 'visibleTextEditors', 'get').mockReturnValue([{ document: doc }] as any);
    new ResourceDiagnosticProvider(new StringResourceIndex(), new ColorResourceIndex()).dispose();
    const diags = collection.set.mock.calls.at(-1)![1] as any[];
    expect(diags.map(d => d.message)).toEqual(["Cannot resolve string resource 'nope'"]);
    vi.restoreAllMocks();
  });
});

describe('Manifest necessity — library components and tools:node="remove"', () => {
  const project = (sources: Array<{ path: string; text: string }>) => ({
    classExists: (fqn: string) => sources.some(s => new RegExp(`\\bclass\\s+${fqn.split('.').pop()}\\b`).test(s.text)),
    packageExists: (pkg: string) => sources.some(s => new RegExp(`^\\s*package\\s+${pkg.replace(/\./g, '\\.')}\\b`, 'm').test(s.text)),
    searchApiUsage: () => [],
  });
  it('does not call a FileProvider from androidx "class not found" (was: badge, graying and a removal quick fix)', () => {
    const xml = '<manifest package="com.app"><application><provider android:name="androidx.core.content.FileProvider" /><activity android:name=".Gone" /></application></manifest>';
    const r = analyzeManifest(xml, project([{ path: '/a/Main.kt', text: 'package com.app\nclass Main' }]));
    expect(r.components.find(c => c.name === 'androidx.core.content.FileProvider')?.status).not.toBe('missing-class');
    expect(r.components.find(c => c.name === '.Gone')?.status).toBe('missing-class');
  });
  it('skips a permission removed with tools:node="remove"', () => {
    const xml = '<manifest package="com.app" xmlns:tools="x"><uses-permission android:name="android.permission.CAMERA" tools:node="remove" /></manifest>';
    expect(analyzeManifest(xml, project([])).permissions).toEqual([]);
  });
});

describe('Dispatcher lens (was: viewModelScope.launch(Dispatchers.IO) accused itself of touching the View)', () => {
  it('ignores viewModel*/viewState* and softens the Main wording', () => {
    const code = 'fun load() {\n    viewModelScope.launch(Dispatchers.IO) {\n        viewState.value = Loading\n        binding.title.text = "x"\n    }\n}\n';
    const hints = analyzeDispatcherScopes(code).hints;
    expect(hints.map(h => h.line)).toEqual([3]);
  });
});

describe('Lifecycle pairing — Rx subscribe/dispose (was: "observable acquired in onStart() with no release")', () => {
  it('pairs the assigned Disposable with its dispose()', () => {
    const code = 'class A : Activity() {\n    override fun onStart() { disposable = observable.subscribe(::render) }\n    override fun onStop() { disposable.dispose() }\n}\n';
    expect(analyzeLifecyclePairs(code).orphans).toEqual([]);
  });
  it('still reports a subscription nobody disposes', () => {
    const code = 'class A : Activity() {\n    override fun onStart() { sub = observable.subscribe(::render) }\n    override fun onStop() { }\n}\n';
    expect(analyzeLifecyclePairs(code).orphans.map(o => o.resource)).toEqual(['sub']);
  });
});

describe('KMP badges — intermediate source sets (was: [ios ✗] with an actual in nativeMain)', () => {
  it('nativeMain covers ios*, appleMain covers macos, jvm stays uncovered', () => {
    expect(coversTarget('native', 'iosArm64')).toBe(true);
    expect(coversTarget('apple', 'macosX64')).toBe(true);
    expect(coversTarget('ios', 'iosSimulatorArm64')).toBe(true);
    expect(coversTarget('native', 'jvm')).toBe(false);
    expect(coverageLabel(new Set(['android', 'native']), new Set(['android', 'ios', 'iosArm64', 'jvm']))).toBe('[android ✓] [ios ✓] [iosArm64 ✓] [jvm ✗]');
  });
});

describe('Reverse string map — expression-body composable (was: it "showed" the strings of the class below it)', () => {
  it('attributes the string to the class, not the one-liner composable', () => {
    const text = '@Composable fun Spacer8() = Spacer(Modifier.height(8.dp))\nclass Analytics(ctx: Context) { val name = ctx.getString(R.string.app_name) }\n';
    expect(findDisplaySites('app_name', [{ path: '/a.kt', text }])).toEqual([{ enclosing: 'Analytics', isComposable: false }]);
  });
});

describe('KDoc generics and signatures with braces in strings', () => {
  it('escapes < and > outside code spans', () => {
    expect(escapeAngleBrackets('**Returns:** the Flow<User> stream and `List<Int>`')).toBe('**Returns:** the Flow\\<User\\> stream and `List<Int>`');
  });
  it('does not cut a signature at a brace inside a string literal', () => {
    const code = 'package p\nval OPEN = "{"\n';
    const index = new SymbolIndex();
    index.add(parse('file:///S.kt', code));
    expect(readSignature(mockDocument('file:///S.kt', code) as any, index.lookup('OPEN')[0]!)).toBe('val OPEN = "{"');
  });
  it('says "every minute" for */1', () => {
    expect(describeCron('*/1 * * * *')).toContain('every minute');
  });
});

describe('Signature help — named arguments (was: the parameter at the comma count was highlighted)', () => {
  it('highlights the parameter named at the cursor, and finds `x` at its own position', async () => {
    const declUri = 'file:///Sig.kt';
    const declCode = 'package p\nfun greetX(name: String, greeting: String = "Hi") {}\nfun getX(index: Int, x: Int) {}\n';
    const index = new SymbolIndex();
    index.add(parse(declUri, declCode));
    vi.spyOn(vscodeMock.workspace, 'openTextDocument').mockResolvedValue(mockDocument(declUri, declCode) as any);
    const provider = new KotlinSignatureHelpProvider(index);
    const token = { isCancellationRequested: false } as any;
    const ctx = { triggerKind: 1, triggerCharacter: undefined, isRetrigger: false } as any;
    const call = 'greetX(greeting = "Yo", name = ';
    const help = await provider.provideSignatureHelp(mockDocument('file:///C.kt', call) as any, new Position(0, call.length), token, ctx);
    expect(help?.activeParameter).toBe(0);
    const call2 = 'getX(1, ';
    const help2 = await provider.provideSignatureHelp(mockDocument('file:///C2.kt', call2) as any, new Position(0, call2.length), token, ctx);
    const sig = help2!.signatures[0]!;
    const xParam = sig.parameters[1]!.label as [number, number];
    expect(sig.label.slice(xParam[0], xParam[1])).toBe('x: Int');
    vi.restoreAllMocks();
  });
});
