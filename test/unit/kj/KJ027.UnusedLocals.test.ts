import { describe, it, expect } from 'vitest';
import { fixture, importOrNull } from './harness';

const mod: any = await importOrNull('src/providers/UnusedLocalProvider');
const demo = () => fixture('src/main/kotlin/com/example/kj/g5deadweight/UnusedLocalsDemo.kt');

describe.skipIf(!mod)('KJ-027 — fixture réelle', () => {
  it('flague exactement les six morts plantés', () => {
    const names = mod.findUnusedLocals(demo()).map((u: any) => u.name).sort();
    expect(names).toEqual(['cached', 'e', 'index', 'labels', 'report', 'staleTotal']);
  });

  it('kind correct pour chaque mort', () => {
    const byName = Object.fromEntries(mod.findUnusedLocals(demo()).map((u: any) => [u.name, u.kind]));
    expect(byName).toEqual({
      staleTotal: 'local',
      labels: 'local',
      report: 'local',
      cached: 'local',
      index: 'lambdaParam',
      e: 'catchBinding',
    });
  });

  it('fix correct : pur supprimé, appel et propriété conservés, bindings renommés', () => {
    const byName = Object.fromEntries(mod.findUnusedLocals(demo()).map((u: any) => [u.name, u.fix]));
    expect(byName).toEqual({
      staleTotal: 'deleteLine',
      labels: 'deleteLine',
      report: 'keepCall',
      cached: 'keepCall',
      index: 'renameUnderscore',
      e: 'renameUnderscore',
    });
  });

  it('les pièges vivants ne sont jamais flagués', () => {
    const names = mod.findUnusedLocals(demo()).map((u: any) => u.name);
    for (const alive of ['count', 'row', 'label', 'cause', 'it', 'first', 'second', 'keptForDebug', 'rows']) {
      expect(names, `« ${alive} » ne doit pas être flagué`).not.toContain(alive);
    }
  });
});
