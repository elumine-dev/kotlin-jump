import { describe, it, expect, beforeEach } from 'vitest';
import { insertImport, AutoImportProvider } from '../../src/providers/AutoImportProvider';
import { SymbolIndex } from '../../src/indexer/SymbolIndex';
import { parse } from '../../src/indexer/KotlinParser';
import { mockDocument, positionOf } from './helpers';
import { CodeActionTriggerKind, Position } from './__mocks__/vscode';
import * as vscodeMock from './__mocks__/vscode';

let _testId = 0;
/** Each call returns a unique URI to avoid ImportResolver module-level cache pollution. */
function freshUri() { return `file:///Test_${_testId++}.kt`; }

function addFile(index: SymbolIndex, uri: string, code: string) {
  index.add(parse(uri, code));
}

// ── insertImport — no existing imports ───────────────────────────────────────

describe('insertImport — no existing imports', () => {
  it('inserts after package line', () => {
    // line 0: 'package com.example', line 1: '' (blank), line 2: 'class Foo {}'
    // insertAt = 1; lines[1] is already blank → no extra leading \n
    const code = 'package com.example\n\nclass Foo {}';
    const doc  = mockDocument('file:///Foo.kt', code);
    const edit = insertImport(doc, 'androidx.compose.ui.Modifier');
    expect(edit.newText).toBe('import androidx.compose.ui.Modifier\n');
    expect(edit.range.start.line).toBe(1);
  });

  it('inserts at line 0 when no package declaration', () => {
    const code = 'class Foo {}';
    const doc  = mockDocument('file:///Foo.kt', code);
    const edit = insertImport(doc, 'com.example.Bar');
    expect(edit.newText).toBe('import com.example.Bar\n');
    expect(edit.range.start.line).toBe(0);
  });
});

// ── insertImport — alphabetical insertion ────────────────────────────────────

describe('insertImport — alphabetical insertion', () => {
  it('inserts before the first alphabetically greater import', () => {
    const code = [
      'package com.example',
      'import com.a.Alpha',
      'import com.z.Zebra',
      '',
      'class Foo',
    ].join('\n');
    const doc  = mockDocument('file:///Foo.kt', code);
    const edit = insertImport(doc, 'com.m.Middle');
    expect(edit.newText).toBe('import com.m.Middle\n');
    expect(edit.range.start.line).toBe(2);
  });

  it('appends after the last import when fqn is alphabetically last', () => {
    const code = [
      'import com.a.Alpha',
      'import com.m.Middle',
      '',
      'class Foo',
    ].join('\n');
    const doc  = mockDocument('file:///Foo.kt', code);
    const edit = insertImport(doc, 'com.z.Zebra');
    expect(edit.newText).toBe('import com.z.Zebra\n');
    expect(edit.range.start.line).toBe(2);
  });

  it('inserts before existing single import when alphabetically first', () => {
    const code = [
      'import com.z.Zebra',
      '',
      'class Foo',
    ].join('\n');
    const doc  = mockDocument('file:///Foo.kt', code);
    const edit = insertImport(doc, 'com.a.Alpha');
    expect(edit.newText).toBe('import com.a.Alpha\n');
    expect(edit.range.start.line).toBe(0);
  });
});

// ── insertImport — realistic Compose file ────────────────────────────────────

describe('insertImport — realistic Compose file', () => {
  const code = [
    'package com.example.ui',
    '',
    'import androidx.compose.foundation.layout.Column',
    'import androidx.compose.foundation.layout.Row',
    'import androidx.compose.material3.Text',
    '',
    '@Composable',
    'fun MyScreen() {}',
  ].join('\n');

  it('inserts between existing imports alphabetically', () => {
    const doc  = mockDocument('file:///MyScreen.kt', code);
    const edit = insertImport(doc, 'androidx.compose.foundation.layout.Padding');
    expect(edit.newText).toBe('import androidx.compose.foundation.layout.Padding\n');
    // Padding > Column, Padding < Row → inserted at line 3 (before Row)
    expect(edit.range.start.line).toBe(3);
  });

  it('appends after last import when fqn sorts last', () => {
    const doc  = mockDocument('file:///MyScreen.kt', code);
    const edit = insertImport(doc, 'kotlin.collections.List');
    expect(edit.newText).toBe('import kotlin.collections.List\n');
    expect(edit.range.start.line).toBe(5);
  });
});

