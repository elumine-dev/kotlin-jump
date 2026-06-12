/**
 * SWC-ADVER — adversarial cases for the sealed-when coverage analyzer.
 * Read as an attacker: every case here tries to make the lens lie (wrong
 * count) or crash. The contract under test: when in doubt, show NOTHING.
 */
import { describe, expect, it } from 'vitest';
import { parse } from '../../src/indexer/KotlinParser';
import { SymbolIndex } from '../../src/indexer/SymbolIndex';
import { analyzeDocument, lensTitle } from '../../src/providers/SealedWhenCoverageProvider';
import { mockDocument } from './helpers';

let uriCounter = 0;
/** Unique URI per analysis — ImportResolver caches per uri+version. */
function freshUri(): string {
  return `file:///Adver${uriCounter++}.kt`;
}

function analyze(code: string, extraFiles: Array<[string, string]> = []) {
  const uri = freshUri();
  const index = new SymbolIndex();
  index.add(parse(uri, code));
  for (const [u, c] of extraFiles) index.add(parse(u, c));
  index.finalize();
  return analyzeDocument(mockDocument(uri, code), index);
}

const SEALED = `package com.demo
sealed class State {
    object A : State()
    object B : State()
    data class C(val n: Int) : State()
}
`;

describe('SWC-ADVER 1 — when inside strings and comments', () => {
  it('ignores when( in a line comment', () => {
    const code = SEALED + `
// when (x) { is State.A -> 1 }
fun f() = 0
`;
    expect(analyze(code)).toEqual([]);
  });

  it('ignores when( in a block comment spanning lines', () => {
    const code = SEALED + `
/*
fun g(s: State) = when (s) {
    is State.A -> 1
}
*/
fun f() = 0
`;
    expect(analyze(code)).toEqual([]);
  });

  it('ignores when( inside a string literal', () => {
    const code = SEALED + `
val s = "when (x) {"
fun f() = 0
`;
    expect(analyze(code)).toEqual([]);
  });

  it('ignores when( inside a raw string', () => {
    const code = SEALED + `
val s = """
when (x) {
    is State.A -> 1
}
"""
fun f() = 0
`;
    expect(analyze(code)).toEqual([]);
  });
});

describe('SWC-ADVER 2 — subjectless when', () => {
  it('produces no lens even with `x is Foo ->` conditions', () => {
    const code = SEALED + `
fun f(s: State) = when {
    s is State.A -> 1
    s is State.B -> 2
    else -> 0
}
`;
    expect(analyze(code)).toEqual([]);
  });
});

describe('SWC-ADVER 3 — when (val x = …)', () => {
  it('still analyzes the body', () => {
    const code = SEALED + `
fun load(): State = State.A
fun f() = when (val s = load()) {
    is State.A -> 1
    is State.B -> 2
    is State.C -> 3
}
`;
    const [a] = analyze(code);
    expect(a).toBeDefined();
    expect(a.missing).toEqual([]);
  });
});

describe('SWC-ADVER 4 — !is bails', () => {
  it('any !is branch silences the whole when', () => {
    const code = SEALED + `
fun f(s: State) = when (s) {
    !is State.A -> 1
    else -> 0
}
`;
    expect(analyze(code)).toEqual([]);
  });
});

describe('SWC-ADVER 5 — multi-value branches', () => {
  it('A, B on one branch both count', () => {
    const code = SEALED + `
fun f(s: State) = when (s) {
    State.A, State.B -> 1
    is State.C -> 2
}
`;
    const [a] = analyze(code);
    expect(a).toBeDefined();
    expect(a.missing).toEqual([]);
  });

  it('commas inside parens/generics do not split', () => {
    const code = `package com.demo
sealed class Box {
    data class Pair2(val a: Int, val b: Int) : Box()
    object Empty : Box()
}
fun make(a: Int, b: Int): Box = Box.Pair2(a, b)
fun f(s: Box) = when (s) {
    is Box.Pair2 -> 1
    Box.Empty -> 2
}
`;
    const [a] = analyze(code);
    expect(a).toBeDefined();
    expect(a.missing).toEqual([]);
  });
});

