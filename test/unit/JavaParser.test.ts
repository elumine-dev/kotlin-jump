import { describe, it, expect } from 'vitest';
import { parseJava } from '../../src/indexer/JavaParser';

function syms(code: string) {
  return parseJava('file:///Test.java', code).symbols;
}

function find(code: string, name: string) {
  return syms(code).find(s => s.name === name);
}

// ── Class declarations ────────────────────────────────────────────────────────

describe('Java class declarations', () => {
  it('parses a public class', () => {
    expect(find('public class Foo {}', 'Foo')!.kind).toBe('class');
  });

  it('parses an interface', () => {
    expect(find('public interface Repository {}', 'Repository')!.kind).toBe('interface');
  });

  it('parses an enum', () => {
    expect(find('public enum Color {}', 'Color')!.kind).toBe('enum');
  });

  it('parses an annotation type', () => {
    expect(find('public @interface MyAnnotation {}', 'MyAnnotation')!.kind).toBe('annotation');
  });

  it('parses a record', () => {
    expect(find('public record Point(int x, int y) {}', 'Point')!.kind).toBe('class');
  });

  it('parses an abstract class', () => {
    const s = find('public abstract class Base {}', 'Base');
    expect(s!.kind).toBe('class');
    expect(s!.isAbstract).toBe(true);
  });

  it('parses a private class', () => {
    const s = find('private class Helper {}', 'Helper');
    expect(s!.isPrivate).toBe(true);
  });

  it('top-level class is at depth 0', () => {
    expect(find('public class Foo {}', 'Foo')!.depth).toBe(0);
  });
});

// ── Supertypes ────────────────────────────────────────────────────────────────

describe('Java supertypes', () => {
  it('extracts extends', () => {
    expect(find('public class FooImpl extends Foo {}', 'FooImpl')!.supertypes).toEqual(['Foo']);
  });

  it('extracts implements', () => {
    expect(find('public class FooImpl implements Foo, Bar {}', 'FooImpl')!.supertypes).toEqual(['Foo', 'Bar']);
  });

  it('extracts extends + implements', () => {
    const st = find('public class FooImpl extends Base implements Foo, Bar {}', 'FooImpl')!.supertypes;
    expect(st).toContain('Base');
    expect(st).toContain('Foo');
    expect(st).toContain('Bar');
  });

  it('no supertypes for plain class', () => {
    expect(find('public class Foo {}', 'Foo')!.supertypes).toBeUndefined();
  });
});

// ── Package ───────────────────────────────────────────────────────────────────

describe('Java package', () => {
  it('extracts package name', () => {
    const result = parseJava('file:///Test.java', 'package com.example;\n\npublic class Foo {}');
    expect(result.packageName).toBe('com.example');
  });
});

// ── Methods ───────────────────────────────────────────────────────────────────

