import { describe, it, expect } from 'vitest';
import {
  applyEdits,
  planFileEdits,
  sweepFile,
} from '../../../src/providers/DeadCodeSweep';

/** KJ-030 adversarial — là où deux détecteurs peuvent se marcher dessus. */

const swept = (text: string) => applyEdits(text, planFileEdits(sweepFile(text)));

describe('détecteurs imbriqués', () => {
  it('fonction privée morte contenant une variable morte : une seule édition, la plus large', () => {
    const text = [
      'class A {',
      '  private fun ghost(): Int {',
      '    val alsoDead = 1',
      '    return 2',
      '  }',
      '  fun keep() = 3',
      '}',
      '',
    ].join('\n');
    const findings = sweepFile(text);
    expect(findings.filter(f => f.detector === 'declarations')).toHaveLength(1);

    // Les deux trouvailles existent, mais la suppression de la fonction
    // englobe celle de la variable : le plan n'en garde qu'une.
    const plan = planFileEdits(findings);
    expect(plan).toHaveLength(1);

    const out = swept(text);
    expect(out).not.toContain('ghost');
    expect(out).not.toContain('alsoDead');
    expect(out).toContain('fun keep() = 3');
  });

  it('variable jamais mentionnée et variable seulement assignée ne sont jamais la même trouvaille', () => {
    const text = [
      'class A {',
      '  fun run() {',
      '    val neverMentioned = 1',
      '    var onlyWritten = 2',
      '    onlyWritten = 3',
      '    println(4)',
      '  }',
      '}',
      '',
    ].join('\n');
    const byName = new Map(sweepFile(text).map(f => [f.name, f.detector]));
    expect(byName.get('neverMentioned')).toBe('locals');
    expect(byName.get('onlyWritten')).toBe('writeOnly');
  });

  it('nettoie les deux d’un coup sans toucher au code vivant', () => {
    const text = [
      'class A {',
      '  fun run(): Int {',
      '    val dead = 1',
      '    var written = 2',
      '    written = 3',
      '    val live = 4',
      '    return live',
      '  }',
      '}',
      '',
    ].join('\n');
    const out = swept(text);
    expect(out).not.toContain('dead');
    expect(out).not.toContain('written');
    expect(out).toContain('val live = 4');
    expect(out).toContain('return live');
  });
});

describe('entrées dégénérées', () => {
  it('fichier vide', () => {
    expect(sweepFile('')).toEqual([]);
    expect(swept('')).toBe('');
  });

  it('fichier fait uniquement d’imports morts : tout part, rien ne déborde', () => {
    const text = 'import com.x.A\nimport com.x.B\n';
    expect(swept(text)).toBe('');
  });

  it('accolade jamais fermée : aucune édition ne dépasse la fin du texte', () => {
    const text = 'import com.x.A\nclass Broken {\n  fun f() {\n    val dead = 1\n';
    for (const e of planFileEdits(sweepFile(text))) {
      expect(e.end).toBeLessThanOrEqual(text.length);
      expect(e.start).toBeGreaterThanOrEqual(0);
    }
    expect(() => swept(text)).not.toThrow();
  });

  it('un @Suppress au niveau du fichier éteint tout sauf les imports', () => {
    // KJ-021 n'a jamais eu d'échappatoire, comme IntelliJ dont l'inspection
    // « unused import directive » ne répond pas non plus à Suppress("unused").
    // Le balayage hérite de cet écart : il ne l'invente pas.
    const text = [
      '@file:Suppress("unused")',
      'import com.x.Unused',
      'class A {',
      '  fun compute() {',
      '    val dead = 1',
      '    println(2)',
      '  }',
      '}',
      '',
    ].join('\n');
    expect(sweepFile(text).map(f => f.detector)).toEqual(['imports']);
  });

  it('les fins de ligne Windows survivent au nettoyage', () => {
    const text = 'import com.x.Unused\r\nimport com.x.Used\r\n\r\nclass A {\r\n  fun f() = Used().v\r\n}\r\n';
    const out = swept(text);
    expect(out).not.toContain('com.x.Unused');
    expect(out).toContain('import com.x.Used\r\n');
    expect(out).toContain('fun f() = Used().v');
  });
});

describe('robustesse du plan', () => {
  it('une édition inversée est rejetée plutôt qu’appliquée', () => {
    const broken = [
      { detector: 'locals' as const, line: 0, character: 0, name: 'x', message: '', edits: [{ start: 40, end: 10, text: '' }] },
    ];
    expect(planFileEdits(broken)).toEqual([]);
  });

  it('une édition à offset négatif est rejetée', () => {
    const broken = [
      { detector: 'locals' as const, line: 0, character: 0, name: 'x', message: '', edits: [{ start: -5, end: 10, text: '' }] },
    ];
    expect(planFileEdits(broken)).toEqual([]);
  });

  it('trois éditions dont deux se chevauchent : la troisième survit', () => {
    const mixed = [
      { detector: 'imports' as const, line: 0, character: 0, name: 'a', message: '', edits: [{ start: 0, end: 10, text: '' }] },
      { detector: 'locals' as const, line: 1, character: 0, name: 'b', message: '', edits: [{ start: 5, end: 20, text: '' }] },
      { detector: 'locals' as const, line: 2, character: 0, name: 'c', message: '', edits: [{ start: 30, end: 40, text: '' }] },
    ];
    const plan = planFileEdits(mixed);
    expect(plan).toHaveLength(2);
    expect(plan.map(e => e.start)).toEqual([30, 0]);
  });
});
