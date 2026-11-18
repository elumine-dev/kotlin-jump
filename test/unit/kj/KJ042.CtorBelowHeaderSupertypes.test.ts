import { describe, it, expect } from 'vitest';
import { parse } from '../../../src/indexer/KotlinParser';
import { importOrNull } from './harness';

/**
 * ktlint wraps an injected class like this:
 *
 *   class AppPreferencesSerializer
 *       @Inject
 *       constructor() : Serializer<AppPreferences> {
 *
 * The parser read the supertype list after the class NAME only, so this class
 * had no parent. Its ancestor chain then looked fully visible (an empty chain
 * resolves), the `override` guard of the member scan stood down, and
 * `readFrom` / `writeTo`, which implement an AndroidX interface, were cut as
 * unreferenced. Seen on an open source TV app: the cut tree no longer
 * compiled. 96 classes over 8 projects had lost their parents the same way,
 * in the type hierarchy too.
 */

const supers = (text: string, name: string): string[] | undefined =>
  (parse('file:///w/a/S.kt', text).symbols as any[]).find(s => s.name === name)?.supertypes;

describe('supertypes of a primary constructor written under its header', () => {
  it('annotation then constructor on the next lines', () => {
    expect(supers('package a\n\nclass S\n    @Inject\n    constructor() : Serializer<P> {\n}\n', 'S')).toEqual(['Serializer']);
  });

  it('bare constructor on the next line, with a superclass call', () => {
    expect(supers('package a\n\nclass S\nconstructor(x: Int) : Base(x) {\n}\n', 'S')).toEqual(['Base']);
  });

  it('constructor parameters over several lines', () => {
    const t = 'package a\n\nclass VM\n    @Inject\n    constructor(\n        private val repo: Repo,\n    ) : ViewModel(), Callback {\n}\n';
    expect(supers(t, 'VM')).toEqual(['ViewModel', 'Callback']);
  });

  it('supertype list wrapped after the colon', () => {
    const t = 'package a\n\nclass VM\n    @Inject\n    constructor(private val repo: Repo) :\n        ViewModel(),\n        Callback {\n}\n';
    expect(supers(t, 'VM')).toEqual(['ViewModel', 'Callback']);
  });

  it('two annotations, a visibility modifier and a type parameter', () => {
    const t = 'package a\n\nclass S<T>\n    @Inject\n    @JvmOverloads\n    internal constructor(x: Int = 0) : Base<T>(x) {\n}\n';
    expect(supers(t, 'S')).toEqual(['Base']);
  });

  // Second shape, same consequence, seen on a KMP app: `) :` ends the line
  // and the list starts below. 2 of 39 such headers were read over 6 projects.
  it('`) :` alone on its line, the superclass call below', () => {
    const t = 'package a\n\nprivate class G(\n    application: Application,\n    private val back: () -> Unit,\n) :\n    PrivilegeUiViewModel(\n        application,\n        cfg,\n    ) {\n    override fun onBackClick(): Boolean = true\n}\n';
    expect(supers(t, 'G')).toEqual(['PrivilegeUiViewModel']);
  });

  it('`) :` alone, two supertypes below', () => {
    expect(supers('package a\n\nclass G(\n    x: Int,\n) :\n    Base(x),\n    Callback {\n}\n', 'G')).toEqual(['Base', 'Callback']);
  });

  it('`) :` alone after a constructor written under the header', () => {
    expect(supers('package a\n\nclass G\n    @Inject\n    constructor(\n        x: Int,\n    ) :\n        Base(x) {\n}\n', 'G')).toEqual(['Base']);
  });

  it('control: a constructor with no supertype gives none', () => {
    expect(supers('package a\n\nclass S\n    @Inject\n    constructor(private val x: X) {\n    fun f(): Int = 1\n}\n', 'S')).toBeUndefined();
  });

  it('control: the secondary constructor of the NEXT class is not borrowed', () => {
    const t = 'package a\n\nclass Marker\n\nclass Other {\n    constructor(x: Int) : this()\n}\n';
    expect(supers(t, 'Marker')).toBeUndefined();
    expect(supers(t, 'Other')).toBeUndefined();
  });

  it('control: the constructor properties are still indexed', () => {
    const t = 'package a\n\nclass VM\n    @Inject\n    constructor(\n        private val repo: Repo,\n    ) : ViewModel() {\n}\n';
    expect((parse('file:///w/a/S.kt', t).symbols as any[]).some(s => s.name === 'repo' && s.kind === 'val')).toBe(true);
  });
});

const mod: any = await importOrNull('src/providers/unusedMembers');
const MAIN = '/w/app/src/main/kotlin/com/x';

describe.skipIf(!mod)('the member scan keeps the overrides of such a class', () => {
  const scan = (header: string): string[] => {
    const t = `package com.x\n\nimport androidx.datastore.core.Serializer\nimport javax.inject.Inject\n\n${header} {\n`
      + '        override val defaultValue: P = P()\n\n'
      + '        override suspend fun readFrom(input: InputStream): P = P.parseFrom(input)\n\n'
      + '        override suspend fun writeTo(t: P, output: OutputStream) = t.writeTo(output)\n'
      + '    }\n';
    const user = 'package com.x\n\nclass Store @Inject constructor(private val s: PrefsSerializer) {\n    fun go() = s.toString()\n}\n';
    const sources = [{ path: `${MAIN}/PrefsSerializer.kt`, text: t }, { path: `${MAIN}/Store.kt`, text: user }];
    return (mod.findUnusedMembers({ sources, testSourceSets: ['test/java', 'test/kotlin'], deadDeclarations: [] }) as any[]).map(m => m.name);
  };

  it('ktlint layout: neither readFrom nor writeTo is reported', () => {
    const found = scan('class PrefsSerializer\n    @Inject\n    constructor() : Serializer<P>');
    expect(found).not.toContain('readFrom');
    expect(found).not.toContain('writeTo');
  });

  it('`) :` alone: the override of an outside parent is not reported either', () => {
    const t = 'package com.x\n\nimport priv.kit.ui.PrivilegeUiViewModel\n\nprivate class G(\n    app: Application,\n) :\n    PrivilegeUiViewModel(\n        app,\n    ) {\n    override fun onBackClick(): Boolean = true\n}\n\nfun make(a: Application): Any = G(a)\n';
    const found = (mod.findUnusedMembers({ sources: [{ path: `${MAIN}/G.kt`, text: t }], testSourceSets: ['test/java'], deadDeclarations: [] }) as any[]).map(m => m.name);
    expect(found).not.toContain('onBackClick');
  });

  it('same verdict as the one line header', () => {
    expect(scan('class PrefsSerializer\n    @Inject\n    constructor() : Serializer<P>'))
      .toEqual(scan('class PrefsSerializer @Inject constructor() : Serializer<P>'));
  });
});
