import { describe, it, expect } from 'vitest';
import { fixture, importOrNull } from './harness';

/**
 * KJ-020 — Room Migration Drift. CONTRAT :
 *   export function analyzeRoomSchema(files: (string | { path?: string; text: string })[]): {
 *     missingFieldMigrations: { entity: string; field: string; fileIndex: number }[];
 *     migrationGaps: { from: number; to: number; fileIndex: number }[];
 *     coveredFields: string[];
 *   }
 * fileIndex pointe l'entrée de `files` où ancrer le diagnostic (voir la
 * suite multidb pour le clustering par @Database).
 */
const mod: any = await importOrNull('src/indexer/RoomSchemaIndex');
const demo = () => [fixture('src/main/kotlin/com/example/kj/g4runtime/RoomMigrationDemo.kt')];

describe.skipIf(!mod)('KJ-020 — fixture PokedexDatabase', () => {
  const result = () => mod.analyzeRoomSchema(demo());

  it('nickname sans migration → signalé', () => {
    expect(result().missingFieldMigrations).toContainEqual({
      entity: 'PokemonEntity',
      field: 'nickname',
      fileIndex: 0,
    });
  });

  it('level couvert par MIGRATION_1_2 → pas signalé', () => {
    expect(result().coveredFields).toContain('level');
    expect(result().missingFieldMigrations.some((m: any) => m.field === 'level')).toBe(false);
  });

  it('shinyCharm exempté par defaultValue → pas signalé', () => {
    expect(result().missingFieldMigrations.some((m: any) => m.field === 'shinyCharm')).toBe(false);
  });

  it('trou 2→3 détecté (1→2 SQL, 3→4 auto, rien entre)', () => {
    expect(result().migrationGaps).toContainEqual({ from: 2, to: 3, fileIndex: 0 });
  });

  it('id (clé primaire d’origine) jamais signalé', () => {
    expect(result().missingFieldMigrations.some((m: any) => m.field === 'id')).toBe(false);
  });
});
