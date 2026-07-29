import { describe, it, expect } from 'vitest';
import { analyzeRoomSchema } from '../../../src/indexer/RoomSchemaIndex';

/**
 * KJ-020 — plusieurs @Database dans le même workspace. CONTRAT ÉTENDU :
 *   analyzeRoomSchema(files: (string | { path?: string; text: string })[])
 *   → missingFieldMigrations / migrationGaps portent un fileIndex.
 *
 * Cas réel rencontré en production : deux bases Room indépendantes déclarent chacune une
 * entité nommée `Ad`. La fusion par simple nom de classe faisait hériter à
 * l'entité v1 la baseline de migration de l'autre base → faux positif
 * « Ad.ref: no ADD COLUMN … ».
 */

const adcoreAd = `@Entity(tableName = "ad")
data class Ad(var adId: AdId, var kind: Int) {
    @ColumnInfo(name = "id")
    @PrimaryKey(autoGenerate = true)
    var id: Long = 0
}`;

const appAd = `@Entity(tableName = "ad")
data class Ad(var adId: String, var ref: String) {
    @ColumnInfo(name = "id")
    @PrimaryKey(autoGenerate = true)
    var id: Long = 0
}`;

const dynamicMigration = `val MIGRATION_1_2 = object : Migration(1, 2) {
    override fun migrate(database: SupportSQLiteDatabase) {
        database.execSQL("ALTER TABLE Ad ADD COLUMN kind INTEGER NOT NULL DEFAULT 2")
    }
}`;

const dynamicDb = `@Database(entities = [Ad::class], version = 2, exportSchema = true)
abstract class DynamicAdDatabase : RoomDatabase()`;

const clientDb = `@Database(entities = [Ad::class], version = 1, exportSchema = false)
abstract class ClientAdDatabase : RoomDatabase()`;

const daggerModule = `fun provideDynamic(application: Application): DynamicAdDatabase =
    Room.databaseBuilder(application, DynamicAdDatabase::class.java, "ad-db")
        .addMigrations(MIGRATION_1_2)
        .enableMultiInstanceInvalidation()
        .build()
fun provideClient(application: Application): ClientAdDatabase =
    Room.databaseBuilder(application, ClientAdDatabase::class.java, "client-ad-db")
        .enableMultiInstanceInvalidation()
        .build()`;

const multiDbFiles = () => [
  { path: 'adcore/src/main/java/com/example/adcore/data/dynamicad/database/Ad.kt', text: adcoreAd },
  { path: 'adcore/src/main/java/com/example/adcore/data/dynamicad/database/DynamicDBMigration.kt', text: dynamicMigration },
  { path: 'adcore/src/main/java/com/example/adcore/data/dynamicad/database/DynamicAdDatabase.kt', text: dynamicDb },
  { path: 'app/src/main/java/com/example/app/ads/Ad.kt', text: appAd },
  { path: 'app/src/main/java/com/example/app/ads/ClientAdDatabase.kt', text: clientDb },
  { path: 'app/src/main/java/com/example/core/dagger/module/AppDaggerModule.kt', text: daggerModule },
];

describe('KJ-020 multi-DB — repro terrain (deux entités Ad, deux bases)', () => {
  it('Ad.ref (base v1 sans migration) : plus aucun faux positif', () => {
    const r = analyzeRoomSchema(multiDbFiles());
    expect(r.missingFieldMigrations).toEqual([]);
  });

  it('kind reste couvert, aucune fausse marche dans les chaînes', () => {
    const r = analyzeRoomSchema(multiDbFiles());
    expect(r.coveredFields).toContain('kind');
    expect(r.migrationGaps).toEqual([]);
  });

  it('compat string[] sans chemins : le lien addMigrations suffit à scoper', () => {
    const r = analyzeRoomSchema(multiDbFiles().map(f => f.text));
    expect(r.missingFieldMigrations).toEqual([]);
    expect(r.migrationGaps).toEqual([]);
  });

  it('vrai positif préservé : champ ajouté après kind dans la base v2 → signalé', () => {
    const files = multiDbFiles();
    files[0] = {
      path: files[0].path,
      text: `@Entity(tableName = "ad")
data class Ad(var adId: AdId, var kind: Int, var extra: String) {
    @PrimaryKey(autoGenerate = true)
    var id: Long = 0
}`,
    };
    const r = analyzeRoomSchema(files);
    expect(r.missingFieldMigrations).toEqual([{ entity: 'Ad', field: 'extra', fileIndex: 0 }]);
  });

  it('entité homonyme rattachée par chemin : un champ homonyme couvert ailleurs ne crée pas de baseline ici', () => {
    // The app-side Ad also declares `kind`, but MIGRATION_1_2 belongs to
    // DynamicAdDatabase: the v1 ClientAdDatabase entity must stay silent.
    const files = multiDbFiles();
    files[3] = {
      path: files[3].path,
      text: `@Entity(tableName = "ad")
data class Ad(var adId: String, var kind: Int, var ref: String)`,
    };
    expect(analyzeRoomSchema(files).missingFieldMigrations).toEqual([]);
  });
});