// ── AutoImportProvider — Android/Compose context ─────────────────────────────

const COMPOSE_RUNTIME_URI = 'file:///compose/runtime/remember.kt';
const COMPOSE_RUNTIME_CODE = `package androidx.compose.runtime

fun remember(calculation: () -> Any): Any = calculation()
fun mutableStateOf(value: Any): Any = TODO()
fun derivedStateOf(calculation: () -> Any): Any = TODO()`;

const LAZY_COLUMN_URI = 'file:///compose/lazy/LazyColumn.kt';
const LAZY_COLUMN_CODE = `package androidx.compose.foundation.lazy

@Composable
fun LazyColumn(content: () -> Unit) {}`;

const HILT_URI = 'file:///hilt/ViewModel.kt';
const HILT_CODE = `package androidx.hilt.navigation.compose

fun hiltViewModel(): Any = TODO()`;

function makeContext(triggerKind: number, diagnostics: any[] = []) {
  return { triggerKind, diagnostics, only: undefined } as any;
}

describe('AutoImportProvider — Android/Compose scenarios', () => {
  let index: SymbolIndex;
  let provider: AutoImportProvider;

  beforeEach(() => {
    index = new SymbolIndex();
    addFile(index, COMPOSE_RUNTIME_URI, COMPOSE_RUNTIME_CODE);
    addFile(index, LAZY_COLUMN_URI, LAZY_COLUMN_CODE);
    addFile(index, HILT_URI, HILT_CODE);
    provider = new AutoImportProvider(index);
  });

  // ── Manual trigger only ───────────────────────────────────────────────────

  it('returns nothing on Automatic trigger (no lightbulb spam)', () => {
    const code = 'package com.example\nfun test() { LazyColumn {} }';
    const doc  = mockDocument(freshUri(), code);
    const pos  = positionOf(code, 'LazyColumn');
    const ctx  = makeContext(CodeActionTriggerKind.Automatic);
    expect(provider.provideCodeActions(doc, { start: pos } as any, ctx, {} as any)).toBeUndefined();
  });

  // ── Capitalized Compose types ─────────────────────────────────────────────

  it('suggests import for unresolved LazyColumn (capitalized Compose composable)', () => {
    const code = 'package com.example\n\nfun test() { LazyColumn {} }';
    const doc  = mockDocument(freshUri(), code);
    const pos  = positionOf(code, 'LazyColumn');
    const ctx  = makeContext(CodeActionTriggerKind.Invoke);
    const actions = provider.provideCodeActions(doc, { start: pos } as any, ctx, {} as any);
    expect(actions).toBeDefined();
    expect(actions!.length).toBeGreaterThanOrEqual(1);
    expect(actions![0].title).toContain('LazyColumn');
  });

  // ── Lowercase Compose functions — the critical Android case ──────────────

  it('suggests import for unresolved `remember` (lowercase Compose runtime function)', () => {
    const code = 'package com.example\n\nfun test() { val x = remember { 0 } }';
    const doc  = mockDocument(freshUri(), code);
    const pos  = positionOf(code, 'remember');
    const ctx  = makeContext(CodeActionTriggerKind.Invoke);
    const actions = provider.provideCodeActions(doc, { start: pos } as any, ctx, {} as any);
    expect(actions).toBeDefined();
    expect(actions!.some(a => a.title.includes('remember'))).toBe(true);
  });

  it('suggests import for unresolved `mutableStateOf` (lowercase)', () => {
    const code = 'package com.example\n\nfun test() { val s = mutableStateOf(0) }';
    const doc  = mockDocument(freshUri(), code);
    const pos  = positionOf(code, 'mutableStateOf');
    const ctx  = makeContext(CodeActionTriggerKind.Invoke);
    const actions = provider.provideCodeActions(doc, { start: pos } as any, ctx, {} as any);
    expect(actions).toBeDefined();
    expect(actions!.some(a => a.title.includes('mutableStateOf'))).toBe(true);
  });

  it('suggests import for unresolved `hiltViewModel` (lowercase)', () => {
    const code = 'package com.example\n\nfun test() { val vm = hiltViewModel<MyVm>() }';
    const doc  = mockDocument(freshUri(), code);
    const pos  = positionOf(code, 'hiltViewModel');
    const ctx  = makeContext(CodeActionTriggerKind.Invoke);
    const actions = provider.provideCodeActions(doc, { start: pos } as any, ctx, {} as any);
    expect(actions).toBeDefined();
    expect(actions!.some(a => a.title.includes('hiltViewModel'))).toBe(true);
  });

  // ── Wildcard import suppresses suggestion ─────────────────────────────────

  it('does not suggest `remember` when already covered by wildcard import', () => {
    const code = [
      'package com.example',
      'import androidx.compose.runtime.*',
      '',
      'fun test() { val x = remember { 0 } }',
    ].join('\n');
    const doc  = mockDocument(freshUri(), code);
    const pos  = positionOf(code, 'remember');
    const ctx  = makeContext(CodeActionTriggerKind.Invoke);
    // resolveBest returns priority='wildcard' → provider returns undefined
    const actions = provider.provideCodeActions(doc, { start: pos } as any, ctx, {} as any);
    expect(actions).toBeUndefined();
  });

  // ── Keywords never get suggested ─────────────────────────────────────────

  it('never suggests import for Kotlin keywords', () => {
    const keywords = ['val', 'var', 'fun', 'class', 'if', 'for', 'when', 'return', 'null', 'true'];
    for (const kw of keywords) {
      const code = `package com.example\n\nfun test() { ${kw} }`;
      const doc  = mockDocument(freshUri(), code);
      const pos  = positionOf(code, kw);
      const ctx  = makeContext(CodeActionTriggerKind.Invoke);
      const actions = provider.provideCodeActions(doc, { start: pos } as any, ctx, {} as any);
      expect(actions, `keyword '${kw}' should never be suggested`).toBeUndefined();
    }
  });

  // ── Short names never get suggested ──────────────────────────────────────

  it('skips words shorter than 3 characters', () => {
    const code = 'package com.example\nfun test() { it }';
    const doc  = mockDocument(freshUri(), code);
    const pos  = positionOf(code, ' it') ; // avoid 'it' in 'test'
    // Use a fresh simpler code to avoid position ambiguity
    const code2 = 'package pkg\nval x = it';
    const doc2  = mockDocument('file:///T.kt', code2);
    const pos2  = positionOf(code2, 'it');
    const ctx   = makeContext(CodeActionTriggerKind.Invoke);
    const actions = provider.provideCodeActions(doc2, { start: pos2 } as any, ctx, {} as any);
    expect(actions).toBeUndefined();
  });

  // ── isPreferred only when single candidate ────────────────────────────────

  it('marks isPreferred=true when there is exactly one candidate', () => {
    // hiltViewModel has only one indexed entry
    const code = 'package com.example\n\nfun test() { val vm = hiltViewModel<Vm>() }';
    const doc  = mockDocument(freshUri(), code);
    const pos  = positionOf(code, 'hiltViewModel');
    const ctx  = makeContext(CodeActionTriggerKind.Invoke);
    const actions = provider.provideCodeActions(doc, { start: pos } as any, ctx, {} as any)!;
    expect(actions).toHaveLength(1);
    expect(actions[0].isPreferred).toBe(true);
  });
});