describe('Java method declarations', () => {
  it('parses a public void method', () => {
    const code = 'public class Foo {\n    public void doSomething() {}\n}';
    const s = find(code, 'doSomething');
    expect(s).toBeDefined();
    expect(s!.kind).toBe('fun');
  });

  it('parses a private method', () => {
    const code = 'public class Foo {\n    private String getName() { return ""; }\n}';
    const s = find(code, 'getName');
    expect(s).toBeDefined();
    expect(s!.isPrivate).toBe(true);
  });

  it('parses a protected method', () => {
    const code = 'public class Foo {\n    protected void process() {}\n}';
    expect(find(code, 'process')).toBeDefined();
  });

  it('parses a static method', () => {
    const code = 'public class Foo {\n    public static Foo create() { return new Foo(); }\n}';
    expect(find(code, 'create')).toBeDefined();
  });

  it('parses an abstract method', () => {
    const code = 'public abstract class Base {\n    public abstract void run();\n}';
    const s = find(code, 'run');
    expect(s).toBeDefined();
    expect(s!.isAbstract).toBe(true);
  });

  it('parses a method with List return type', () => {
    const code = 'public class Foo {\n    public List<String> getItems() { return items; }\n}';
    expect(find(code, 'getItems')).toBeDefined();
  });

  it('parses a method with Map<String, List<Integer>> return type', () => {
    const code = 'public class Foo {\n    public Map<String, List<Integer>> getMap() { return map; }\n}';
    expect(find(code, 'getMap')).toBeDefined();
  });

  it('parses a constructor', () => {
    const code = 'public class ShowcaseZoomHelper {\n    public ShowcaseZoomHelper(Context ctx) {}\n}';
    expect(find(code, 'ShowcaseZoomHelper')).toBeDefined();
  });

  it('parses a default interface method', () => {
    const code = 'public interface Zoomable {\n    default void startZoomOrUnzoom() {}\n}';
    expect(find(code, 'startZoomOrUnzoom')).toBeDefined();
  });

  it('detects @Override from annotation window', () => {
    const code = 'public class Foo {\n    @Override\n    public void onResume() {}\n}';
    const s = find(code, 'onResume');
    expect(s).toBeDefined();
    expect(s!.isOverride).toBe(true);
  });

  it('does not mark non-overridden method as override', () => {
    const code = 'public class Foo {\n    public void doSomething() {}\n}';
    expect(find(code, 'doSomething')!.isOverride).toBeUndefined();
  });

  it('indexes package-private void method (no access modifier)', () => {
    const code = 'public class Foo {\n    void helperMethod() {}\n}';
    const s = find(code, 'helperMethod');
    expect(s).toBeDefined();
    expect(s!.kind).toBe('fun');
  });

  it('indexes package-private method with class return type', () => {
    const code = 'public class Foo {\n    String getName() { return ""; }\n}';
    expect(find(code, 'getName')?.kind).toBe('fun');
  });

  it('indexes package-private method with primitive return type', () => {
    const code = 'public class Foo {\n    int getCount() { return 0; }\n}';
    expect(find(code, 'getCount')?.kind).toBe('fun');
  });

  it('does NOT index bare method call as a method declaration', () => {
    // methodCall() with no return type and no modifier → not a declaration
    const code = 'public class Foo {\n    public void run() {\n        doSomething();\n    }\n}';
    expect(find(code, 'doSomething')).toBeUndefined();
  });

  it('does NOT false-positive on field with initializer', () => {
    // `private Foo foo = new Foo()` — the `=` before `(` must block method matching
    const code = 'public class Foo {\n    private Foo foo = new Foo();\n}';
    expect(find(code, 'foo')?.kind).not.toBe('fun');
  });

  it('does NOT false-positive on if statement', () => {
    const code = 'public class Foo {\n    public void run() {\n        if (condition) {}\n    }\n}';
    expect(find(code, 'condition')).toBeUndefined();
  });

  it('does NOT false-positive on static initializer block', () => {
    const code = 'public class Foo {\n    static {\n        TAG = "Foo";\n    }\n}';
    // static initializer should not produce a method symbol
    expect(syms(code).filter(s => s.kind === 'fun')).toHaveLength(0);
  });

  it('parses the real-world startZoomOrUnzoom case', () => {
    const code = [
      'package com.example.showcase;',
      '',
      'public class ShowcaseZoomHelper {',
      '    private final Context context;',
      '',
      '    public ShowcaseZoomHelper(Context context) {',
      '        this.context = context;',
      '    }',
      '',
      '    public void startZoomOrUnzoom(boolean zoomIn) {',
      '        // implementation',
      '    }',
      '}',
    ].join('\n');
    expect(find(code, 'startZoomOrUnzoom')).toBeDefined();
    expect(find(code, 'startZoomOrUnzoom')!.kind).toBe('fun');
  });
});

// ── Method depth ──────────────────────────────────────────────────────────────

describe('Java method depth', () => {
  it('method inside top-level class is at depth 1', () => {
    const code = 'public class Foo {\n    public void run() {}\n}';
    expect(find(code, 'run')!.depth).toBe(1);
  });

  it('method inside inner class is at depth 2', () => {
    const code = [
      'public class Outer {',
      '    public class Inner {',
      '        public void run() {}',
      '    }',
      '}',
    ].join('\n');
    expect(find(code, 'run')!.depth).toBe(2);
  });

  it('two methods at the same level have the same depth', () => {
    const code = [
      'public class Foo {',
      '    public void first() {}',
      '    public void second() {}',
      '}',
    ].join('\n');
    expect(find(code, 'first')!.depth).toBe(find(code, 'second')!.depth);
  });

  it('depth resets correctly after method body closes', () => {
    const code = [
      'public class Foo {',
      '    public void alpha() {',
      '        int x = 1;',
      '    }',
      '    public void beta() {}',
      '}',
    ].join('\n');
    expect(find(code, 'alpha')!.depth).toBe(1);
    expect(find(code, 'beta')!.depth).toBe(1);
  });
});

