import { describe, it, expect } from 'vitest';
import { parseJava } from '../../src/indexer/JavaParser';

function symbols(code: string) {
  return parseJava('file:///Test.java', code).symbols;
}

function findSymbol(code: string, name: string) {
  return symbols(code).find(s => s.name === name);
}

describe('Java class declarations', () => {
  it('parses a class', () => {
    const s = findSymbol('public class Foo {}', 'Foo');
    expect(s!.kind).toBe('class');
  });

  it('parses an interface', () => {
    const s = findSymbol('public interface Repository {}', 'Repository');
    expect(s!.kind).toBe('interface');
  });

  it('parses an enum', () => {
    const s = findSymbol('public enum Color {}', 'Color');
    expect(s!.kind).toBe('enum');
  });

  it('parses an annotation type', () => {
    const s = findSymbol('public @interface MyAnnotation {}', 'MyAnnotation');
    expect(s!.kind).toBe('annotation');
  });
});

describe('Java supertypes', () => {
  it('extracts extends', () => {
    const s = findSymbol('public class FooImpl extends Foo {}', 'FooImpl');
    expect(s!.supertypes).toEqual(['Foo']);
  });

  it('extracts implements', () => {
    const s = findSymbol('public class FooImpl implements Foo, Bar {}', 'FooImpl');
    expect(s!.supertypes).toEqual(['Foo', 'Bar']);
  });

  it('extracts extends + implements', () => {
    const s = findSymbol('public class FooImpl extends Base implements Foo, Bar {}', 'FooImpl');
    expect(s!.supertypes).toContain('Base');
    expect(s!.supertypes).toContain('Foo');
    expect(s!.supertypes).toContain('Bar');
  });

  it('no supertypes for plain class', () => {
    const s = findSymbol('public class Foo {}', 'Foo');
    expect(s!.supertypes).toBeUndefined();
  });
});

describe('Java package', () => {
  it('extracts package name', () => {
    const result = parseJava('file:///Test.java', 'package com.example;\n\npublic class Foo {}');
    expect(result.packageName).toBe('com.example');
  });
});