// ── ADVERSARIAL: insertImport — import block anomalies ───────────────────────

describe('insertImport — adversarial: import block anomalies', () => {
  it('handles Java static import in block — sorts correctly', () => {
    const code = [
      'package com.example',
      'import static android.util.Log.d',
      'import com.z.Zebra',
      '',
      'class Foo',
    ].join('\n');
    const doc  = mockDocument('file:///Foo.kt', code);
    // 'com.example.Bar' sorts after 'com.z.Zebra' alphabetically? No: com.e < com.z
    const edit = insertImport(doc, 'com.example.Bar');
    expect(edit.newText).toBe('import com.example.Bar\n');
    // 'com.example.Bar' > 'com.z.Zebra'? No: 'com.e' < 'com.z' so insert before Zebra
    // static android < com.example < com.z  → insert at line 2 (before com.z.Zebra)
    expect(edit.range.start.line).toBe(2);
  });

  it('handles aliased import — treated as normal import line', () => {
    const code = [
      'import com.a.Alpha as A',
      'import com.z.Zebra',
      '',
      'class Foo',
    ].join('\n');
    const doc  = mockDocument('file:///Foo.kt', code);
    const edit = insertImport(doc, 'com.m.Middle');
    expect(edit.newText).toBe('import com.m.Middle\n');
    expect(edit.range.start.line).toBe(1); // before Zebra
  });

  it('handles blank lines inside import block — lastImportLine is the last import, not last blank', () => {
    // Import block has a blank line in the middle; lastImportLine should still be line 2
    const code = [
      'import com.a.Alpha',
      '',
      'import com.z.Zebra',
      '',
      'class Foo',
    ].join('\n');
    const doc  = mockDocument('file:///Foo.kt', code);
    const edit = insertImport(doc, 'com.n.New');
    // firstImportLine = 0, lastImportLine = 2 (line with Zebra)
    // 'com.n.New' > 'com.a.Alpha', 'com.n.New' < 'com.z.Zebra' → insert at line 2
    expect(edit.range.start.line).toBe(2);
  });

  it('handles inline comment after import — comment line not mistaken as import', () => {
    const code = [
      'import com.a.Alpha  // keep',
      'import com.z.Zebra',
      '',
      'class Foo',
    ].join('\n');
    const doc  = mockDocument('file:///Foo.kt', code);
    const edit = insertImport(doc, 'com.m.Middle');
    expect(edit.range.start.line).toBe(1); // before Zebra
  });
});

