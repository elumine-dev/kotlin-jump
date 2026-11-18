import { describe, it, expect } from 'vitest';
import { importOrNull } from './harness';

/**
 * The offset of a catch binding was `catchMatch[0].indexOf(name)`: the FIRST
 * occurrence of the name in `catch (t: Throwable)`, which is the `t` of
 * `catch`. Seen on an open source IPTV app, where Remove Everything Unused
 * wrote `} ca_ch (t: Throwable) {` and the module no longer parsed. Any name
 * that is a substring of `catch` was hit: `t`, `a`, `c`, `h`, `at`, `ch`.
 */

const mod: any = await importOrNull('src/providers/unusedLocals');

const renamed = (text: string): string => {
  let out = text;
  const edits = (mod.findUnusedLocals(text) as any[]).filter(u => u.kind === 'catchBinding')
    .sort((a, b) => b.fixStart - a.fixStart);
  for (const u of edits) out = out.slice(0, u.fixStart) + u.fixText + out.slice(u.fixEnd);
  return out;
};

describe.skipIf(!mod)('the catch binding is renamed where it is written', () => {
  for (const name of ['t', 'a', 'c', 'h', 'at', 'ch', 'tc']) {
    it(`catch (${name}: Throwable)`, () => {
      const t = `package a\n\nfun f(): String? = try {\n    load()\n} catch (${name}: Throwable) {\n    null\n}\n`;
      expect(renamed(t)).toBe(t.replace(`catch (${name}:`, 'catch (_:'));
    });
  }

  it('spaces inside the parenthesis', () => {
    const t = 'package a\n\nfun f() {\n    try { load() } catch (  t : Exception) { log() }\n}\n';
    expect(renamed(t)).toBe(t.replace('(  t :', '(  _ :'));
  });

  it('control: a binding that is used is left alone', () => {
    const t = 'package a\n\nfun f() {\n    try { load() } catch (t: Exception) { log(t) }\n}\n';
    expect(renamed(t)).toBe(t);
  });
});