describe('KJ-020 multi-DB — trous de chaîne par base', () => {
  it('chaque base est vérifiée contre SA version (plus seulement la première @Database)', () => {
    const r = analyzeRoomSchema([
      `@Database(entities = [], version = 2) abstract class SmallDb
       @Database(entities = [], version = 3) abstract class BigDb`,
      'val M12 = object : Migration(1, 2) { }',
    ]);
    // M12, non rattachée, profite aux deux bases : pas de faux trou 1→2,
    // mais le 2→3 de BigDb doit sortir.
    expect(r.migrationGaps).toEqual([{ from: 2, to: 3, fileIndex: 0 }]);
  });

  it('une migration liée par addMigrations ne comble pas la chaîne des autres bases', () => {
    const r = analyzeRoomSchema([
      '@Database(entities = [], version = 2) abstract class ADb',
      '@Database(entities = [], version = 2) abstract class BDb',
      `val M12 = object : Migration(1, 2) { }
       fun a(app: Application) = Room.databaseBuilder(app, ADb::class.java, "a").addMigrations(M12).build()`,
    ]);
    expect(r.migrationGaps).toEqual([{ from: 1, to: 2, fileIndex: 1 }]);
  });
});

describe('KJ-020 multi-DB — fallbackToDestructiveMigration scopé', () => {
  it('un fallback lié à UNE base ne coupe pas les diagnostics des autres', () => {
    const r = analyzeRoomSchema([
      `@Entity data class Pok(@PrimaryKey val id: Int, val lvl: Int, val late: Int)`,
      `val M12 = object : Migration(1, 2) { override fun migrate(db: SupportSQLiteDatabase) {
         db.execSQL("ALTER TABLE pok ADD COLUMN lvl INTEGER")
       } }`,
      '@Database(entities = [Pok::class], version = 2) abstract class PokDb',
      `@Entity data class Cli(@PrimaryKey val id: Int, val a: Int)
       @Database(entities = [Cli::class], version = 5) abstract class CliDb`,
      `fun pok(app: Application) = Room.databaseBuilder(app, PokDb::class.java, "p").addMigrations(M12).build()
       fun cli(app: Application) = Room.databaseBuilder(app, CliDb::class.java, "c").fallbackToDestructiveMigration().build()`,
    ]);
    expect(r.missingFieldMigrations).toEqual([{ entity: 'Pok', field: 'late', fileIndex: 0 }]);
    // CliDb (v5, destructive) : aucun trou signalé ; PokDb est complet.
    expect(r.migrationGaps).toEqual([]);
  });

  it('fallback sur un builder sans classe résolvable : silence global (comportement conservé)', () => {
    const r = analyzeRoomSchema([
      `@Entity data class E(@PrimaryKey val id: Int, val a: Int, val b: Int)
       val M = object : Migration(1, 2) { override fun migrate(db: SupportSQLiteDatabase) {
         db.execSQL("ALTER TABLE e ADD COLUMN a INTEGER")
       } }
       @Database(entities = [E::class], version = 3) abstract class D
       fun build() = Room.databaseBuilder().fallbackToDestructiveMigration().build()`,
    ]);
    expect(r.missingFieldMigrations).toEqual([]);
    expect(r.migrationGaps).toEqual([]);
  });

  it('fallbackToDestructiveMigrationOnDowngrade ne coupe RIEN : un upgrade crashe encore', () => {
    const r = analyzeRoomSchema([
      `@Entity data class E(@PrimaryKey val id: Int, val lvl: Int, val late: Int)
       val M = object : Migration(1, 2) { override fun migrate(db: SupportSQLiteDatabase) {
         db.execSQL("ALTER TABLE e ADD COLUMN lvl INTEGER")
       } }
       @Database(entities = [E::class], version = 2) abstract class D
       fun build(app: Application) = Room.databaseBuilder(app, D::class.java, "d")
         .fallbackToDestructiveMigrationOnDowngrade().addMigrations(M).build()`,
    ]);
    expect(r.missingFieldMigrations).toEqual([{ entity: 'E', field: 'late', fileIndex: 0 }]);
  });
});