// ── ADVERSARIAL: insertImport — file structure edge cases ────────────────────

describe('insertImport — adversarial: file structure edge cases', () => {
  it('empty file — inserts at line 0 without crash', () => {
    const doc  = mockDocument('file:///Empty.kt', '');
    const edit = insertImport(doc, 'com.example.Foo');
    expect(edit.newText).toBe('import com.example.Foo\n');
    expect(edit.range.start.line).toBe(0);
  });

  it('package only, no trailing newline — inserts on line 1 without extra blank', () => {
    // 'package com.example' (no newline after) → lines = ['package com.example']
    const doc  = mockDocument('file:///Pkg.kt', 'package com.example');
    const edit = insertImport(doc, 'com.foo.Bar');
    // insertAt = 1, but lines[1] is undefined → prefix '' (undefined?.trim() === undefined !== '')
    expect(edit.range.start.line).toBe(1);
    expect(edit.newText).toContain('import com.foo.Bar');
  });

  it('package immediately followed by class (no blank line) — adds separator', () => {
    const code = 'package com.example\nclass Foo {}';
    const doc  = mockDocument('file:///Pkg.kt', code);
    const edit = insertImport(doc, 'com.bar.Bar');
    // insertAt = 1, lines[1] = 'class Foo {}' (not blank) → prefix = '\n'
    expect(edit.newText).toBe('\nimport com.bar.Bar\n');
    expect(edit.range.start.line).toBe(1);
  });

  it('FQN equal to existing import — appended after last (no infinite loop)', () => {
    const code = [
      'import com.a.Alpha',
      'import com.m.Middle',
      '',
      'class Foo',
    ].join('\n');
    const doc  = mockDocument('file:///Foo.kt', code);
    // 'com.m.Middle' is not < 'com.a.Alpha' nor < 'com.m.Middle' → appended
    const edit = insertImport(doc, 'com.m.Middle');
    expect(edit.range.start.line).toBe(2); // after lastImportLine (1)
  });
});

// ── ADVERSARIAL: insertImport — FQN sort order ───────────────────────────────

