import { describe, it, expect, beforeEach } from 'vitest';
import { SymbolIndex } from '../../src/indexer/SymbolIndex';
import { parse } from '../../src/indexer/KotlinParser';
import { parseJava } from '../../src/indexer/JavaParser';

const JAR1  = 'kotlin-jar:///cache/lib-sources.jar!com/lib/Foo.kt';
const JAR2  = 'kotlin-jar:///cache/other-sources.jar!pkg/Bar.kt';
const FILE1 = 'file:///src/main/kotlin/com/app/Screen.kt';
const FILE2 = 'file:///src/main/kotlin/com/app/Widget.kt';

function addKt(index: SymbolIndex, uri: string, code: string, mod?: string) {
  index.add(parse(uri, code), mod);
}

describe('SymbolIndex.removeExternal()', () => {
  let index: SymbolIndex;
  beforeEach(() => { index = new SymbolIndex(); });

  // ── Safety ────────────────────────────────────────────────────────────────

  it('no crash on empty index', () => {
    expect(() => index.removeExternal()).not.toThrow();
  });

  it('double call is idempotent — no crash, no phantom removal', () => {
    addKt(index, JAR1, 'package com.lib\nclass Foo');
    index.removeExternal();
    expect(() => index.removeExternal()).not.toThrow();
    expect(index.lookup('Foo')).toHaveLength(0);
  });

  // ── Isolation — kotlin-jar: only ─────────────────────────────────────────

  it('removes kotlin-jar: symbols, leaves file:// untouched', () => {
    addKt(index, JAR1,  'package com.lib\nclass JarClass');
    addKt(index, FILE1, 'package com.app\nclass AppClass');
    index.removeExternal();
    expect(index.lookup('JarClass')).toHaveLength(0);
    expect(index.lookup('AppClass')).toHaveLength(1);
  });

  it('stats reflect only workspace symbols after removal', () => {
    addKt(index, JAR1,  'package lib\nclass A\nclass B\nclass C');
    addKt(index, FILE1, 'package app\nclass X');
    index.finalize();
    index.removeExternal();
    const { files, symbols } = index.stats();
    expect(files).toBe(1);
    expect(symbols).toBe(1);
  });

  it('multiple JAR files all removed, all workspace files preserved', () => {
    addKt(index, JAR1,  'package lib\nclass FromJar1');
    addKt(index, JAR2,  'package pkg\nclass FromJar2');
    addKt(index, FILE1, 'package app\nclass FromFile1');
    addKt(index, FILE2, 'package app\nclass FromFile2');
    index.removeExternal();
    expect(index.lookup('FromJar1')).toHaveLength(0);
    expect(index.lookup('FromJar2')).toHaveLength(0);
    expect(index.lookup('FromFile1')).toHaveLength(1);
    expect(index.lookup('FromFile2')).toHaveLength(1);
  });

  // ── byName correctness ────────────────────────────────────────────────────

  it('byName entry removed entirely when symbol ONLY exists in JAR', () => {
    addKt(index, JAR1, 'package lib\nclass OnlyInJar');
    index.removeExternal();
    expect(index.lookup('OnlyInJar')).toHaveLength(0);
  });

  it('byName entry survives when same name is in both JAR and workspace', () => {
    addKt(index, FILE1, 'package com.example\nclass Shared');
    addKt(index, JAR1,  'package com.example\nclass Shared'); // JAR added after workspace
    index.removeExternal();
    const hits = index.lookup('Shared');
    expect(hits).toHaveLength(1);
    expect(hits[0].uri.toString()).toBe(FILE1);
  });

  // ── byFqn correctness — this is the critical FQN orphan bug ──────────────

  it('lookupFqn returns workspace entry after removing JAR entry with same FQN', () => {
    // Workspace added first → byFqn points to workspace entry
    // JAR added second → byFqn overwritten with JAR entry
    // removeExternal() must NOT leave byFqn empty — workspace entry must survive
    addKt(index, FILE1, 'package com.example\nclass Shared');
    addKt(index, JAR1,  'package com.example\nclass Shared');
    index.removeExternal();
    const entry = index.lookupFqn('com.example.Shared');
    expect(entry).toBeDefined();
    expect(entry!.uri.toString()).toBe(FILE1);
  });

  it('lookupFqn works correctly when JAR-only FQN is removed', () => {
    addKt(index, JAR1, 'package lib\nclass JarOnly');
    index.removeExternal();
    expect(index.lookupFqn('lib.JarOnly')).toBeUndefined();
  });

  it('lookupFqn correct when workspace FQN has no JAR counterpart', () => {
    addKt(index, FILE1, 'package com.app\nclass UniqueInWorkspace');
    addKt(index, JAR1,  'package lib\nclass DifferentClass');
    index.removeExternal();
    expect(index.lookupFqn('com.app.UniqueInWorkspace')).toBeDefined();
    expect(index.lookupFqn('lib.DifferentClass')).toBeUndefined();
  });

  // ── bySuper correctness ───────────────────────────────────────────────────

  it('JAR implementor removed from lookupImplementations after removeExternal', () => {
    addKt(index, JAR1, 'package lib\nclass JarImpl : BaseWidget()');
    expect(index.lookupImplementations('BaseWidget').some(e => e.name === 'JarImpl')).toBe(true);
    index.removeExternal();
    expect(index.lookupImplementations('BaseWidget').some(e => e.name === 'JarImpl')).toBe(false);
  });

  it('workspace implementor survives removeExternal when JAR shares same supertype', () => {
    addKt(index, FILE1, 'package app\nclass AppImpl : BaseWidget()');
    addKt(index, JAR1,  'package lib\nclass JarImpl : BaseWidget()');
    index.removeExternal();
    const impls = index.lookupImplementations('BaseWidget');
    expect(impls.some(e => e.name === 'AppImpl')).toBe(true);
    expect(impls.some(e => e.name === 'JarImpl')).toBe(false);
  });

  // ── Re-index stability ────────────────────────────────────────────────────

  it('re-adding same JAR after removeExternal gives exact same symbol count — no ghost entries', () => {
    const code = 'package lib\nclass Foo\nclass Bar\nclass Baz';
    addKt(index, JAR1, code);
    index.finalize();
    const { symbols: before } = index.stats();

    index.removeExternal();
    addKt(index, JAR1, code);
    index.finalize();
    const { symbols: after } = index.stats();

    expect(after).toBe(before);
  });

  it('lookup count stable after removeExternal + re-add — byName Set has no duplicates', () => {
    addKt(index, JAR1, 'package lib\nclass Reindexed');
    expect(index.lookup('Reindexed')).toHaveLength(1);
    index.removeExternal();
    addKt(index, JAR1, 'package lib\nclass Reindexed');
    expect(index.lookup('Reindexed')).toHaveLength(1); // not 2
  });
});
