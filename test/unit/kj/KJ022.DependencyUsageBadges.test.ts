import { describe, it, expect } from 'vitest';
import { importOrNull } from './harness';

/**
 * KJ-022 — Badges d'usage des dépendances. CONTRAT :
 *   export function classifyDependency(coordinate: string, imports: string[]):
 *     { kind: 'counted'; imports: number } | { kind: 'bom' } |
 *     { kind: 'buildTime' } | { kind: 'unknown' }
 *   // La table artifact→packages vit dans src/data/artifact-packages.json
 */
const mod: any = await importOrNull('src/providers/DependencyUsageBadgeProvider');

const IMPORTS = [
  'import retrofit2.Retrofit',
  'import kotlinx.coroutines.flow.MutableStateFlow',
  'import kotlinx.coroutines.delay',
];

describe.skipIf(!mod)('KJ-022 — classification', () => {
  it('gson → counted 0', () => {
    expect(mod.classifyDependency('com.google.code.gson:gson', IMPORTS)).toEqual({
      kind: 'counted',
      imports: 0,
    });
  });

  it('retrofit → counted 1', () => {
    expect(mod.classifyDependency('com.squareup.retrofit2:retrofit', IMPORTS)).toEqual({
      kind: 'counted',
      imports: 1,
    });
  });

  it('coroutines → counted 2', () => {
    expect(
      mod.classifyDependency('org.jetbrains.kotlinx:kotlinx-coroutines-core', IMPORTS)
    ).toEqual({ kind: 'counted', imports: 2 });
  });

  it('BOM jamais compté comme mort', () => {
    expect(mod.classifyDependency('androidx.compose:compose-bom', IMPORTS)).toEqual({
      kind: 'bom',
    });
  });

  it('processeur ksp/kapt → buildTime', () => {
    expect(mod.classifyDependency('androidx.room:room-compiler', IMPORTS)).toEqual({
      kind: 'buildTime',
    });
  });

  it('artefact inconnu de la table → unknown (jamais un faux 0)', () => {
    expect(mod.classifyDependency('com.obscure:mystery-lib', IMPORTS)).toEqual({
      kind: 'unknown',
    });
  });
});
