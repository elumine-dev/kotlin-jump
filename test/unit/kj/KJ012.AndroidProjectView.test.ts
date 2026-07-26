import { describe, it, expect } from 'vitest';
import { fixture, importOrNull } from './harness';

/**
 * KJ-012 — Android project view. CONTRAT :
 *   export function parseIncludedModules(settingsText: string): string[]
 *   export function groupResByType(paths: string[]):
 *     { type: string; base: string; qualifiers: string[] }[]
 */
const mod: any = await importOrNull('src/ui/AndroidProjectViewProvider');

describe.skipIf(!mod)('KJ-012 — modules', () => {
  it('lit include(":feature-battle") depuis la fixture réelle', () => {
    expect(mod.parseIncludedModules(fixture('settings.gradle.kts'))).toEqual([':feature-battle']);
  });

  it('includes multiples et variantes de syntaxe', () => {
    const s = `include(":a")\ninclude ( ":b" , ":c" )\n// include(":commented")`;
    expect(mod.parseIncludedModules(s)).toEqual([':a', ':b', ':c']);
  });
});

describe.skipIf(!mod)('KJ-012 — regroupement res', () => {
  it('les qualificatifs deviennent enfants du dossier de base', () => {
    const groups = mod.groupResByType([
      'src/main/res/values/strings.xml',
      'src/main/res/values-fr/strings.xml',
      'src/main/res/values-en/strings.xml',
      'src/main/res/drawable/ic_pokeball.xml',
    ]);
    const values = groups.find((g: any) => g.type === 'values');
    expect(values.qualifiers).toEqual(expect.arrayContaining(['values-fr', 'values-en']));
    const drawable = groups.find((g: any) => g.type === 'drawable');
    expect(drawable.qualifiers).toEqual([]);
  });
});
