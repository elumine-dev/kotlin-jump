package com.example.data

// Stub annotations Room — non disponible dans un projet JVM console
annotation class Dao
annotation class Query(val value: String)
annotation class Insert
annotation class Update
annotation class Delete
annotation class Transaction

// ─────────────────────────────────────────────────────────────────────────────
// DÉMO : SQL syntax highlight inside @Query
//
// Les mots-clés SQL (SELECT, FROM, WHERE, JOIN, ORDER BY, etc.) à l'intérieur
// de @Query("…") doivent être colorés comme du SQL.
// ─────────────────────────────────────────────────────────────────────────────

@Dao
interface PokemonDao {

    // ── SELECT simples ────────────────────────────────────────────────────────

    @Query("SELECT * FROM pokemon")
    fun getAll(): List<Pokemon>

    @Query("SELECT * FROM pokemon WHERE id = :id")
    fun getById(id: Int): Pokemon?

    @Query("SELECT * FROM pokemon WHERE type = :type ORDER BY name ASC")
    fun getByType(type: String): List<Pokemon>

    @Query("SELECT * FROM pokemon WHERE level >= :minLevel ORDER BY level DESC")
    fun getByMinLevel(minLevel: Int): List<Pokemon>

    @Query("SELECT * FROM pokemon WHERE name LIKE :pattern")
    fun searchByName(pattern: String): List<Pokemon>

    // ── SELECT avec colonnes spécifiques ──────────────────────────────────────

    @Query("SELECT * FROM pokemon WHERE level > 50 ORDER BY level DESC")
    fun getStrongPokemonIds(): List<Pokemon>

    @Query("SELECT * FROM pokemon ORDER BY level DESC LIMIT 10")
    fun getTopTen(): List<Pokemon>

    // ── COUNT / aggregation ───────────────────────────────────────────────────

    @Query("SELECT COUNT(*) FROM pokemon")
    fun count(): Int

    @Query("SELECT COUNT(*) FROM pokemon WHERE type = :type")
    fun countByType(type: String): Int

    @Query("SELECT MAX(level) FROM pokemon")
    fun maxLevel(): Int

    @Query("SELECT AVG(level) FROM pokemon WHERE type = :type")
    fun avgLevelByType(type: String): Double

    // ── JOIN ──────────────────────────────────────────────────────────────────

    @Query("""
        SELECT p.id, p.name, p.level
        FROM pokemon p
        INNER JOIN team t ON p.id = t.pokemon_id
        WHERE t.trainer_id = :trainerId
    """)
    fun getTeamMembers(trainerId: Int): List<Pokemon>

    @Query("""
        SELECT p.*
        FROM pokemon p
        LEFT JOIN battles b ON p.id = b.winner_id
        WHERE b.id IS NULL
        ORDER BY p.name ASC
    """)
    fun getPokemonWithoutWins(): List<Pokemon>

    @Query("""
        SELECT p.name, COUNT(b.id) AS win_count
        FROM pokemon p
        LEFT JOIN battles b ON p.id = b.winner_id
        GROUP BY p.id
        HAVING win_count > :minWins
        ORDER BY win_count DESC
    """)
    fun getChampions(minWins: Int): List<Pokemon>

    // ── UPDATE ────────────────────────────────────────────────────────────────

    @Query("UPDATE pokemon SET level = :level WHERE id = :id")
    fun updateLevel(id: Int, level: Int)

    @Query("UPDATE pokemon SET level = level + 1 WHERE type = :type")
    fun levelUpByType(type: String)

    @Query("UPDATE pokemon SET name = :name, level = :level WHERE id = :id")
    fun updateNameAndLevel(id: Int, name: String, level: Int)

    // ── DELETE ────────────────────────────────────────────────────────────────

    @Query("DELETE FROM pokemon WHERE id = :id")
    fun deleteById(id: Int)

    @Query("DELETE FROM pokemon WHERE level < :maxLevel")
    fun deleteWeak(maxLevel: Int)

    @Query("DELETE FROM pokemon WHERE type = :type AND level <= :level")
    fun deleteByTypeAndLevel(type: String, level: Int)

    // ── INSERT / REPLACE ──────────────────────────────────────────────────────

    @Query("INSERT OR REPLACE INTO pokemon (id, name, level, type) VALUES (:id, :name, :level, :type)")
    fun upsert(id: Int, name: String, level: Int, type: String)

    // ── Sous-requêtes ─────────────────────────────────────────────────────────

    @Query("""
        SELECT * FROM pokemon
        WHERE id IN (
            SELECT pokemon_id FROM team WHERE trainer_id = :trainerId
        )
    """)
    fun getTrainerPokemon(trainerId: Int): List<Pokemon>

    @Query("""
        SELECT * FROM pokemon
        WHERE level > (SELECT AVG(level) FROM pokemon)
        ORDER BY level DESC
    """)
    fun getAboveAverage(): List<Pokemon>

    // ── EXISTS / NOT EXISTS ───────────────────────────────────────────────────

    @Query("""
        SELECT * FROM pokemon p
        WHERE EXISTS (
            SELECT 1 FROM battles b
            WHERE b.winner_id = p.id AND b.round_count <= 5
        )
    """)
    fun getQuickWinners(): List<Pokemon>
}

@Dao
interface TrainerDao {

    @Query("SELECT * FROM trainers WHERE id = :id")
    fun getById(id: Int): Any?

    @Query("SELECT * FROM trainers ORDER BY wins DESC LIMIT :limit")
    fun getTopTrainers(limit: Int): List<Any>

    @Query("SELECT COUNT(*) FROM trainers WHERE region = :region")
    fun countByRegion(region: String): Int

    @Transaction
    @Query("SELECT * FROM trainers WHERE id = :id")
    fun getWithTeam(id: Int): Any?
}
