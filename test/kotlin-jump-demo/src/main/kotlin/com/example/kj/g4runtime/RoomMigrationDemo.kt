package com.example.kj.g4runtime

import com.example.kj.stubs.AutoMigration
import com.example.kj.stubs.ColumnInfo
import com.example.kj.stubs.Database
import com.example.kj.stubs.Entity
import com.example.kj.stubs.Migration
import com.example.kj.stubs.PrimaryKey
import com.example.kj.stubs.SupportSQLiteDatabase

/**
 * KJ-020: Room Migration Drift.
 * Simulated state: the DB is at version 4, the migration history has a hole.
 * Expected:
 *  - `nickname`: ⚠ "field without migration" (no ADD COLUMN nickname anywhere).
 *  - `shinyCharm`: NO warning (covered by @ColumnInfo(defaultValue)).
 *  - chain 1→2 (SQL), 3→4 (auto): ⚠ "hole: migration 2→3 missing".
 *  - `level`: NO warning (covered by MIGRATION_1_2).
 */

@Entity(tableName = "pokemon")
data class PokemonEntity(
    @PrimaryKey val id: Int,
    val name: String,
    // Covered by MIGRATION_1_2, no warning expected.
    val level: Int,
    // ⚠ warning expected: in the entity, missing from every migration,
    // and no defaultValue.
    val nickname: String,
    // Added WITH defaultValue, no warning (Room handles it without a migration).
    @ColumnInfo(name = "shiny_charm", defaultValue = "0")
    val shinyCharm: Boolean,
)

val MIGRATION_1_2 = object : Migration(1, 2) {
    override fun migrate(db: SupportSQLiteDatabase) {
        db.execSQL("ALTER TABLE pokemon ADD COLUMN level INTEGER NOT NULL DEFAULT 1")
    }
}

// ⚠ There is NO Migration(2, 3) at all: expected hole in the chain.

@Database(
    entities = [PokemonEntity::class],
    version = 4,
    autoMigrations = [AutoMigration(from = 3, to = 4)],
)
abstract class PokedexDatabase