describe('insertImport — adversarial: FQN sort order', () => {
  it('FQN with underscore sorts correctly (underscore < lowercase letters in ASCII)', () => {
    const code = [
      'import com.a.Alpha',
      'import com.z.Zebra',
      '',
      'class Foo',
    ].join('\n');
    const doc  = mockDocument('file:///Foo.kt', code);
    // 'com._internal.Foo': '_' (95) < 'a' (97) so it comes before 'com.a.Alpha'
    const edit = insertImport(doc, 'com._internal.Foo');
    expect(edit.range.start.line).toBe(0); // before Alpha
  });

  it('FQN with digits sorts correctly', () => {
    const code = [
      'import com.example.Foo',
      'import com.example3.Baz',
      '',
      'class X',
    ].join('\n');
    const doc  = mockDocument('file:///X.kt', code);
    // 'com.example2.Bar': '2' < '3' → after 'com.example.Foo', before 'com.example3.Baz'
    const edit = insertImport(doc, 'com.example2.Bar');
    expect(edit.range.start.line).toBe(1); // before com.example3
  });
});

// ── ADVERSARIAL: provideCodeActions — word length / boundary guards ──────────

describe('AutoImportProvider — adversarial: word length guards', () => {
  let index: SymbolIndex;
  let provider: AutoImportProvider;

  const SHORT_URI = 'file:///lib/Short.kt';
  const SHORT_CODE = `package lib
class Abc {}
class Ab {}`;

  beforeEach(() => {
    index = new SymbolIndex();
    addFile(index, SHORT_URI, SHORT_CODE);
    provider = new AutoImportProvider(index);
  });

  it('suggests for exactly-3-char symbol (boundary: length < 3 excluded, 3 allowed)', () => {
    const code = 'package com.example\nfun f() { Abc() }';
    const doc  = mockDocument(freshUri(), code);
    const pos  = positionOf(code, 'Abc');
    const ctx  = makeContext(CodeActionTriggerKind.Invoke);
    const actions = provider.provideCodeActions(doc, { start: pos } as any, ctx, {} as any);
    expect(actions).toBeDefined();
    expect(actions!.some(a => a.title.includes('Abc'))).toBe(true);
  });

  it('skips 2-char symbol (length < 3)', () => {
    const code = 'package com.example\nfun f() { Ab() }';
    const doc  = mockDocument(freshUri(), code);
    const pos  = positionOf(code, 'Ab');
    const ctx  = makeContext(CodeActionTriggerKind.Invoke);
    const actions = provider.provideCodeActions(doc, { start: pos } as any, ctx, {} as any);
    expect(actions).toBeUndefined();
  });

  it('returns undefined when cursor is on whitespace (no word range)', () => {
    const code = 'package com.example\nfun f() {  }';
    const doc  = mockDocument(freshUri(), code);
    // Position in the middle of spaces — no word range
    const pos  = { line: 1, character: 10 } as any;
    const ctx  = makeContext(CodeActionTriggerKind.Invoke);
    expect(provider.provideCodeActions(doc, { start: pos } as any, ctx, {} as any)).toBeUndefined();
  });

  it('returns undefined when cursor is on line beyond file length', () => {
    const code = 'package com.example\n';
    const doc  = mockDocument(freshUri(), code);
    const pos  = { line: 99, character: 0 } as any;
    const ctx  = makeContext(CodeActionTriggerKind.Invoke);
    expect(provider.provideCodeActions(doc, { start: pos } as any, ctx, {} as any)).toBeUndefined();
  });
});

// ── ADVERSARIAL: provideCodeActions — keyword filter ────────────────────────

