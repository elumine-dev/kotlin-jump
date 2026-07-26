import { describe, it, expect } from 'vitest';
import { analyzeRoomSchema } from '../../../src/indexer/RoomSchemaIndex';

/** KJ-020 — tentatives de casse au-delà du contrat. */

describe('KJ-020 adversarial', () => {
  it('fallbackToDestructiveMigration : tout est coupé (bruit inutile)', () => {
    const files = [
      `@Entity data class E(@PrimaryKey val id: Int, val a: Int, val b: Int)
       val M = object : Migration(1, 2) { override fun migrate(db: SupportSQLiteDatabase) {
         db.execSQL("ALTER TABLE e ADD COLUMN a INTEGER")
       } }
       @Database(entities = [E::class], version = 3)
       abstract class D
       fun build() = Room.databaseBuilder().fallbackToDestructiveMigration().build()`,
    ];
    const r = analyzeRoomSchema(files);
    expect(r.missingFieldMigrations).toEqual([]);
    expect(r.migrationGaps).toEqual([]);
  });

  it('Migration(1, 3) couvre les DEUX pas 1→2 et 2→3', () => {
    const files = [
      `@Database(entities = [], version = 3) abstract class D
       val M = object : Migration(1, 3) { }`,
    ];
    expect(analyzeRoomSchema(files).migrationGaps).toEqual([]);
  });

  it('version 1 sans migration : aucun trou, aucun flag', () => {
    const files = [
      `@Entity data class E(@PrimaryKey val id: Int, val name: String)
       @Database(entities = [E::class], version = 1) abstract class D`,
    ];
    const r = analyzeRoomSchema(files);
    expect(r.migrationGaps).toEqual([]);
    expect(r.missingFieldMigrations).toEqual([]);
  });

  it('ADD COLUMN avec backticks reconnu', () => {
    const files = [
      `@Entity data class E(@PrimaryKey val id: Int, val level: Int, val bonus: Int)
       val M = object : Migration(1, 2) { override fun migrate(db: SupportSQLiteDatabase) {
         db.execSQL("ALTER TABLE e ADD COLUMN \`level\` INTEGER NOT NULL DEFAULT 1")
       } }
       @Database(entities = [E::class], version = 2) abstract class D`,
    ];
    const r = analyzeRoomSchema(files);
    expect(r.coveredFields).toContain('level');
    expect(r.missingFieldMigrations).toContainEqual({ entity: 'E', field: 'bonus' });
  });

  it('entity sans AUCUN champ couvert : silence total (pas de signal)', () => {
    const files = [
      `@Entity data class Fresh(@PrimaryKey val id: Int, val brand: String)
       @Database(entities = [Fresh::class], version = 1) abstract class D`,
    ];
    expect(analyzeRoomSchema(files).missingFieldMigrations).toEqual([]);
  });

  it('BUG-HUNT-8 : migration au SQL très long (>1500 chars) — ADD COLUMN en fin de corps vu quand même', () => {
    const padding = Array.from({ length: 30 }, (_, i) =>
      `db.execSQL("CREATE INDEX idx_${i} ON pokemon(col_${i})") // remplissage pour dépasser la fenêtre`
    ).join('\n         ');
    const files = [
      `@Entity data class E(@PrimaryKey val id: Int, val lvl: Int, val late: Int)
       val M = object : Migration(1, 2) { override fun migrate(db: SupportSQLiteDatabase) {
         db.execSQL("ALTER TABLE e ADD COLUMN lvl INTEGER")
         ${padding}
         db.execSQL("ALTER TABLE e ADD COLUMN late INTEGER")
       } }
       @Database(entities = [E::class], version = 2) abstract class D`,
    ];
    const r = analyzeRoomSchema(files);
    expect(r.coveredFields).toContain('late');
    expect(r.missingFieldMigrations).toEqual([]);
  });

  it('entités réparties sur plusieurs fichiers fusionnées', () => {
    const r = analyzeRoomSchema([
      '@Entity data class A(@PrimaryKey val id: Int, val lvl: Int, val extra: Int)',
      'val M = object : Migration(1, 2) { override fun migrate(db: SupportSQLiteDatabase) { db.execSQL("ALTER TABLE a ADD COLUMN lvl INTEGER") } }',
      '@Database(entities = [A::class], version = 2) abstract class D',
    ]);
    expect(r.coveredFields).toContain('lvl');
    expect(r.missingFieldMigrations).toContainEqual({ entity: 'A', field: 'extra' });
  });
});
