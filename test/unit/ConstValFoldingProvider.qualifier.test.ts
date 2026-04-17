/**
 * Tests adversariaux pour ConstValFoldingProvider — masquage du qualificateur.
 *
 * Nouvelle règle : quand une constante est accédée via un qualificateur
 * (ex : Config.TIMEOUT_MS, Config.Companion.MAX), le qualificateur ET le point
 * sont masqués — seule la valeur s'affiche. Si le point est précédé d'un
 * non-identifiant (`)`, `]`, `?`), le token est ignoré entièrement.
 *
 * Attack surface :
 *  1. Qualificateur simple → qualifier + point masqués
 *  2. Qualificateur double → les deux niveaux + points masqués
 *  3. `this.CONST` → this. masqué
 *  4. Sans qualificateur → comportement inchangé
 *  5. `getConfig().CONST` → précédé par `)` → skip (0 décorations)
 *  6. `configs[0].CONST` → précédé par `]` → skip
 *  7. `Config?.CONST` → `?` précède `.` → skip (null-safe non supporté)
 *  8. Deux qualificateurs sur la même ligne → 2 décorations indépendantes
 *  9. Qualifié + non-qualifié sur même ligne → 2 décorations correctes
 *  10. Vérification du range : start = début du qualifier, end = fin du nom
 *  11. Qualifier en début de ligne (position 0) → range.start.character = 0
 *  12. Chaîne profonde a.b.c.CONST → tout masqué
 *  13. Qualifier numérique Config2.CONST → masqué (digit est \w)
 *  14. Qualifier avec underscore My_Config.CONST → masqué
 *  15. Ambiguïté même via qualifier → 0 décorations (filtre maintenu)
 *  16. `super.CONST` → masqué (super est identifiant)
 *  17. String interpolation `"${Config.CONST}"` → 0 décorations
 *  18. Commentaire `// Config.CONST` → 0 décorations
 *  19. `Config.Companion.CONST.toString()` — `.toString()` non masqué
 *  20. Ligne de déclaration `const val TIMEOUT_MS = 5000` → skip (inchangé)
 *
 * Tests nommés CVF-QUAL-* pour faciliter le grep.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import * as vscodeMock from './__mocks__/vscode';
import { ConstValFoldingProvider } from '../../src/providers/ConstValFoldingProvider';

afterEach(() => vi.restoreAllMocks());

function setup() {
  vi.spyOn(vscodeMock.window, 'createTextEditorDecorationType').mockReturnValue({ dispose: vi.fn() } as any);
  vi.spyOn(vscodeMock.window, 'onDidChangeActiveTextEditor').mockReturnValue({ dispose: vi.fn() } as any);
  vi.spyOn(vscodeMock.workspace, 'onDidChangeTextDocument').mockReturnValue({ dispose: vi.fn() } as any);
  vi.spyOn(vscodeMock.window, 'onDidChangeTextEditorSelection').mockReturnValue({ dispose: vi.fn() } as any);
  vi.spyOn(vscodeMock.window, 'activeTextEditor', 'get').mockReturnValue(undefined as any);
}

type Entry = { name: string; isConst?: boolean; constValue?: string };

function makeIndex(entries: Entry[]) {
  const byName = new Map<string, Entry[]>();
  for (const e of entries) {
    const arr = byName.get(e.name) ?? [];
    arr.push(e);
    byName.set(e.name, arr);
  }
  return { lookup: (name: string) => byName.get(name) ?? [] };
}

function run(entries: Entry[], lines: string[]) {
  setup();
  const editor = {
    document: {
      languageId: 'kotlin',
      lineCount: lines.length,
      lineAt: (i: number) => ({ text: lines[i] }),
    },
    selections: [],
    setDecorations: vi.fn(),
  } as any;
  vi.spyOn(vscodeMock.window, 'visibleTextEditors', 'get').mockReturnValue([editor]);
  new ConstValFoldingProvider(makeIndex(entries) as any);
  return (editor.setDecorations.mock.lastCall?.[1] ?? []) as any[];
}

const TIMEOUT = [{ name: 'TIMEOUT_MS', isConst: true, constValue: '5000' }];
const A_CONST = [{ name: 'A_CONST', isConst: true, constValue: '1' }];
const B_CONST = [{ name: 'B_CONST', isConst: true, constValue: '2' }];
const TWO_CONSTS = [
  { name: 'A_CONST', isConst: true, constValue: '1' },
  { name: 'B_CONST', isConst: true, constValue: '2' },
];

// ── CVF-QUAL-1 : qualificateur simple masqué ──────────────────────────────────

describe('CVF-QUAL-1 — Config.TIMEOUT_MS → qualifier masqué, affiche "5000"', () => {
  it('1 décoration, contentText = "5000"', () => {
    const result = run(TIMEOUT, ['val x = Config.TIMEOUT_MS']);
    expect(result).toHaveLength(1);
    expect(result[0].renderOptions.before.contentText).toBe('5000');
  });
});

// ── CVF-QUAL-2 : qualificateur double ─────────────────────────────────────────

describe('CVF-QUAL-2 — Config.Companion.TIMEOUT_MS → deux niveaux masqués', () => {
  it('1 décoration, contentText = "5000"', () => {
    const result = run(TIMEOUT, ['Config.Companion.TIMEOUT_MS']);
    expect(result).toHaveLength(1);
    expect(result[0].renderOptions.before.contentText).toBe('5000');
  });

  it('range.start = position de "Config"', () => {
    const result = run(TIMEOUT, ['Config.Companion.TIMEOUT_MS']);
    expect(result[0].range.start.character).toBe(0);
  });
});

// ── CVF-QUAL-3 : this.CONST ───────────────────────────────────────────────────

describe('CVF-QUAL-3 — this.TIMEOUT_MS → `this.` masqué', () => {
  it('1 décoration sur this.TIMEOUT_MS', () => {
    const result = run(TIMEOUT, ['return this.TIMEOUT_MS']);
    expect(result).toHaveLength(1);
    expect(result[0].range.start.character).toBe('return '.length);
  });
});

// ── CVF-QUAL-4 : sans qualificateur ──────────────────────────────────────────

describe('CVF-QUAL-4 — TIMEOUT_MS sans qualificateur → comportement inchangé', () => {
  it('range.start = position du nom lui-même', () => {
    const line = 'val x = TIMEOUT_MS';
    const result = run(TIMEOUT, [line]);
    expect(result).toHaveLength(1);
    expect(result[0].range.start.character).toBe(line.indexOf('TIMEOUT_MS'));
  });
});

// ── CVF-QUAL-5 : getConfig().CONST → skip ────────────────────────────────────

describe('CVF-QUAL-5 — getConfig().TIMEOUT_MS → précédé par `)` → 0 décorations', () => {
  it('appel de fonction avant le point → ignoré', () => {
    expect(run(TIMEOUT, ['getConfig().TIMEOUT_MS'])).toHaveLength(0);
  });

  it('expression complexe : (a + b).TIMEOUT_MS → ignoré', () => {
    expect(run(TIMEOUT, ['(a + b).TIMEOUT_MS'])).toHaveLength(0);
  });
});

// ── CVF-QUAL-6 : configs[0].CONST → skip ─────────────────────────────────────

describe('CVF-QUAL-6 — configs[0].TIMEOUT_MS → précédé par `]` → 0 décorations', () => {
  it('accès tableau avant le point → ignoré', () => {
    expect(run(TIMEOUT, ['configs[0].TIMEOUT_MS'])).toHaveLength(0);
  });
});

// ── CVF-QUAL-7 : null-safe Config?.CONST → skip ───────────────────────────────

describe('CVF-QUAL-7 — Config?.TIMEOUT_MS → `?` précède le `.` → 0 décorations', () => {
  it('null-safe access non supporté — ignoré', () => {
    expect(run(TIMEOUT, ['Config?.TIMEOUT_MS'])).toHaveLength(0);
  });
});

// ── CVF-QUAL-8 : deux qualificateurs sur la même ligne ───────────────────────

describe('CVF-QUAL-8 — deux qualificateurs différents sur la même ligne', () => {
  it('Config.A_CONST + Config.B_CONST → 2 décorations indépendantes', () => {
    const result = run(TWO_CONSTS, ['Config.A_CONST + Config.B_CONST']);
    expect(result).toHaveLength(2);
    const texts = result.map((d: any) => d.renderOptions.before.contentText).sort();
    expect(texts).toEqual(['1', '2']);
  });
});

// ── CVF-QUAL-9 : qualifié + non-qualifié sur même ligne ──────────────────────

describe('CVF-QUAL-9 — Config.A_CONST et B_CONST (non-qualifié) sur même ligne', () => {
  it('2 décorations : une avec qualifier, une sans', () => {
    const result = run(TWO_CONSTS, ['Config.A_CONST + B_CONST']);
    expect(result).toHaveLength(2);
  });
});

// ── CVF-QUAL-10 : vérification précise du range ───────────────────────────────

describe('CVF-QUAL-10 — range couvre exactement le qualifier + nom', () => {
  it('range.start = index de "C" dans Config, range.end = fin de TIMEOUT_MS', () => {
    // "val x = Config.TIMEOUT_MS"
    //          ^8               ^25
    const line = 'val x = Config.TIMEOUT_MS';
    const result = run(TIMEOUT, [line]);
    expect(result[0].range.start.character).toBe(line.indexOf('Config'));
    expect(result[0].range.end.character).toBe(line.indexOf('Config') + 'Config.TIMEOUT_MS'.length);
  });
});

// ── CVF-QUAL-11 : qualifier en début de ligne ─────────────────────────────────

describe('CVF-QUAL-11 — qualifier au début de la ligne (position 0)', () => {
  it('range.start.character = 0', () => {
    const result = run(TIMEOUT, ['Config.TIMEOUT_MS']);
    expect(result[0].range.start.character).toBe(0);
    expect(result[0].range.end.character).toBe('Config.TIMEOUT_MS'.length);
  });
});

// ── CVF-QUAL-12 : chaîne profonde a.b.c.CONST ────────────────────────────────

describe('CVF-QUAL-12 — chaîne profonde a.b.c.TIMEOUT_MS → tout masqué', () => {
  it('range couvre a.b.c.TIMEOUT_MS entier', () => {
    const line = 'a.b.c.TIMEOUT_MS';
    const result = run(TIMEOUT, [line]);
    expect(result).toHaveLength(1);
    expect(result[0].range.start.character).toBe(0);
    expect(result[0].range.end.character).toBe(line.length);
  });
});

// ── CVF-QUAL-13 : qualifier numérique Config2.CONST ───────────────────────────

describe('CVF-QUAL-13 — qualifier numérique Config2.TIMEOUT_MS', () => {
  it('Config2 traité comme identifiant → masqué', () => {
    const line = 'Config2.TIMEOUT_MS';
    const result = run(TIMEOUT, [line]);
    expect(result).toHaveLength(1);
    expect(result[0].range.start.character).toBe(0);
  });
});

// ── CVF-QUAL-14 : qualifier underscore My_Config.CONST ───────────────────────

describe('CVF-QUAL-14 — qualifier underscore My_Config.TIMEOUT_MS', () => {
  it('My_Config traité comme identifiant → masqué', () => {
    const line = 'My_Config.TIMEOUT_MS';
    const result = run(TIMEOUT, [line]);
    expect(result[0].range.start.character).toBe(0);
  });
});

// ── CVF-QUAL-15 : ambiguïté même via qualifier ────────────────────────────────

describe('CVF-QUAL-15 — ambiguïté : 2 entries TIMEOUT_MS même via qualifier', () => {
  it('0 décorations — filtre ambiguïté maintenu', () => {
    const ambiguous = [
      { name: 'TIMEOUT_MS', isConst: true, constValue: '5000' },
      { name: 'TIMEOUT_MS', isConst: true, constValue: '9000' },
    ];
    expect(run(ambiguous, ['Config.TIMEOUT_MS'])).toHaveLength(0);
  });
});

// ── CVF-QUAL-16 : super.CONST ────────────────────────────────────────────────

describe('CVF-QUAL-16 — super.TIMEOUT_MS → `super` traité comme identifiant', () => {
  it('super. masqué, valeur affichée', () => {
    const result = run(TIMEOUT, ['super.TIMEOUT_MS']);
    expect(result).toHaveLength(1);
    expect(result[0].range.start.character).toBe(0);
  });
});

// ── CVF-QUAL-17 : string interpolation ───────────────────────────────────────

describe('CVF-QUAL-17 — "${Config.TIMEOUT_MS}" → 1 décoration (foldée dans ${})', () => {
  it('interpolation qualifiée foldée, qualifier masqué', () => {
    const result = run(TIMEOUT, ['val s = "${Config.TIMEOUT_MS}"']);
    expect(result).toHaveLength(1);
    expect(result[0].renderOptions.before.contentText).toBe('5000');
  });

  it('range couvre Config.TIMEOUT_MS uniquement (pas les ${})', () => {
    // 'val s = "${' = 11 chars, 'Config.TIMEOUT_MS' = 17 chars
    const result = run(TIMEOUT, ['val s = "${Config.TIMEOUT_MS}"']);
    expect(result[0].range.start.character).toBe(11);
    expect(result[0].range.end.character).toBe(11 + 'Config.TIMEOUT_MS'.length);
  });
});

// ── CVF-QUAL-18 : commentaire ─────────────────────────────────────────────────

describe('CVF-QUAL-18 — // Config.TIMEOUT_MS → 0 décorations', () => {
  it('commentaire ignoré', () => {
    expect(run(TIMEOUT, ['// Config.TIMEOUT_MS'])).toHaveLength(0);
  });
});

// ── CVF-QUAL-19 : accès de méthode APRÈS le nom ──────────────────────────────

describe('CVF-QUAL-19 — Config.TIMEOUT_MS.toString() → seul Config.TIMEOUT_MS masqué', () => {
  it('.toString() reste visible, valeur insérée avant Config', () => {
    const line = 'Config.TIMEOUT_MS.toString()';
    const result = run(TIMEOUT, [line]);
    expect(result).toHaveLength(1);
    // La range ne doit PAS inclure ".toString()"
    expect(result[0].range.end.character).toBe('Config.TIMEOUT_MS'.length);
  });
});

// ── CVF-QUAL-20 : déclaration const val → skip (inchangé) ────────────────────

describe('CVF-QUAL-20 — ligne de déclaration const val → toujours skippée', () => {
  it('const val TIMEOUT_MS = 5000 → 0 décorations (même avec const val présent)', () => {
    expect(run(TIMEOUT, ['const val TIMEOUT_MS = 5000'])).toHaveLength(0);
  });
});

// ── CVF-QUAL-21 : interpolation non-qualifiée ${TIMEOUT_MS} ──────────────────

describe('CVF-QUAL-21 — "${TIMEOUT_MS}ms" → 1 décoration (non-qualifiée, dans ${})', () => {
  it('1 décoration, contentText = "5000"', () => {
    const result = run(TIMEOUT, ['"${TIMEOUT_MS}ms"']);
    expect(result).toHaveLength(1);
    expect(result[0].renderOptions.before.contentText).toBe('5000');
  });
});

// ── CVF-QUAL-22 : deux interpolations sur la même ligne ─────────────────────

describe('CVF-QUAL-22 — deux interpolations "${A_CONST} + ${B_CONST}" → 2 décorations', () => {
  it('2 décorations indépendantes dans ${} distincts', () => {
    const result = run(
      [{ name: 'A_CONST', isConst: true, constValue: '1' }, { name: 'B_CONST', isConst: true, constValue: '2' }],
      ['"${A_CONST} + ${B_CONST}"'],
    );
    expect(result).toHaveLength(2);
    const texts = result.map((d: any) => d.renderOptions.before.contentText).sort();
    expect(texts).toEqual(['1', '2']);
  });
});

// ── CVF-QUAL-23 : string brute (pas de ${}) → 0 décorations ─────────────────

describe('CVF-QUAL-23 — "plain TIMEOUT_MS" sans ${} → 0 décorations', () => {
  it('string brute non interpolée toujours ignorée', () => {
    expect(run(TIMEOUT, ['"plain TIMEOUT_MS"'])).toHaveLength(0);
  });
});

// ── CVF-QUAL-24 : println avec ${} multi-interpolations ──────────────────────

describe('CVF-QUAL-24 — println(\"[${Config.MAX_ATTEMPTS}] / ${Config.MAX_ATTEMPTS}\") → 2 décorations', () => {
  it('deux occurrences qualifiées dans la même string', () => {
    const result = run(
      [{ name: 'MAX_ATTEMPTS', isConst: true, constValue: '3' }],
      ['println("[${Config.MAX_ATTEMPTS}] x / ${Config.MAX_ATTEMPTS}")'],
    );
    expect(result).toHaveLength(2);
    expect(result[0].renderOptions.before.contentText).toBe('3');
    expect(result[1].renderOptions.before.contentText).toBe('3');
  });
});