describe('AutoImportProvider — adversarial: keyword filter', () => {
  let index: SymbolIndex;
  let provider: AutoImportProvider;

  beforeEach(() => {
    // Index keywords as if they were classes — the filter must block them regardless
    index = new SymbolIndex();
    addFile(index, 'file:///k/Unit.kt',    'package k\nclass Unit {}');
    addFile(index, 'file:///k/String.kt',  'package k\nclass String {}');
    addFile(index, 'file:///k/suspend.kt', 'package k\nfun suspend() {}');
    addFile(index, 'file:///k/TODO.kt',    'package k\nfun TODO(): Nothing = TODO()');
    provider = new AutoImportProvider(index);
  });

  it('never suggests `Unit` (stdlib builtin in keyword list)', () => {
    const code = 'package x\nfun f(): Unit {}';
    const doc  = mockDocument(freshUri(), code);
    const pos  = positionOf(code, 'Unit');
    const ctx  = makeContext(CodeActionTriggerKind.Invoke);
    expect(provider.provideCodeActions(doc, { start: pos } as any, ctx, {} as any)).toBeUndefined();
  });

  it('never suggests `String` (stdlib builtin in keyword list)', () => {
    const code = 'package x\nfun f(s: String) {}';
    const doc  = mockDocument(freshUri(), code);
    const pos  = positionOf(code, 'String');
    const ctx  = makeContext(CodeActionTriggerKind.Invoke);
    expect(provider.provideCodeActions(doc, { start: pos } as any, ctx, {} as any)).toBeUndefined();
  });

  it('never suggests `suspend` (Kotlin keyword)', () => {
    const code = 'package x\nsuspend fun f() {}';
    const doc  = mockDocument(freshUri(), code);
    const pos  = positionOf(code, 'suspend');
    const ctx  = makeContext(CodeActionTriggerKind.Invoke);
    expect(provider.provideCodeActions(doc, { start: pos } as any, ctx, {} as any)).toBeUndefined();
  });

  it('never suggests `TODO` (stdlib builtin in keyword list)', () => {
    const code = 'package x\nfun f() = TODO()';
    const doc  = mockDocument(freshUri(), code);
    const pos  = positionOf(code, 'TODO');
    const ctx  = makeContext(CodeActionTriggerKind.Invoke);
    expect(provider.provideCodeActions(doc, { start: pos } as any, ctx, {} as any)).toBeUndefined();
  });

  it('suggests `Val` (mixed-case — not in keyword list)', () => {
    // 'Val' is not a keyword; if indexed, it should be suggested
    addFile(index, 'file:///k/Val.kt', 'package k\nclass Val {}');
    const code = 'package x\nfun f() { Val() }';
    const doc  = mockDocument(freshUri(), code);
    const pos  = positionOf(code, 'Val');
    const ctx  = makeContext(CodeActionTriggerKind.Invoke);
    const actions = provider.provideCodeActions(doc, { start: pos } as any, ctx, {} as any);
    expect(actions).toBeDefined();
  });
});

// ── ADVERSARIAL: provideCodeActions — resolution priority suppression ────────

describe('AutoImportProvider — adversarial: resolution priority suppression', () => {
  let index: SymbolIndex;
  let provider: AutoImportProvider;

  beforeEach(() => {
    index = new SymbolIndex();
    addFile(index, 'file:///lib/Widget.kt', 'package com.bar\nclass Widget {}');
    addFile(index, 'file:///lib/Foo.kt',    'package com.foo\nclass Foo {}');
    provider = new AutoImportProvider(index);
  });

  it('no suggestion when symbol resolved via exact import', () => {
    const code = [
      'package com.example',
      'import com.bar.Widget',
      '',
      'fun test() { Widget() }',
    ].join('\n');
    const doc  = mockDocument(freshUri(), code);
    const pos  = positionOf(code, 'Widget');
    const ctx  = makeContext(CodeActionTriggerKind.Invoke);
    expect(provider.provideCodeActions(doc, { start: pos } as any, ctx, {} as any)).toBeUndefined();
  });

  it('no suggestion when symbol is in same package', () => {
    const code = 'package com.bar\nfun test() { Widget() }';
    const doc  = mockDocument(freshUri(), code);
    const pos  = positionOf(code, 'Widget');
    const ctx  = makeContext(CodeActionTriggerKind.Invoke);
    // resolveBest → samePackageCandidates → 'com.bar.Widget' found in index → priority='samePackage'
    expect(provider.provideCodeActions(doc, { start: pos } as any, ctx, {} as any)).toBeUndefined();
  });

  it('shows suggestion when wildcard import does NOT cover the symbol', () => {
    const code = [
      'package com.example',
      'import com.foo.*',  // covers com.foo.Foo but NOT com.bar.Widget
      '',
      'fun test() { Widget() }',
    ].join('\n');
    const doc  = mockDocument(freshUri(), code);
    const pos  = positionOf(code, 'Widget');
    const ctx  = makeContext(CodeActionTriggerKind.Invoke);
    const actions = provider.provideCodeActions(doc, { start: pos } as any, ctx, {} as any);
    expect(actions).toBeDefined();
    expect(actions!.some(a => a.title.includes('Widget'))).toBe(true);
  });
});

