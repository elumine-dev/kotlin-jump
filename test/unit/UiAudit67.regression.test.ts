/**
 * UiAudit67 — a primary constructor written under its class header.
 *
 * `ctorParamsActive`, the flag the property branch needs to tell a constructor
 * property from a local, was only ever armed at the very end of the class
 * branch. When ktlint wraps the header, the paren lands one line lower, the
 * flag stayed false, and the property branch dropped the declaration
 * ENTIRELY: not misfiled, absent. 42 sites on a 5088 file project, 37
 * properties invisible to the Outline, to Go to Definition and to Find Usages.
 *
 * After the fix, on the same project: 37 recovered, 0 symbol removed, 0 added
 * anywhere else.
 */
import { describe, it, expect } from 'vitest';
import { parse, type RawSymbol } from '../../src/indexer/KotlinParser';

const NL = String.fromCharCode(10);

function symboles(code: string): RawSymbol[] {
  return parse('file:///Guard.kt', code).symbols;
}

function noms(code: string): string[] {
  return symboles(code).map(s => s.name);
}

describe('UiAudit67 — primary constructor on its own line', () => {
  it('reads the properties of a constructor wrapped on the next line', () => {
    const code = [
      'package k',
      'internal class MergingSequence<T1, T2, V>',
      'constructor(',
      '    private val sequence1: Sequence<T1>,',
      '    private val sequence2: Sequence<T2>,',
      '    private val transform: (T1, T2) -> V',
      ') : Sequence<V> {',
      '    override fun iterator(): Iterator<V> = TODO()',
      '}',
    ].join(NL);
    expect(noms(code)).toEqual(['MergingSequence', 'sequence1', 'sequence2', 'transform', 'iterator']);
    const s1 = symboles(code).find(s => s.name === 'sequence1')!;
    expect(s1.isPrimaryCtorParam).toBe(true);
    expect(s1.kind).toBe('val');
    expect(s1.line).toBe(3);
  });

  it('accepts the modifiers Kotlin allows before the keyword', () => {
    const code = [
      'package k',
      'internal actual class SafeContinuation<in T>',
      'internal actual constructor(',
      '    private val delegate: Continuation<T>,',
      '    initialResult: Any?',
      ') {',
      '}',
    ].join(NL);
    expect(noms(code)).toEqual(['SafeContinuation', 'delegate']);
  });

  it('crosses an annotation sitting on its own line, the Dagger shape', () => {
    const code = [
      'package k',
      'class AdGlifAdRenderer',
      '@Inject',
      'constructor(',
      '    private val context: Context,',
      '    private val fileUtils: FileService',
      ') {',
      '}',
    ].join(NL);
    expect(noms(code)).toEqual(['AdGlifAdRenderer', 'context', 'fileUtils']);
  });

  it('reads a constructor closed on its own line, and a nested class', () => {
    // Real shape: the annotation carries arguments and the class is nested, so
    // the parameter has to land one level deeper than a top level one.
    const code = [
      'package k',
      'class PageEvents {',
      '    class PageOpenedEvent',
      '    @VisibleForTesting(otherwise = VisibleForTesting.PACKAGE_PRIVATE)',
      '    constructor(editionUid: EditionUid?, val sectionId: Int, pageUid: PageUid?) {',
      '    }',
      '}',
    ].join(NL);
    const s = symboles(code);
    expect(s.map(x => x.name)).toEqual(['PageEvents', 'PageOpenedEvent', 'sectionId']);
    const sec = s.find(x => x.name === 'sectionId')!;
    expect(sec.isPrimaryCtorParam).toBe(true);
    expect(sec.depth).toBe(2);
    expect(sec.line).toBe(4);
  });

  it('leaves the classic form untouched', () => {
    const code = ['package k', 'internal class Plain<T>(', '    private val only: Sequence<T>,', ') {', '}'].join(NL);
    const s = symboles(code);
    expect(s.map(x => x.name)).toEqual(['Plain', 'only']);
    expect(s[1].isPrimaryCtorParam).toBe(true);
  });

  it('lets go of the header after three lines, even mid edit', () => {
    // The parser reads files while they are being typed, so it sees shapes no
    // compiler would accept. Without a bound on the pending header, the flag
    // set by `class Marker` would still be live here and `leaked` would be
    // indexed as a property of a class it has nothing to do with.
    const code = [
      'package k',
      'class Marker',
      'fun a() {}',
      'fun b() {}',
      'fun c() {}',
      'constructor(val leaked: Int)',
    ].join(NL);
    expect(noms(code)).toEqual(['Marker', 'a', 'b', 'c']);
  });

  it('does not let one header arm the constructor of the next class', () => {
    const code = [
      'package k',
      'class Marker',
      'class Holder {',
      '    constructor(x: Int) {}',
      '}',
    ].join(NL);
    expect(noms(code)).toEqual(['Marker', 'Holder']);
  });

  it('keeps a secondary constructor inside a body out of the properties', () => {
    const code = [
      'package k',
      'class Config {',
      '    private val a: Int = 1',
      '    constructor(unNom: String) {',
      '    }',
      '}',
    ].join(NL);
    expect(noms(code)).toEqual(['Config', 'a']);
  });

  it('does not fire when the header already opened its body', () => {
    const code = ['package k', 'class Holder {', '    fun constructorLike(x: Int) {}', '}'].join(NL);
    expect(noms(code)).toEqual(['Holder', 'constructorLike']);
  });

  it('leaves a plain parameter out, only val and var become properties', () => {
    const code = [
      'package k',
      'class Only',
      'constructor(',
      '    simple: Int,',
      '    val kept: Int,',
      ') {',
      '}',
    ].join(NL);
    expect(noms(code)).toEqual(['Only', 'kept']);
  });
});