// ── Fields ────────────────────────────────────────────────────────────────────

describe('Java field declarations', () => {
  it('parses a private mutable field as var', () => {
    const code = 'public class Foo {\n    private int count;\n}';
    const s = find(code, 'count');
    expect(s).toBeDefined();
    expect(s!.kind).toBe('var');
  });

  it('parses a private final field as val', () => {
    const code = 'public class Foo {\n    private final String name;\n}';
    const s = find(code, 'name');
    expect(s).toBeDefined();
    expect(s!.kind).toBe('val');
  });

  it('marks static final field as const', () => {
    const code = 'public class Foo {\n    public static final String TAG = "Foo";\n}';
    const s = find(code, 'TAG');
    expect(s).toBeDefined();
    expect(s!.isConst).toBe(true);
  });

  it('parses a field with an initializer', () => {
    const code = 'public class Foo {\n    private int count = 0;\n}';
    expect(find(code, 'count')).toBeDefined();
  });

  it('parses a field with a generic type', () => {
    const code = 'public class Foo {\n    private List<String> items;\n}';
    expect(find(code, 'items')).toBeDefined();
  });

  it('marks a private field as private', () => {
    const code = 'public class Foo {\n    private boolean isActive;\n}';
    expect(find(code, 'isActive')!.isPrivate).toBe(true);
  });

  it('does NOT parse a method as a field', () => {
    const code = 'public class Foo {\n    public void doSomething() {}\n}';
    expect(find(code, 'doSomething')!.kind).toBe('fun');
  });

  it('field is at depth 1 inside a class', () => {
    const code = 'public class Foo {\n    private int count;\n}';
    expect(find(code, 'count')!.depth).toBe(1);
  });
});

// ── Enum entries ──────────────────────────────────────────────────────────────

describe('Java enum entries', () => {
  it('parses simple enum entries', () => {
    const code = 'public enum Color { RED, GREEN, BLUE }';
    const names = syms(code).filter(s => s.kind === 'enum').map(s => s.name);
    expect(names).toContain('RED');
    expect(names).toContain('GREEN');
    expect(names).toContain('BLUE');
  });

  it('parses enum entries with constructor arguments', () => {
    const code = 'public enum Status { ACTIVE(1), INACTIVE(0); }';
    const names = syms(code).filter(s => s.kind === 'enum').map(s => s.name);
    expect(names).toContain('ACTIVE');
    expect(names).toContain('INACTIVE');
  });

  it('parses a single-entry enum', () => {
    const code = 'public enum Singleton { INSTANCE }';
    expect(find(code, 'INSTANCE')).toBeDefined();
  });

  it('parses enum methods declared after the ; terminator', () => {
    const code = [
      'public enum Status {',
      '    ACTIVE, INACTIVE;',
      '',
      '    public String display() {',
      '        return name().toLowerCase();',
      '    }',
      '}',
    ].join('\n');
    expect(find(code, 'display')).toBeDefined();
    expect(find(code, 'display')!.kind).toBe('fun');
  });

  it('does not index enum methods as enum entries', () => {
    const code = [
      'public enum Status {',
      '    ACTIVE;',
      '    public String display() { return ""; }',
      '}',
    ].join('\n');
    const entries = syms(code).filter(s => s.kind === 'enum').map(s => s.name);
    expect(entries).not.toContain('display');
  });
});

// ── Inner classes ─────────────────────────────────────────────────────────────

describe('Java inner class depth', () => {
  it('inner class is at depth 1', () => {
    const code = 'public class Outer {\n    public class Inner {}\n}';
    expect(find(code, 'Inner')!.depth).toBe(1);
  });

  it('outer class is at depth 0', () => {
    const code = 'public class Outer {\n    public class Inner {}\n}';
    expect(find(code, 'Outer')!.depth).toBe(0);
  });

  it('static nested class is at depth 1', () => {
    const code = 'public class Outer {\n    public static class Builder {}\n}';
    expect(find(code, 'Builder')!.depth).toBe(1);
  });

  it('method inside inner class has depth > outer method', () => {
    const code = [
      'public class Outer {',
      '    public void outerMethod() {}',
      '    public class Inner {',
      '        public void innerMethod() {}',
      '    }',
      '}',
    ].join('\n');
    const outer = find(code, 'outerMethod')!.depth;
    const inner = find(code, 'innerMethod')!.depth;
    expect(inner).toBeGreaterThan(outer);
  });
});

