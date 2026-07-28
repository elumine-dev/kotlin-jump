import { describe, it, expect } from 'vitest';
import { fixture, importOrNull } from './harness';

const mod: any = await importOrNull('src/providers/UnusedParameterProvider');
const demo = () => fixture('src/main/kotlin/com/example/kj/g5deadweight/UnusedParamsDemo.kt');

describe.skipIf(!mod)('KJ-025 — fixture réelle', () => {
  it('flague exactement retryCount, verbose et wallClock', () => {
    const names = mod.findUnusedParameters(demo()).map((u: any) => u.name).sort();
    expect(names).toEqual(['retryCount', 'verbose', 'wallClock']);
  });

  it('kinds corrects pour les trois morts', () => {
    const byName = Object.fromEntries(mod.findUnusedParameters(demo()).map((u: any) => [u.name, u.kind]));
    expect(byName).toEqual({
      retryCount: 'ctorParam',
      wallClock: 'ctorProp',
      verbose: 'funParam',
    });
  });

  it('les vivants ne sont jamais flagués (name via $name, logger, rows, les pièges)', () => {
    const names = mod.findUnusedParameters(demo()).map((u: any) => u.name);
    for (const alive of ['name', 'logger', 'rows', 'x', 'y', 'canvas', 'flags', 'clock']) {
      expect(names, `« ${alive} » ne doit pas être flagué`).not.toContain(alive);
    }
  });

  it('ownerName et paramIndex permettent le retrait aux call sites', () => {
    const retry = mod.findUnusedParameters(demo()).find((u: any) => u.name === 'retryCount');
    expect(retry.ownerName).toBe('ReportService');
    expect(retry.paramIndex).toBe(1);
  });

  it('le label nommé retryCount = 5 hors de la classe ne sauve pas le ctorParam', () => {
    // le scan d'un ctorParam s'arrête à la fin de la classe : le label
    // d'argument dans demoCallSites est hors de portée
    expect(demo()).toContain('retryCount = 5');
    const names = mod.findUnusedParameters(demo()).map((u: any) => u.name);
    expect(names).toContain('retryCount');
  });
});
