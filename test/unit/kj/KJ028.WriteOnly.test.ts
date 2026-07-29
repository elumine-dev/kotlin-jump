import { describe, it, expect } from 'vitest';
import { fixture, importOrNull } from './harness';

const mod: any = await importOrNull('src/providers/WriteOnlyProvider');
const demo = () => fixture('src/main/kotlin/com/example/kj/g5deadweight/WriteOnlyDemo.kt');

describe.skipIf(!mod)('KJ-028 — fixture réelle', () => {
  it('flague exactement isPlaying, lastError et discarded', () => {
    const names = mod.findWriteOnlyVariables(demo()).map((v: any) => v.name).sort();
    expect(names).toEqual(['discarded', 'isPlaying', 'lastError']);
  });

  it('kind correct : deux membres, une locale', () => {
    const byName = Object.fromEntries(mod.findWriteOnlyVariables(demo()).map((v: any) => [v.name, v.kind]));
    expect(byName).toEqual({ isPlaying: 'member', lastError: 'member', discarded: 'local' });
  });

  it('compte des écritures exact', () => {
    const byName = Object.fromEntries(mod.findWriteOnlyVariables(demo()).map((v: any) => [v.name, v.writeCount]));
    expect(byName).toEqual({ isPlaying: 2, lastError: 1, discarded: 1 });
  });

  it('chaque mort a une suppression proposée', () => {
    for (const v of mod.findWriteOnlyVariables(demo())) {
      expect(v.edits.length, `« ${v.name} » devrait avoir un fix`).toBeGreaterThan(0);
    }
  });

  it('les pièges vivants ne sont jamais flagués', () => {
    const names = mod.findWriteOnlyVariables(demo()).map((v: any) => v.name);
    for (const alive of ['sessionLabel', 'seen', 'neverMentioned', 'handedOff', 'total', 'globalFlag', 'version']) {
      expect(names, `« ${alive} » ne doit pas être flagué`).not.toContain(alive);
    }
  });
});