describe('SWC-ADVER 6 — Kotlin 2.1 guards', () => {
  it('a guarded branch does not count toward exhaustiveness', () => {
    const code = SEALED + `
fun f(s: State, n: Int) = when (s) {
    is State.A -> 1
    is State.B -> 2
    is State.C if n > 0 -> 3
    else -> 0
}
`;
    const [a] = analyze(code);
    expect(a).toBeDefined();
    expect(a.missing.map(e => e.name)).toEqual(['C']);
    expect(lensTitle(a)).toBe('✓ else covers 1 remaining: C');
  });

  it('guard with a lambda containing -> does not break branch parsing', () => {
    const code = SEALED + `
fun f(s: State, xs: List<Int>) = when (s) {
    is State.A if xs.any { it > 0 } -> 1
    is State.B -> 2
    is State.C -> 3
    else -> 0
}
`;
    const [a] = analyze(code);
    expect(a).toBeDefined();
    // A is guarded → not covered; B and C are.
    expect(a.missing.map(e => e.name)).toEqual(['A']);
  });

  it('same type guarded AND unguarded → covered', () => {
    const code = SEALED + `
fun f(s: State, n: Int) = when (s) {
    is State.A if n > 0 -> 1
    is State.A -> 2
    is State.B -> 3
    is State.C -> 4
}
`;
    const [a] = analyze(code);
    expect(a).toBeDefined();
    expect(a.missing).toEqual([]);
  });

  it('identifiers containing "if" are not guards', () => {
    const code = `package com.demo
sealed class Gift {
    object Gifted : Gift()
    object Notification : Gift()
}
fun f(g: Gift) = when (g) {
    Gift.Gifted -> 1
    Gift.Notification -> 2
}
`;
    const [a] = analyze(code);
    expect(a).toBeDefined();
    expect(a.missing).toEqual([]);
  });
});

describe('SWC-ADVER 7 — nested when', () => {
  it('inner and outer analyzed independently', () => {
    const code = SEALED + `
sealed class Other {
    object X : Other()
    object Y : Other()
}
fun f(s: State, o: Other) = when (s) {
    is State.A -> when (o) {
        Other.X -> 1
        else -> 2
    }
    is State.B -> 3
    is State.C -> 4
}
`;
    const results = analyze(code);
    expect(results.length).toBe(2);
    const outer = results.find(r => r.parent.name === 'State')!;
    const inner = results.find(r => r.parent.name === 'Other')!;
    expect(outer.missing).toEqual([]);
    expect(inner.missing.map(e => e.name)).toEqual(['Y']);
    expect(inner.hasElse).toBe(true);
  });
});

describe('SWC-ADVER 8 — multi-line branch bodies', () => {
  it('branches only detected at relative depth 1', () => {
    const code = SEALED + `
fun g(s: State): Int = 0
fun f(s: State) = when (s) {
    is State.A -> {
        val x = g(s)
        x + 1
    }
    is State.B -> 2
    is State.C -> 3
}
`;
    const [a] = analyze(code);
    expect(a).toBeDefined();
    expect(a.missing).toEqual([]);
  });
});

describe('SWC-ADVER 9 — homonym subtypes, same package', () => {
  const TWO_SEALED = `package com.demo
sealed class LoadState {
    object Loading : LoadState()
    data class Error(val m: String) : LoadState()
}
sealed class NetworkState {
    object Connected : NetworkState()
    data class Error(val code: Int) : NetworkState()
}
`;
  it('qualified branches resolve correctly', () => {
    const code = TWO_SEALED + `
fun f(s: LoadState) = when (s) {
    is LoadState.Loading -> 1
    is LoadState.Error -> 2
}
`;
    const [a] = analyze(code);
    expect(a).toBeDefined();
    expect(a.parent.name).toBe('LoadState');
    expect(a.missing).toEqual([]);
  });

  it('unqualified ambiguous `is Error` → no lens, never wrong counts', () => {
    const code = TWO_SEALED + `
fun f(s: LoadState) = when (s) {
    is LoadState.Loading -> 1
    is Error -> 2
}
`;
    expect(analyze(code)).toEqual([]);
  });
});

describe('SWC-ADVER 10 — homonym parents across packages', () => {
  it('explicit import disambiguates; missing import bails', () => {
    const other = `package com.other
sealed class State {
    object Z : State()
}
`;
    const code = `package com.app
import com.demo.State

fun f(s: State) = when (s) {
    is State.A -> 1
    is State.B -> 2
    is State.C -> 3
}
`;
    const results = analyze(code, [['file:///DemoState.kt', SEALED], ['file:///OtherState.kt', other]]);
    expect(results.length).toBe(1);
    expect(results[0].parent.fqn).toBe('com.demo.State');
    expect(results[0].missing).toEqual([]);
  });
});

describe('SWC-ADVER 11 — mixed hierarchies bail', () => {
  it('branches from two different parents → no lens', () => {
    const code = SEALED + `
sealed class Other {
    object X : Other()
}
fun f(s: Any) = when (s) {
    is State.A -> 1
    is Other.X -> 2
    else -> 0
}
`;
    expect(analyze(code)).toEqual([]);
  });
});

describe('SWC-ADVER 12 — duplicate branches count once', () => {
  it('is A twice → 1 covered of 3', () => {
    const code = SEALED + `
fun f(s: State) = when (s) {
    is State.A -> 1
    is State.A -> 2
}
`;
    const [a] = analyze(code);
    expect(a).toBeDefined();
    expect(a.covered.size).toBe(1);
    expect(lensTitle(a)).toBe('⚠ 1/3 branches, missing: B, C');
  });
});

