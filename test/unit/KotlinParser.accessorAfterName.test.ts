import { describe, it, expect } from 'vitest';
import { parse } from '../../src/indexer/KotlinParser';

/**
 * A property with no written type may put its accessor right after its name:
 *
 *   private val BillingCycle.labelRes get() = when (this) { ... }
 *   val binding get() = _binding!!
 *   private val credentials
 *       get() = ...
 *
 * The property pattern wanted `=`, `:`, `(`, `<` or `by` after the name, so
 * none of these was indexed: about a thousand properties over six projects,
 * absent from Outline and Go to Definition, and one left for detekt to report
 * once a cut removed its last reader.
 */
const props = (src: string): string[] =>
  (parse('file:///w/a/F.kt', `package a\n\n${src}\n`).symbols as any[])
    .filter(s => s.kind === 'val' || s.kind === 'var').map(s => s.name);

describe('a property whose accessor follows its name', () => {
  it('extension receiver, getter on the same line', () => {
    expect(props('private val BillingCycle.labelRes get() = when (this) {\n    else -> 1\n}')).toEqual(['labelRes']);
  });

  it('no receiver, getter on the same line', () => {
    expect(props('class F {\n    private val binding get() = _binding!!\n}')).toEqual(['binding']);
  });

  it('getter on the next line', () => {
    expect(props('private val credentials\n    get() = load()')).toEqual(['credentials']);
  });

  it('a var with a setter on the same line', () => {
    expect(props('var level set(value) { field = value }')).toEqual(['level']);
  });

  it('control: a name that merely starts with get is not an accessor', () => {
    expect(props('val x = getter()')).toEqual(['x']);
    expect(props('fun f() {\n    val getLabel = 1\n}')).toEqual(['getLabel']);
  });
});
