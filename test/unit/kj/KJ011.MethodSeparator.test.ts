import { describe, it, expect } from 'vitest';
import { fixture, importOrNull } from './harness';

/**
 * KJ-011 — Method separator. CONTRAT :
 *   export function computeSeparatorLines(text: string): number[]
 *   // Lignes (0-based) au-dessus desquelles tracer un filet : chaque membre
 *   // de premier niveau d'une classe SAUF le premier ; jamais entre
 *   // propriétés simples consécutives ; jamais dans les corps.
 */
const mod: any = await importOrNull('src/providers/MethodSeparatorProvider');
const demo = () => fixture('src/main/kotlin/com/example/kj/g6editor/MethodSeparatorDemo.kt');

describe.skipIf(!mod)('KJ-011 — fixture réelle', () => {
  it('un filet avant chaque fun/companion/classe imbriquée, pas avant les propriétés', () => {
    const text = demo();
    const lines = text.split('\n');
    const separators: number[] = mod.computeSeparatorLines(text);

    const expectSeparatorAt = (snippet: string) => {
      const idx = lines.findIndex((l) => l.includes(snippet));
      expect(separators, `filet attendu avant: ${snippet}`).toContain(idx);
    };
    expectSeparatorAt('fun store(');
    // Spec 2026-07-25 (Kevin) : le filet passe AU-DESSUS du commentaire
    // attaché, comme IntelliJ — pas entre le commentaire et sa fonction.
    expectSeparatorAt('// Expression body');
    const funSize = lines.findIndex(l => l.includes('fun size(): Int'));
    expect(separators).not.toContain(funSize);
    expectSeparatorAt('fun clear()');
    expectSeparatorAt('class Snapshot(');
    expectSeparatorAt('companion object {');

    // Jamais entre les deux propriétés consécutives du haut de classe.
    const hitsProp = lines.findIndex((l) => l.includes('private var hits'));
    expect(separators).not.toContain(hitsProp);

    // Jamais DANS un corps de fonction.
    const insideBody = lines.findIndex((l) => l.includes('hits += 1'));
    expect(separators).not.toContain(insideBody);
  });

  it('fichier sans classe → aucun filet, pas de crash', () => {
    expect(mod.computeSeparatorLines('val x = 1\nval y = 2\n')).toEqual([]);
  });
});