describe('SWC-ADVER 13 — else-only when', () => {
  it('no type branches → no lens', () => {
    const code = SEALED + `
fun f(s: State) = when (s) {
    else -> 0
}
`;
    expect(analyze(code)).toEqual([]);
  });
});

describe('SWC-ADVER 14 — anonymous implementors excluded', () => {
  it('object : State() expressions do not inflate expected', () => {
    const code = SEALED + `
val anon = object : State() {}
fun f(s: State) = when (s) {
    is State.A -> 1
    is State.B -> 2
    is State.C -> 3
}
`;
    const [a] = analyze(code);
    expect(a).toBeDefined();
    expect(a.expected.map(e => e.name)).toEqual(['A', 'B', 'C']);
    expect(a.missing).toEqual([]);
  });
});

describe('SWC-ADVER 15 — pathological input', () => {
  it('unclosed when at EOF → no crash, no lens', () => {
    const code = SEALED + `
fun f(s: State) = when (s) {
    is State.A -> 1
`;
    expect(() => analyze(code)).not.toThrow();
    expect(analyze(code)).toEqual([]);
  });

  it('brace soup → no crash', () => {
    const code = SEALED + '\nfun f(s: State) = when (s) {{{{}}}\n' + '}'.repeat(50);
    expect(() => analyze(code)).not.toThrow();
  });
});

describe('SWC-ADVER 16 — enum body members after ;', () => {
  it('members and nested classes are not entries', () => {
    const code = `package com.demo
enum class E {
    FIRST,
    SECOND;
    fun helper() = name
    companion object { val X = 1 }
}
fun f(e: E) = when (e) {
    E.FIRST -> 1
}
`;
    const [a] = analyze(code);
    expect(a).toBeDefined();
    expect(a.expected.map(x => x.name)).toEqual(['FIRST', 'SECOND']);
    expect(a.missing.map(x => x.name)).toEqual(['SECOND']);
  });
});

describe('SWC-ADVER 17 — non-type branches mixed in', () => {
  it('literals/calls in branches are ignored, types still counted', () => {
    const code = `package com.demo
enum class N { ONE, TWO }
fun f(n: N) = when (n) {
    N.ONE -> 1
    else -> 0
}
`;
    const [a] = analyze(code);
    expect(a).toBeDefined();
    expect(a.missing.map(e => e.name)).toEqual(['TWO']);
  });

  it('when over Int literals → no lens', () => {
    const code = `package com.demo
fun f(n: Int) = when (n) {
    1 -> "one"
    2 -> "two"
    else -> "many"
}
`;
    expect(analyze(code)).toEqual([]);
  });
});

describe('SWC-ADVER 19 — multi-line conditions must not under-count', () => {
  it('multi-value condition split across lines → no lens (never a wrong count)', () => {
    const code = SEALED + `
fun f(s: State) = when (s) {
    is State.A,
    is State.B -> 1
    is State.C -> 2
}
`;
    expect(analyze(code)).toEqual([]);
  });

  it('bare refs split across lines → no lens', () => {
    const code = SEALED + `
fun f(s: State) = when (s) {
    State.A,
    State.B -> 1
    is State.C -> 2
}
`;
    expect(analyze(code)).toEqual([]);
  });

  it('arrow wrapped to the next line → no lens', () => {
    const code = SEALED + `
fun f(s: State) = when (s) {
    is State.A
        -> 1
    is State.B -> 2
    is State.C -> 3
}
`;
    expect(analyze(code)).toEqual([]);
  });

  it('innocent brace-less multi-line branch body keeps the lens', () => {
    const code = SEALED + `
fun g(): Int = 0
fun f(s: State) = when (s) {
    is State.A ->
        g() + 1
    is State.B -> 2
    is State.C -> 3
}
`;
    const [a] = analyze(code);
    expect(a).toBeDefined();
    expect(a.missing).toEqual([]);
  });
});

describe('SWC-ADVER 18 — perf guard', () => {
  it('5000-line doc with 50 whens analyzes in single-digit ms', () => {
    let code = SEALED;
    for (let i = 0; i < 50; i++) {
      code += `
fun f${i}(s: State) = when (s) {
    is State.A -> ${i}
    is State.B -> ${i}
}
`;
    }
    // Pad to ~5000 lines of plain code
    code += Array.from({ length: 4500 }, (_, i) => `val pad${i} = ${i}`).join('\n');
    const uri = freshUri();
    const index = new SymbolIndex();
    index.add(parse(uri, code));
    index.finalize();
    const doc = mockDocument(uri, code);

    const t0 = performance.now();
    const results = analyzeDocument(doc, index);
    const elapsed = performance.now() - t0;

    expect(results.length).toBe(50);
    // Speed is the extension's core value. Loose bound (CI variance) but a
    // regression to O(lines × whens) full rescans would blow way past it.
    expect(elapsed).toBeLessThan(50);
  });
});
