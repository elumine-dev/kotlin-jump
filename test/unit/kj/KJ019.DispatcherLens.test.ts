import { describe, it, expect } from 'vitest';
import { fixture, importOrNull } from './harness';

/**
 * KJ-019 — Dispatcher Lens. CONTRAT :
 *   export function analyzeDispatcherScopes(text: string): {
 *     scopes: { dispatcher: 'IO' | 'Main' | 'Default'; startLine: number; endLine: number }[];
 *     hints: { line: number; kind: 'view-in-io' | 'blocking-in-main' }[];
 *   }
 *   // Imbrication : la portée la plus proche gagne. Dispatcher variable → aucune portée.
 */
const mod: any = await importOrNull('src/providers/DispatcherLensProvider');
const demo = () => fixture('src/main/kotlin/com/example/kj/g4runtime/DispatcherLensDemo.kt');

describe.skipIf(!mod)('KJ-019 — fixture DispatcherLensDemo', () => {
  const result = () => mod.analyzeDispatcherScopes(demo());
  const lines = () => demo().split('\n');
  const lineOf = (snippet: string) => lines().findIndex((l) => l.includes(snippet));
  const scopeAt = (line: number) =>
    result().scopes.filter((s: any) => s.startLine <= line && line <= s.endLine)
      .sort((a: any, b: any) => b.startLine - a.startLine)[0];

  it('withContext(IO) donne une portée IO', () => {
    expect(scopeAt(lineOf('api.fetchPokemon(25)'))?.dispatcher).toBe('IO');
  });

  it('imbrication : le withContext(Main) interne gagne', () => {
    expect(scopeAt(lineOf('binding.subtitle.setText(data)'))?.dispatcher).toBe('Main');
  });

  it('launch(Default) → Default', () => {
    expect(scopeAt(lineOf('(1..1_000_000).sum()'))?.dispatcher).toBe('Default');
  });

  it('dispatcher injecté → AUCUNE portée (conservateur)', () => {
    expect(scopeAt(lineOf('api.fetchPokemon(7)'))).toBeUndefined();
  });

  it('indice view-in-io sur le binding dans le bloc IO', () => {
    expect(result().hints).toContainEqual(
      expect.objectContaining({ kind: 'view-in-io', line: lineOf('binding.title.setText(data)') })
    );
  });

  it('indice blocking-in-main sur l’appel réseau dans launch(Main)', () => {
    expect(result().hints).toContainEqual(
      expect.objectContaining({
        kind: 'blocking-in-main',
        line: lineOf('val heavy = api.fetchPokemon(150)'),
      })
    );
  });

  it('aucun indice dans le bloc Default (calcul pur)', () => {
    const l = lineOf('(1..1_000_000).sum()');
    expect(result().hints.some((h: any) => h.line === l)).toBe(false);
  });
});