// ── ADVERSARIAL: provideCodeActions — multi-candidate ranking ────────────────

describe('AutoImportProvider — adversarial: multi-candidate ranking', () => {
  let index: SymbolIndex;
  let provider: AutoImportProvider;

  beforeEach(() => {
    index = new SymbolIndex();
    provider = new AutoImportProvider(index);
  });

  it('class candidate ranked before fun candidate of same name', () => {
    addFile(index, 'file:///a/Result.kt', 'package pkg.a\nclass Result {}');
    addFile(index, 'file:///b/Result.kt', 'package pkg.b\nfun Result(): Any = TODO()');
    const code = 'package com.example\nfun test() { Result() }';
    const doc  = mockDocument(freshUri(), code);
    const pos  = positionOf(code, 'Result');
    const ctx  = makeContext(CodeActionTriggerKind.Invoke);
    const actions = provider.provideCodeActions(doc, { start: pos } as any, ctx, {} as any)!;
    expect(actions.length).toBeGreaterThanOrEqual(2);
    // First action should be the class, not the fun
    expect(actions[0].title).toContain('pkg.a.Result');
  });

  it('caps at MAX_CANDIDATES (8) when 9+ candidates exist', () => {
    // Add 9 different packages each with a class named 'MyWidget'
    for (let i = 0; i < 9; i++) {
      addFile(index, `file:///p${i}/MyWidget.kt`, `package pkg${i}\nclass MyWidget {}`);
    }
    const code = 'package com.example\nfun test() { MyWidget() }';
    const doc  = mockDocument(freshUri(), code);
    const pos  = positionOf(code, 'MyWidget');
    const ctx  = makeContext(CodeActionTriggerKind.Invoke);
    const actions = provider.provideCodeActions(doc, { start: pos } as any, ctx, {} as any)!;
    expect(actions).toHaveLength(8);
  });

  it('isPreferred=false when multiple candidates exist', () => {
    addFile(index, 'file:///x/Foo.kt', 'package pkgx\nclass Foo {}');
    addFile(index, 'file:///y/Foo.kt', 'package pkgy\nclass Foo {}');
    const code = 'package com.example\nfun test() { Foo() }';
    const doc  = mockDocument(freshUri(), code);
    const pos  = positionOf(code, 'Foo');
    const ctx  = makeContext(CodeActionTriggerKind.Invoke);
    const actions = provider.provideCodeActions(doc, { start: pos } as any, ctx, {} as any)!;
    expect(actions.length).toBe(2);
    expect(actions.every(a => a.isPreferred === false)).toBe(true);
  });
});

// ── ADVERSARIAL: autoImport.enabled = false ───────────────────────────────────

describe('AutoImportProvider — adversarial: disabled via config', () => {
  it('returns undefined when kotlinJump.autoImport.enabled is false', () => {
    const orig = vscodeMock.workspace.getConfiguration;
    // Override: all `get` calls return false (which disables autoImport.enabled)
    vscodeMock.workspace.getConfiguration = () => ({ get: (_k: string, _d: any) => false }) as any;
    try {
      const idx = new SymbolIndex();
      addFile(idx, 'file:///Lazy.kt',
        'package androidx.compose.foundation.lazy\n@Composable\nfun LazyColumn(content: () -> Unit) {}');
      const prov = new AutoImportProvider(idx);
      const code = 'package com.example\nfun test() { LazyColumn {} }';
      const doc  = mockDocument(freshUri(), code);
      const pos  = positionOf(code, 'LazyColumn');
      const ctx  = makeContext(CodeActionTriggerKind.Invoke);
      expect(prov.provideCodeActions(doc, { start: pos } as any, ctx, {} as any)).toBeUndefined();
    } finally {
      vscodeMock.workspace.getConfiguration = orig;
    }
  });
});

