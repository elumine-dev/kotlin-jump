// Regression tests for the ninth audit (2026-09-08).
import { describe, it, expect, vi } from 'vitest';
import { buildLocalScopeIndex, latestBinding } from '../../src/util/LocalScopeIndex';
import { escapeAngleBrackets, renderJavadocHtml } from '../../src/util/SignatureReader';
import { parseNaturalLanguage } from '../../src/ai/KotlinJumpChatParticipant';
import { findDisplaySites } from '../../src/providers/StringXmlHoverProvider';
import { KotlinSelectionRangeProvider } from '../../src/providers/SelectionRangeProvider';
import { SymbolIndex } from '../../src/indexer/SymbolIndex';
import { parse } from '../../src/indexer/KotlinParser';
import { mockDocument } from './helpers';
import { Position } from './__mocks__/vscode';

vi.mock('vscode', async () => import('./__mocks__/vscode'));

describe('Java switch — classic `case X:` (was: the 1.42.15 arm rule swallowed a lambda parameter on the case line)', () => {
  it('binds the lambda parameter after `case RED:` and still ignores `case RED, GREEN ->`', () => {
    const idx = buildLocalScopeIndex(['void f(Color c) {', '    switch (c) {', '        case RED: items.forEach(i -> log(i)); break;', '        default: other.forEach(k -> log(k));', '        case A, B -> paint();', '    }', '}'], 'java');
    expect(latestBinding(idx, 'i', 0, 2, 36)?.line).toBe(2);
    expect(latestBinding(idx, 'k', 0, 3, 40)?.line).toBe(3);
    expect(latestBinding(idx, 'B', 0, 4, 25)).toBeUndefined();
  });
});

describe('Javadoc HTML in hovers (was: `<p>` and `<code>` shown literally since the generic escape)', () => {
  it('renders the common tags as Markdown and still escapes generics', () => {
    expect(renderJavadocHtml('Returns the value.<p>Use <code>foo()</code> instead, see {@link Bar#baz}.')).toBe('Returns the value.\n\nUse `foo()` instead, see `Bar#baz`.');
    expect(escapeAngleBrackets('Use <code>foo()</code> on a Flow<User>')).toBe('Use `foo()` on a Flow\\<User\\>');
    expect(escapeAngleBrackets('> ⚠️ **Deprecated.** <b>x</b>')).toBe('> ⚠️ **Deprecated.** **x**');
  });
});

describe('Chat participant — natural phrasing (was: "usages of the UserRepository class" looked up `the`)', () => {
  it('skips articles, quotes and trailing kind words', () => {
    expect(parseNaturalLanguage('find all usages of the UserRepository class')).toEqual({ cmd: 'usages', query: 'UserRepository' });
    expect(parseNaturalLanguage('implementations of the Repository interface')).toEqual({ cmd: 'implementations', query: 'Repository' });
    expect(parseNaturalLanguage('usages of `Foo`')).toEqual({ cmd: 'usages', query: 'Foo' });
    expect(parseNaturalLanguage('doc for a Thing')).toEqual({ cmd: 'doc', query: 'Thing' });
  });
});

describe('Qualified R — roots only (was: `\\bandroid\\.` also matched com.example.android, and gms/firebase R were flagged)', () => {
  it('keeps a module named com.example.android, drops android.R, androidx and Google libraries', () => {
    const text = [
      'class A { fun a() = ctx.getString(com.example.android.R.string.cancel) }',
      'class B { fun b() = ctx.getString(android.R.string.cancel) }',
      'class C { fun c() = ctx.getString(com.google.firebase.messaging.R.string.cancel) }',
      'class D { fun d() = ctx.getString(androidx.core.R.string.cancel) }',
      'class E { fun e() = ctx.getString(com.app.feature.R.string.cancel) }',
    ].join('\n');
    expect(findDisplaySites('cancel', [{ path: '/a.kt', text }]).map(s => s.enclosing)).toEqual(['A', 'E']);
  });
});

describe('Expand Selection (was: the range of a function swallowed the KDoc and annotation of the next one)', () => {
  it('stops before the blank line, the KDoc and the @Composable of the following declaration', () => {
    const code = ['fun a() {', '    x()', '}', '', '/** doc for b */', '@Composable', 'fun B() {', '}', ''].join('\n');
    const index = new SymbolIndex();
    index.add(parse('file:///Sel.kt', code));
    const doc = mockDocument('file:///Sel.kt', code);
    const [range] = new KotlinSelectionRangeProvider(index).provideSelectionRanges(doc as any, [new Position(1, 5)], { isCancellationRequested: false } as any) as any[];
    expect(range.range.end.line).toBe(2);
  });
});
