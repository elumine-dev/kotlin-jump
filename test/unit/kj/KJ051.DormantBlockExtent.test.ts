import { describe, it, expect } from 'vitest';
import { findDormantCode } from '../../../src/providers/dormantCode';

/**
 * On an open source app, `kdead remove --all` cut fifty live lines: an
 * argument comment `/* minBufferMs *\/ 10_000,` was read as the opening of a
 * commented-out block that ran to the closing of the next KDoc. The module
 * stopped compiling on 122 errors. A block ends at its FIRST closing.
 */
const find = (text: string) => findDormantCode({ sources: [{ path: '/m/src/main/java/a/A.kt', text }], testSourceSets: ['test'] });

describe('KJ051 the extent of a commented-out block', () => {
  it('an argument comment followed by code opens no block', () => {
    const text = [
      'fun build() = Builder()',
      '    .setBuffers(',
      '        /* minBufferMs */ 10_000,',
      '        /* maxBufferMs */ 20_000,',
      '    )',
      '    .build()',
      '',
      'fun other(a: Int): Int {',
      '    val b = a + 1',
      '    return b',
      '}',
      '',
      '/*',
      ' * A note.',
      ' */',
      'fun last() = 1',
    ].join('\n');
    expect(find(text)).toEqual([]);
  });

  it('a real commented-out block is still found, on its own lines', () => {
    const text = 'fun a() = 1\n/*\nfun old(x: Int): Int {\n    val y = x + 1\n    return y\n}\n*/\nfun b() = 2\n';
    const [d] = find(text);
    expect(d?.kind).toBe('commentedCode');
    expect(text.slice(0, d.removeStart) + text.slice(d.removeEnd)).toBe('fun a() = 1\nfun b() = 2\n');
  });

  it('lines of a raw string are text, even when they read as commented code', () => {
    const body = ['// val a = 1;', '// val b = 2;', '// fun c() { return; }', '// val d = a + b;', '// call(d);'].join('\n');
    expect(find(`val sample = """\n${body}\n"""\n`)).toEqual([]);
    expect(find(`${body}\nval x = 1\n`).length).toBe(1);
  });
});

/**
 * The same run cut the GPL header of 276 files: `the Free Software Foundation;
 * either version 3 of the` carries a `;`, and `(at your option)` parentheses,
 * which was enough to read as code. A report may list on a likeness; `certain`
 * is what a removal asks for.
 */
describe('KJ051 commented-out code a removal can take', () => {
  const licence = [
    '/* Copyright 2017 Someone',
    ' *',
    ' * This program is free software; you can redistribute it and/or modify it under the terms of the',
    ' * GNU General Public License as published by the Free Software Foundation; either version 3 of the',
    ' * License, or (at your option) any later version.',
    ' *',
    ' * See <http://www.gnu.org/licenses>. */',
  ].join('\n');

  it('a licence header is never certain, above the package line or below', () => {
    expect(find(`${licence}\n\npackage a\n\nclass A\n`).some(d => d.certain)).toBe(false);
    expect(find(`package a\n\n${licence}\nclass A\n`).some(d => d.certain)).toBe(false);
  });

  it('code is certain, in a block and in a run of line comments', () => {
    const block = 'package a\n\n/*\nfun old(x: Int): Int {\n    val y = x + 1\n    return y\n}\n*/\nclass A\n';
    expect(find(block).map(d => d.certain)).toEqual([true]);
    const run = 'package a\n\n// val a = compute()\n// if (a > 1) {\n//     send(a)\n// }\n// return a\nclass A\n';
    expect(find(run).map(d => d.certain)).toEqual([true]);
  });

  it('a run that mixes code and a sentence is listed, not certain', () => {
    const run = 'package a\n\n// val a = compute()\n// This is what the server sends back to us.\n// if (a > 1) {\n//     send(a)\n// }\nclass A\n';
    expect(find(run).map(d => d.certain)).toEqual([false]);
  });
});
