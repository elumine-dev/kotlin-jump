import { describe, it, expect } from 'vitest';
import {
  extractReceiver,
  expandPostfix,
} from '../../../src/providers/PostfixCompletionProvider';

/** KJ-002 — tentatives de casse au-delà du contrat. */

describe('KJ-002 adversarial — extractReceiver', () => {
  it('parenthèse ouvrante non fermée : s’arrête au bord', () => {
    const line = 'f(x.';
    expect(extractReceiver(line, line.length - 1)).toBe('x');
  });

  it('receveur dans une condition if', () => {
    const line = 'if (ready.';
    expect(extractReceiver(line, line.length - 1)).toBe('ready');
  });

  it('string literal comme receveur', () => {
    const line = '    "pika".';
    expect(extractReceiver(line, line.length - 1)).toBe('"pika"');
  });

  it('indexation de tableau', () => {
    const line = 'arr[0].';
    expect(extractReceiver(line, line.length - 1)).toBe('arr[0]');
  });

  it('range 1..5 conservé entier', () => {
    const line = '(1..5).';
    expect(extractReceiver(line, line.length - 1)).toBe('(1..5)');
  });

  it('index qui ne pointe pas un point → null', () => {
    expect(extractReceiver('abc', 1)).toBeNull();
  });

  it('point en début de ligne → null (pas de receveur)', () => {
    expect(extractReceiver('.', 0)).toBeNull();
  });

  it('opérateur avant le receveur exclu', () => {
    const line = 'a + b.';
    expect(extractReceiver(line, line.length - 1)).toBe('b');
  });
});

describe('KJ-002 — snippet indentation (measured in a real editor)', () => {
  // VS Code re-indents every line after the first when inserting a
  // multi-line SnippetString: it adds the indentation of the insertion
  // line. A snippet must therefore carry RELATIVE indentation only, one
  // level for the body and none for the closing brace. Absolute
  // indentation here came out indented twice on screen.
  it('body one level in, closing brace at column 0', () => {
    expect(expandPostfix('null', 'pikachu')).toBe('if (pikachu == null) {\n    $0\n}');
  });

  it('try/catch: both blocks relative', () => {
    expect(expandPostfix('try', 'api.fetch()')).toBe(
      'try {\n    api.fetch()\n} catch (e: Exception) {\n    $0\n}',
    );
  });

  it('for and when follow the same shape', () => {
    expect(expandPostfix('for', 'team')).toBe('for (item in team) {\n    $0\n}');
    expect(expandPostfix('when', 'x')).toBe('when (x) {\n    $0\n}');
  });

  it('single-line templates carry no newline at all', () => {
    expect(expandPostfix('let', 'x')).toBe('x.let { $0 }');
    expect(expandPostfix('not', 'ready')).toBe('!ready');
  });
});

describe('KJ-002 adversarial — expandPostfix', () => {
  it('template inconnu → null', () => {
    expect(expandPostfix('elvis', 'x')).toBeNull();
  });

  it('littéraux numériques refusés pour if/null/notnull/not', () => {
    for (const t of ['if', 'null', 'notnull', 'not']) {
      expect(expandPostfix(t, '42'), t).toBeNull();
      expect(expandPostfix(t, '3_000L'), t).toBeNull();
    }
  });

  it('littéral numérique accepté pour let/val/when (légitime)', () => {
    expect(expandPostfix('let', '42')).toBe('42.let { $0 }');
    expect(expandPostfix('val', '42')).toContain('= 42');
    expect(expandPostfix('when', '42')).toContain('when (42)');
  });

  it('BUG-HUNT-1 : littéraux décimaux et hex aussi refusés pour if/null/not', () => {
    // if (3.14) et if (0xFF) sont invalides en Kotlin — la garde ne
    // couvrait que les entiers.
    for (const lit of ['3.14', '0xFF', '0b1010', '2.5f']) {
      expect(expandPostfix('if', lit), `if sur ${lit}`).toBeNull();
      expect(expandPostfix('notnull', lit), `notnull sur ${lit}`).toBeNull();
    }
  });

  it('.not double négation textuelle assumée', () => {
    expect(expandPostfix('not', '!ready')).toBe('!!ready');
  });

  it('try embarque le receveur dans le bloc', () => {
    const out = expandPostfix('try', 'api.fetch()');
    expect(out).toContain('try {\n    api.fetch()');
    expect(out).toContain('catch (e: Exception)');
  });
});
