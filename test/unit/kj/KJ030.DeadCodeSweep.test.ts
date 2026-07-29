import { describe, it, expect } from 'vitest';
import {
  applyEdits,
  planFileEdits,
  summarize,
  sweepFile,
} from '../../../src/providers/DeadCodeSweep';

/** KJ-030 — agrégation des six détecteurs et plan d'édition d'un fichier. */

describe('sweepFile — agrégation', () => {
  it('rassemble les trouvailles de plusieurs détecteurs dans un seul fichier', () => {
    const text = [
      'import com.x.Unused',
      'import com.x.Used',
      '',
      'class A {',
      '  private fun ghost() = 1',
      '  fun run(): Int {',
      '    val dead = 5',
      '    return Used().value',
      '  }',
      '}',
      '',
    ].join('\n');
    const detectors = new Set(sweepFile(text).map(f => f.detector));
    expect(detectors.has('imports')).toBe(true);
    expect(detectors.has('declarations')).toBe(true);
    expect(detectors.has('locals')).toBe(true);
  });

  it('les trouvailles sortent dans l’ordre du document', () => {
    const text = 'import com.x.Unused\n\nclass A {\n  fun f() {\n    val dead = 1\n    println(2)\n  }\n}\n';
    const lines = sweepFile(text).map(f => f.line);
    expect([...lines].sort((a, b) => a - b)).toEqual(lines);
  });

  it('un fichier propre ne produit rien', () => {
    const text = 'class A {\n  fun f() = 1\n}\n';
    expect(sweepFile(text)).toEqual([]);
  });

  it('summarize compte par détecteur', () => {
    const text = 'import com.x.A\nimport com.x.B\nclass C {\n  fun f() = 1\n}\n';
    const counts = summarize(sweepFile(text));
    expect(counts.get('imports')).toBe(2);
  });

  it('les paramètres sont signalés mais sans édition (les call sites sont ailleurs)', () => {
    // nom de fun assez long : le parser confond une fun d'une lettre avec le
    // « f » de « fun » et la saute (quirk connu, verrouillé côté KJ-025)
    const text = 'class A {\n  private fun render(dead: Int) = 1\n  fun use() = render(2)\n}\n';
    const param = sweepFile(text).find(f => f.detector === 'parameters');
    expect(param).toBeDefined();
    expect(param!.edits).toEqual([]);
  });
});

describe('planFileEdits — plan sûr', () => {
  it('rend les éditions de la fin vers le début', () => {
    const text = 'import com.x.A\nimport com.x.B\nclass C {\n  fun f() = 1\n}\n';
    const plan = planFileEdits(sweepFile(text));
    expect(plan.length).toBeGreaterThan(1);
    for (let i = 1; i < plan.length; i++) {
      expect(plan[i].start).toBeLessThan(plan[i - 1].start);
    }
  });

  it('deux éditions qui se chevauchent : une seule survit', () => {
    const overlapping = [
      { detector: 'locals' as const, line: 0, character: 0, name: 'x', message: '', edits: [{ start: 10, end: 30, text: '' }] },
      { detector: 'writeOnly' as const, line: 0, character: 0, name: 'x', message: '', edits: [{ start: 20, end: 40, text: '' }] },
    ];
    expect(planFileEdits(overlapping)).toHaveLength(1);
  });

  it('les éditions adjacentes non chevauchantes sont toutes gardées', () => {
    const adjacent = [
      { detector: 'imports' as const, line: 0, character: 0, name: 'a', message: '', edits: [{ start: 0, end: 10, text: '' }] },
      { detector: 'imports' as const, line: 1, character: 0, name: 'b', message: '', edits: [{ start: 10, end: 20, text: '' }] },
    ];
    expect(planFileEdits(adjacent)).toHaveLength(2);
  });

  it('les trouvailles sans édition sûre sont ignorées du plan', () => {
    const noFix = [
      { detector: 'parameters' as const, line: 0, character: 0, name: 'p', message: '', edits: [] },
    ];
    expect(planFileEdits(noFix)).toEqual([]);
  });
});

describe('applyEdits — le résultat tient debout', () => {
  it('nettoie imports et locale morte en une passe, le code vivant intact', () => {
    const text = [
      'import com.x.Unused',
      'import com.x.Used',
      '',
      'class A {',
      '  fun run(): Int {',
      '    val dead = 5',
      '    return Used().value',
      '  }',
      '}',
      '',
    ].join('\n');
    const out = applyEdits(text, planFileEdits(sweepFile(text)));
    expect(out).not.toContain('com.x.Unused');
    expect(out).not.toContain('val dead');
    expect(out).toContain('import com.x.Used');
    expect(out).toContain('return Used().value');
  });

  it('un second passage ne casse rien (idempotence pratique)', () => {
    const text = 'import com.x.Unused\nclass A {\n  fun f() {\n    val dead = 1\n    println(2)\n  }\n}\n';
    const once = applyEdits(text, planFileEdits(sweepFile(text)));
    const twice = applyEdits(once, planFileEdits(sweepFile(once)));
    expect(twice).toBe(once);
  });

  it('le balayage n’invente jamais d’édition sur un fichier sain', () => {
    const text = 'import com.x.Used\n\nclass A {\n  fun f() = Used().value\n}\n';
    expect(applyEdits(text, planFileEdits(sweepFile(text)))).toBe(text);
  });

  it('les accolades restent équilibrées après nettoyage', () => {
    const text = [
      'import com.x.Unused',
      'class A {',
      '  private fun ghost(): Int {',
      '    return 1',
      '  }',
      '  fun keep() {',
      '    val dead = 2',
      '    println(3)',
      '  }',
      '}',
      '',
    ].join('\n');
    const out = applyEdits(text, planFileEdits(sweepFile(text)));
    const open = (out.match(/\{/g) ?? []).length;
    const close = (out.match(/\}/g) ?? []).length;
    expect(open).toBe(close);
    expect(out).toContain('fun keep()');
  });
});