// ── ADVERSARIAL: insertImport — @file annotation before package ───────────────

describe('insertImport — adversarial: @file annotation before package', () => {
  it('still inserts after the package line when @file annotation comes first', () => {
    const code = [
      '@file:Suppress("UNCHECKED_CAST")',
      'package com.example',
      '',
      'class Foo',
    ].join('\n');
    const doc  = mockDocument('file:///Ann.kt', code);
    const edit = insertImport(doc, 'com.other.Bar');
    // insertAt = 2 (line after `package com.example`); lines[2]='' → no separator
    expect(edit.range.start.line).toBe(2);
    expect(edit.newText).toBe('import com.other.Bar\n');
  });

  it('no-blank-line separator when insertAt=0 (file has no package line)', () => {
    // Pure class file with no package declaration
    const code = 'class Isolated {}';
    const doc  = mockDocument('file:///Iso.kt', code);
    const edit = insertImport(doc, 'com.example.Dep');
    // insertAt=0 → condition `insertAt > 0` is false → no '\n' prefix
    expect(edit.range.start.line).toBe(0);
    expect(edit.newText).toBe('import com.example.Dep\n');
    expect(edit.newText.startsWith('\n')).toBe(false);
  });
});

// ── ADVERSARIAL: ranking — composable before fun ──────────────────────────────

describe('AutoImportProvider — adversarial: composable ranked before fun', () => {
  it('composable candidate appears before plain fun candidate of same name', () => {
    const idx = new SymbolIndex();
    // Register the plain fun FIRST to prove sorting overrides insertion order
    addFile(idx, 'file:///a/Button.kt', 'package com.a\nfun Button() {}');
    addFile(idx, 'file:///b/Button.kt', 'package com.b\n@Composable\nfun Button() {}');
    const prov = new AutoImportProvider(idx);
    const code = 'package com.main\nfun test() { Button() }';
    const doc  = mockDocument(freshUri(), code);
    const pos  = positionOf(code, 'Button');
    const ctx  = makeContext(CodeActionTriggerKind.Invoke);
    const actions = prov.provideCodeActions(doc, { start: pos } as any, ctx, {} as any)!;
    expect(actions).toHaveLength(2);
    // composable (com.b) must come before plain fun (com.a)
    expect(actions[0].title).toContain('com.b');
    expect(actions[1].title).toContain('com.a');
  });
});

// ── ADVERSARIAL: scope/extension functions in keyword list ───────────────────

describe('AutoImportProvider — adversarial: scope functions in keyword list', () => {
  it('never suggests imports for Kotlin scope extension functions', () => {
    // Even if these names are indexed, they must be blocked by KOTLIN_KEYWORDS
    const idx = new SymbolIndex();
    for (const fn of ['also', 'let', 'run', 'apply', 'with', 'repeat', 'takeIf', 'takeUnless']) {
      addFile(idx, `file:///scope/${fn}.kt`, `package scope\nfun ${fn}(f: () -> Unit) {}`);
    }
    const prov = new AutoImportProvider(idx);
    for (const fn of ['also', 'let', 'run', 'apply', 'with', 'repeat', 'takeIf', 'takeUnless']) {
      const code = `package com.example\nfun test() { ${fn} {} }`;
      const doc  = mockDocument(freshUri(), code);
      const pos  = positionOf(code, fn);
      const ctx  = makeContext(CodeActionTriggerKind.Invoke);
      expect(
        prov.provideCodeActions(doc, { start: pos } as any, ctx, {} as any),
        `scope fn '${fn}' must be filtered even when indexed`,
      ).toBeUndefined();
    }
  });
});
