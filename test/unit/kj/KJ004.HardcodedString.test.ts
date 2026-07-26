import { describe, it, expect } from 'vitest';
import { fixture, importOrNull } from './harness';

/**
 * KJ-004 — Hardcoded string lint. CONTRAT :
 *   export function findHardcodedStrings(text: string):
 *     { line: number; literal: string }[]   // line 0-based
 */
const mod: any = await importOrNull('src/providers/HardcodedStringProvider');
const demo = () => fixture('src/main/kotlin/com/example/kj/g2resources/ExtractStringResourceDemo.kt');

describe.skipIf(!mod)('KJ-004 — Hardcoded string lint (fixture réelle)', () => {
  it('flague les 5 strings UI de la fixture, et rien d’autre', () => {
    const hits = mod.findHardcodedStrings(demo());
    const literals = hits.map((h: any) => h.literal);
    expect(literals).toContain('Battle ready!');
    expect(literals).toContain('Ash & Misty\'s team <3');
    expect(literals).toContain('Welcome, trainer!');
    expect(literals).toContain('Enter your name');
    // Aucun faux positif :
    expect(literals.join(' ')).not.toContain('Loading pokemon');
    expect(literals.join(' ')).not.toContain('cache miss');
    expect(literals.join(' ')).not.toContain('id must be positive');
    expect(literals.join(' ')).not.toContain('https://');
  });

  it('les templates UI sont flagués aussi (Text("Turn $turns of 10"))', () => {
    const hits = mod.findHardcodedStrings(demo());
    expect(hits.some((h: any) => h.literal.startsWith('Turn '))).toBe(true);
  });

  it('un fichier sans appel UI ne remonte rien', () => {
    const clean = 'fun log() { println("nothing ui here") }';
    expect(mod.findHardcodedStrings(clean)).toEqual([]);
  });
});
