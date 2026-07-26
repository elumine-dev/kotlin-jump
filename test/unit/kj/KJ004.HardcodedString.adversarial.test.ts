import { describe, it, expect } from 'vitest';
import { findHardcodedStrings } from '../../../src/providers/HardcodedStringProvider';

/** KJ-004 — tentatives de casse au-delà du contrat. */

describe('KJ-004 adversarial', () => {
  it('appel Compose multi-lignes détecté (le cas réel le plus courant)', () => {
    const text = 'Text(\n    "Battle!",\n    modifier = Modifier.padding(8.dp),\n)';
    const hits = findHardcodedStrings(text);
    expect(hits).toHaveLength(1);
    expect(hits[0].literal).toBe('Battle!');
    expect(hits[0].line).toBe(1); // la ligne du littéral, pas celle du Text(
  });

  it('rien dans un commentaire ligne', () => {
    expect(findHardcodedStrings('// Text("fake")')).toHaveLength(0);
  });

  it('rien dans un bloc /* … */ multi-lignes', () => {
    expect(findHardcodedStrings('/*\nText("fake")\n*/')).toHaveLength(0);
  });

  it('rien dans une raw string contenant du pseudo-code', () => {
    expect(findHardcodedStrings('val doc = """\nText("fake")\n"""')).toHaveLength(0);
  });

  it('literal avec guillemet échappé capturé en entier', () => {
    const hits = findHardcodedStrings('setTitle("dit \\"go\\" fort")');
    expect(hits).toHaveLength(1);
    expect(hits[0].literal).toBe('dit \\"go\\" fort');
  });

  it('string vide jamais flaguée', () => {
    expect(findHardcodedStrings('Text("")')).toHaveLength(0);
  });

  it('fonction non-UI dont le nom CONTIENT un nom UI : pas flaguée', () => {
    expect(findHardcodedStrings('formatText("data")')).toHaveLength(0);
    expect(findHardcodedStrings('resetTextCache("x")')).toHaveLength(0);
  });

  it('premier argument non-string : pas flagué (Text(pokemon.name))', () => {
    expect(findHardcodedStrings('Text(pokemon.name)')).toHaveLength(0);
  });

  it('colonnes exactes pour le surlignage', () => {
    const hits = findHardcodedStrings('    Text("Hi")');
    expect(hits[0].column).toBe(9);
  });

  it('gros fichier : 2000 lignes sans UI ne remontent rien et vite', () => {
    const big = Array.from({ length: 2000 }, (_, i) => `val v${i} = compute(${i})`).join('\n');
    const start = performance.now();
    expect(findHardcodedStrings(big)).toHaveLength(0);
    expect(performance.now() - start).toBeLessThan(200);
  });
});
