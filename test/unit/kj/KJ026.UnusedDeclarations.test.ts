import { describe, it, expect } from 'vitest';
import { fixture, importOrNull } from './harness';

const mod: any = await importOrNull('src/providers/UnusedDeclarationProvider');
const demo = () => fixture('src/main/kotlin/com/example/kj/g5deadweight/UnusedDeclarationsDemo.kt');

describe.skipIf(!mod)('KJ-026 — fixture réelle', () => {
  it('flague exactement staleCache, legacyFormat, countdown, LegacyEncoder et compute', () => {
    const names = mod.findUnusedDeclarations(demo()).map((u: any) => u.name).sort();
    expect(names).toEqual(['LegacyEncoder', 'compute', 'countdown', 'legacyFormat', 'staleCache']);
  });

  it('kinds corrects pour les cinq morts', () => {
    const byName = Object.fromEntries(mod.findUnusedDeclarations(demo()).map((u: any) => [u.name, u.kind]));
    expect(byName).toEqual({
      staleCache: 'val',
      legacyFormat: 'fun',
      countdown: 'fun',
      LegacyEncoder: 'class',
      compute: 'fun',
    });
  });

  it('les pièges vivants ne sont jamais flaggés', () => {
    const names = mod.findUnusedDeclarations(demo()).map((u: any) => u.name);
    for (const alive of ['label', 'handler', 'invoke', 'keptForDebug', 'SHARED', 'mirror', 'parse', 'helper', 'pageSize', 'buildPage']) {
      expect(names, `« ${alive} » ne doit pas être flaggé`).not.toContain(alive);
    }
  });

  it('le removal extent de legacyFormat couvre la déclaration ET son corps, pleines lignes', () => {
    const text = demo();
    const dead = mod.findUnusedDeclarations(text).find((u: any) => u.name === 'legacyFormat');
    const removed = text.slice(dead.removeStart, dead.removeEnd);
    expect(removed).toContain('private fun legacyFormat');
    expect(removed).toContain('row.uppercase()');
    expect(removed.endsWith('\n')).toBe(true);
    expect(text[dead.removeStart - 1]).toBe('\n');
  });
});
