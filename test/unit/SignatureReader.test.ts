import { describe, it, expect } from 'vitest';
import { parseParams } from '../../src/util/SignatureReader';

function params(sig: string) {
  return parseParams(sig);
}

describe('parseParams — simple cases', () => {
  it('parses a single param', () => {
    expect(params('fun foo(x: Int)')).toEqual([{ name: 'x', type: 'Int' }]);
  });

  it('parses two params', () => {
    expect(params('fun foo(x: Int, y: String)')).toEqual([
      { name: 'x', type: 'Int' },
      { name: 'y', type: 'String' },
    ]);
  });

  it('returns empty for no params', () => {
    expect(params('fun foo()')).toEqual([]);
  });

  it('handles whitespace around colon', () => {
    expect(params('fun foo( x : Int )')).toEqual([{ name: 'x', type: 'Int' }]);
  });
});

describe('parseParams — generic types', () => {
  it('handles List<T>', () => {
    expect(params('fun foo(items: List<T>)')).toEqual([{ name: 'items', type: 'List<T>' }]);
  });

  it('handles Map<String, List<Int>> without splitting on inner commas', () => {
    expect(params('fun foo(m: Map<String, List<Int>>)')).toEqual([
      { name: 'm', type: 'Map<String, List<Int>>' },
    ]);
  });

  it('handles two params with generic types', () => {
    expect(params('fun foo(keys: List<String>, values: Map<String, Int>)')).toEqual([
      { name: 'keys', type: 'List<String>' },
      { name: 'values', type: 'Map<String, Int>' },
    ]);
  });
});

describe('parseParams — lambda types', () => {
  it('handles () -> Unit', () => {
    expect(params('fun foo(content: () -> Unit)')).toEqual([
      { name: 'content', type: '() -> Unit' },
    ]);
  });

  it('handles @Composable () -> Unit', () => {
    expect(params('fun foo(content: @Composable () -> Unit)')).toEqual([
      { name: 'content', type: '@Composable () -> Unit' },
    ]);
  });

  it('handles (Int, Int) -> Boolean', () => {
    expect(params('fun foo(predicate: (Int, Int) -> Boolean)')).toEqual([
      { name: 'predicate', type: '(Int, Int) -> Boolean' },
    ]);
  });
});

describe('parseParams — modifiers', () => {
  it('strips vararg', () => {
    expect(params('fun foo(vararg items: Item)')).toEqual([{ name: 'items', type: 'Item' }]);
  });

  it('strips crossinline', () => {
    expect(params('fun foo(crossinline block: () -> Unit)')).toEqual([
      { name: 'block', type: '() -> Unit' },
    ]);
  });

  it('strips noinline', () => {
    expect(params('fun foo(noinline action: () -> Unit)')).toEqual([
      { name: 'action', type: '() -> Unit' },
    ]);
  });
});

describe('parseParams — default values', () => {
  it('strips simple default value', () => {
    expect(params('fun foo(x: Int = 0)')).toEqual([{ name: 'x', type: 'Int' }]);
  });

  it('strips complex default value', () => {
    expect(params('fun foo(modifier: Modifier = Modifier.padding(8.dp))')).toEqual([
      { name: 'modifier', type: 'Modifier' },
    ]);
  });

  it('does not strip == (comparison in default)', () => {
    // `= (x == y)` — the `=` at depth 0 is the default assignment, but `==` should not confuse
    expect(params('fun foo(flag: Boolean = true)')).toEqual([{ name: 'flag', type: 'Boolean' }]);
  });
});

describe('parseParams — extension functions', () => {
  it('ignores receiver type and parses params', () => {
    // Extension receiver is before the `(`, not inside it
    expect(params('fun String.foo(other: String)')).toEqual([{ name: 'other', type: 'String' }]);
  });
});

describe('parseParams — generic function', () => {
  it('ignores type params before name', () => {
    expect(params('fun <T> foo(items: List<T>)')).toEqual([{ name: 'items', type: 'List<T>' }]);
  });

  it('handles multiple type params', () => {
    expect(params('fun <K, V> foo(map: Map<K, V>)')).toEqual([
      { name: 'map', type: 'Map<K, V>' },
    ]);
  });
});

describe('parseParams — constructor signatures', () => {
  it('parses class primary constructor', () => {
    expect(params('class Foo(val name: String, val age: Int)')).toEqual([
      { name: 'name', type: 'String' },
      { name: 'age', type: 'Int' },
    ]);
  });

  it('parses data class', () => {
    expect(params('data class Point(val x: Float, val y: Float)')).toEqual([
      { name: 'x', type: 'Float' },
      { name: 'y', type: 'Float' },
    ]);
  });
});

describe('parseParams — multi-line signature', () => {
  it('handles newline-separated params', () => {
    const sig = 'fun foo(\n    modifier: Modifier,\n    content: @Composable () -> Unit\n)';
    expect(params(sig)).toEqual([
      { name: 'modifier', type: 'Modifier' },
      { name: 'content', type: '@Composable () -> Unit' },
    ]);
  });
});

describe('parseParams — edge cases', () => {
  it('returns empty for malformed signature', () => {
    expect(params('not a function at all')).toEqual([]);
  });

  it('handles Kotlin Unit return type annotation', () => {
    expect(params('fun foo(x: Int): Unit')).toEqual([{ name: 'x', type: 'Int' }]);
  });

  it('skips annotation params on the param itself', () => {
    expect(params('fun foo(@Assisted id: String)')).toEqual([{ name: 'id', type: 'String' }]);
  });
});