// ── Edge cases and adversarial ────────────────────────────────────────────────

describe('Java parser edge cases', () => {
  it('ignores content inside block comments', () => {
    const code = [
      '/**',
      ' * public void notAMethod() {}',
      ' * private int notAField;',
      ' */',
      'public class Foo {}',
    ].join('\n');
    expect(find(code, 'notAMethod')).toBeUndefined();
    expect(find(code, 'notAField')).toBeUndefined();
    expect(find(code, 'Foo')).toBeDefined();
  });

  it('ignores content after line comments', () => {
    const code = 'public class Foo {\n    // public void ghost() {}\n}';
    expect(find(code, 'ghost')).toBeUndefined();
  });

  it('constructor has the same name as the class', () => {
    const code = 'public class Zoom {\n    public Zoom() {}\n}';
    const all = syms(code).map(s => s.name);
    // Both the class and the constructor named "Zoom" should be indexed
    expect(all.filter(n => n === 'Zoom').length).toBeGreaterThanOrEqual(1);
  });

  it('lambda field does not produce a method symbol', () => {
    // = before ( → must not match as a method
    const code = 'public class Foo {\n    private Runnable r = () -> {};\n}';
    expect(syms(code).filter(s => s.kind === 'fun')).toHaveLength(0);
  });

  it('@Override on previous line is detected', () => {
    const code = [
      'public class Foo extends Base {',
      '    @Override',
      '    public void onStart() {}',
      '}',
    ].join('\n');
    expect(find(code, 'onStart')!.isOverride).toBe(true);
  });

  it('@Override annotation does not bleed onto subsequent non-overridden method', () => {
    const code = [
      'public class Foo extends Base {',
      '    @Override',
      '    public void onStart() {}',
      '    public void helper() {}',
      '}',
    ].join('\n');
    expect(find(code, 'onStart')!.isOverride).toBe(true);
    expect(find(code, 'helper')!.isOverride).toBeUndefined();
  });

  it('handles generics with nested angle brackets in return type', () => {
    const code = 'public class Foo {\n    public Map<String, List<Integer>> transform() { return null; }\n}';
    expect(find(code, 'transform')).toBeDefined();
  });

  it('handles generic method type parameter', () => {
    const code = 'public class Foo {\n    public <T> List<T> wrap(T item) { return null; }\n}';
    expect(find(code, 'wrap')).toBeDefined();
  });

  it('parses methods across multiple methods in the same class', () => {
    const code = [
      'public class ShowcaseControllerImpl {',
      '    private final ZoomHelper zoomHelper;',
      '',
      '    public ShowcaseControllerImpl(ZoomHelper h) { this.zoomHelper = h; }',
      '',
      '    public void zoomOutAfterWidgetIsShownZoomedIn() {',
      '        zoomHelper.startZoomOrUnzoom(false);',
      '    }',
      '}',
    ].join('\n');
    expect(find(code, 'zoomOutAfterWidgetIsShownZoomedIn')).toBeDefined();
    // Both a class symbol and a constructor (fun) named ShowcaseControllerImpl should be indexed
    const all = syms(code).filter(s => s.name === 'ShowcaseControllerImpl');
    expect(all.some(s => s.kind === 'fun')).toBe(true); // constructor
  });

  it('does not produce symbols from inside method bodies', () => {
    const code = [
      'public class Foo {',
      '    public void outer() {',
      '        int localVar = 42;',
      '        doSomething();',
      '    }',
      '}',
    ].join('\n');
    expect(find(code, 'localVar')).toBeUndefined();
    // doSomething() is a bare call with no modifier — should not be indexed
    const symsInCode = syms(code);
    expect(symsInCode.find(s => s.name === 'doSomething')).toBeUndefined();
  });

  it('handles method with throws clause', () => {
    const code = 'public class Foo {\n    public void load() throws IOException {}\n}';
    expect(find(code, 'load')).toBeDefined();
  });

  it('handles synchronized method', () => {
    const code = 'public class Foo {\n    public synchronized void acquire() {}\n}';
    expect(find(code, 'acquire')).toBeDefined();
  });

  it('handles native method', () => {
    const code = 'public class Foo {\n    public native void render();\n}';
    expect(find(code, 'render')).toBeDefined();
  });
});
