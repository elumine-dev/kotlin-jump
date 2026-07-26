import { describe, it, expect } from 'vitest';
import { fixture, importOrNull } from './harness';

/**
 * KJ-009 — Unused import graying. CONTRAT :
 *   export function findUnusedImports(text: string): { line: number; statement: string }[]
 */
const mod: any = await importOrNull('src/providers/UnusedImportProvider');
const demo = () => fixture('src/main/kotlin/com/example/kj/g5deadweight/UnusedImportsDemo.kt');

describe.skipIf(!mod)('KJ-009 — fixture réelle', () => {
  it('flague exactement User, l’alias Unused et Mutex', () => {
    const unused = mod.findUnusedImports(demo()).map((u: any) => u.statement);
    expect(unused.some((s: string) => s.includes('com.example.data.User'))).toBe(true);
    expect(unused.some((s: string) => s.includes('Intent as Unused'))).toBe(true);
    expect(unused.some((s: string) => s.includes('Mutex'))).toBe(true);
    expect(unused).toHaveLength(3);
  });

  it('l’alias UTILISÉ (Lantern) n’est pas flagué', () => {
    const unused = mod.findUnusedImports(demo()).map((u: any) => u.statement);
    expect(unused.some((s: string) => s.includes('as Lantern'))).toBe(false);
  });

  it('le wildcard couvrant un usage n’est pas flagué', () => {
    const unused = mod.findUnusedImports(demo()).map((u: any) => u.statement);
    expect(unused.some((s: string) => s.includes('kotlinx.coroutines.flow.*'))).toBe(false);
  });

  it('une mention en commentaire ou en string ne compte PAS comme usage', () => {
    // « User » apparaît en commentaire et dans une string de la fixture,
    // l'import doit rester flagué (déjà couvert ci-dessus) — cas synthétique :
    const text = 'import com.x.Foo\n// Foo mentionné\nval s = "Foo"\n';
    const unused = mod.findUnusedImports(text).map((u: any) => u.statement);
    expect(unused.some((s: string) => s.includes('com.x.Foo'))).toBe(true);
  });
});
