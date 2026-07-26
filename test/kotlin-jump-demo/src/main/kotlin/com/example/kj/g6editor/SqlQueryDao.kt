package com.example.kj.g6editor

import com.example.kj.stubs.Dao
import com.example.kj.stubs.Query

/**
 * KJ-010: SQL syntax highlight inside @Query.
 * Expected: SQL keywords colored (SELECT/FROM/WHERE/JOIN…), :parameters in a
 * distinct tint, multi-line SQL covered, non-SQL left untouched.
 */
@Dao
interface PokemonDaoKj {

    // Simple SQL, highlighting expected.
    @Query("SELECT * FROM pokemon WHERE id = :id")
    fun findById(id: Int): String

    // Multi-line SQL with JOIN, alias, aggregate. Highlighting everywhere.
    @Query(
        """
        SELECT p.name, COUNT(m.id) AS move_count
        FROM pokemon AS p
        LEFT JOIN moves AS m ON m.pokemon_id = p.id
        WHERE p.level >= :minLevel
        GROUP BY p.name
        ORDER BY move_count DESC
        LIMIT :limit
        """
    )
    fun strongest(minLevel: Int, limit: Int): List<String>

    // UPDATE/DELETE: highlighting expected outside SELECT too.
    @Query("UPDATE pokemon SET level = level + 1 WHERE id IN (:ids)")
    fun levelUpAll(ids: List<Int>): Int

    // Trap: a plain string holding SQL words, OUTSIDE @Query.
    // Expected: NO SQL highlighting here.
    fun describe(): String = "SELECT is just a word in this sentence FROM nowhere"
}
