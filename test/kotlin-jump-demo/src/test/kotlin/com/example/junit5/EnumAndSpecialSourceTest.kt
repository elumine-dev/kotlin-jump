package com.example.junit5

import com.example.data.PokemonType
import com.example.data.PokemonType.*
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertNotNull
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.params.ParameterizedTest
import org.junit.jupiter.params.provider.EmptySource
import org.junit.jupiter.params.provider.EnumSource
import org.junit.jupiter.params.provider.NullAndEmptySource
import org.junit.jupiter.params.provider.NullSource

/**
 * @EnumSource, @NullSource, @EmptySource, @NullAndEmptySource — special parameter sources.
 */
class EnumAndSpecialSourceTest {

    // ── @EnumSource ───────────────────────────────────────────────────────────

    @ParameterizedTest
    @EnumSource(PokemonType::class)
    fun `every pokemon type can be looked up by its own name`(type: PokemonType) {
        assertNotNull(PokemonType.valueOf(type.name))
        assertEquals(type, PokemonType.valueOf(type.name))
    }

    @ParameterizedTest
    @EnumSource(PokemonType::class)
    fun `no type is strong against itself`(type: PokemonType) {
        assertFalse(type.isStrongAgainst(type), "$type should not beat itself")
    }

    @ParameterizedTest
    @EnumSource(PokemonType::class)
    fun `every type name is non-empty`(type: PokemonType) {
        assertTrue(type.name.isNotEmpty())
    }

    // @EnumSource with names filter — only the 4 types that have an advantage
    @ParameterizedTest
    @EnumSource(PokemonType::class, names = ["FIRE", "WATER", "GRASS", "ELECTRIC"])
    fun `these four types each beat exactly one other type`(type: PokemonType) {
        val victims = PokemonType.entries.filter { other -> type.isStrongAgainst(other) }
        assertEquals(1, victims.size, "$type should beat exactly 1 type, but beats: $victims")
    }

    // @EnumSource with EXCLUDE mode — PSYCHIC and DRAGON
    @ParameterizedTest
    @EnumSource(PokemonType::class, mode = EnumSource.Mode.EXCLUDE, names = ["FIRE", "WATER", "GRASS", "ELECTRIC"])
    fun `psychic and dragon have no type advantage`(type: PokemonType) {
        val victims = PokemonType.entries.filter { other -> type.isStrongAgainst(other) }
        assertTrue(victims.isEmpty(), "$type should beat 0 types, but beats: $victims")
    }

    // @EnumSource with MATCH_ANY — regex pattern
    @ParameterizedTest
    @EnumSource(PokemonType::class, mode = EnumSource.Mode.MATCH_ANY, names = [".*R.*"])
    fun `types whose name contains R are FIRE WATER and DRAGON`(type: PokemonType) {
        assertTrue(type.name.contains("R"), "${type.name} should contain 'R'")
    }

    // ── @NullSource ───────────────────────────────────────────────────────────

    @ParameterizedTest
    @NullSource
    fun `null string value is null`(value: String?) {
        assertNull(value)
    }

    // ── @EmptySource ──────────────────────────────────────────────────────────

    @ParameterizedTest
    @EmptySource
    fun `empty string has length zero`(value: String) {
        assertEquals(0, value.length)
        assertTrue(value.isEmpty())
    }

    // ── @NullAndEmptySource ───────────────────────────────────────────────────

    @ParameterizedTest
    @NullAndEmptySource
    fun `null or empty value is null or empty`(value: String?) {
        assertTrue(value.isNullOrEmpty(), "Expected null or empty but got: '$value'")
    }

    @ParameterizedTest
    @NullAndEmptySource
    fun `null or empty value has no meaningful content`(value: String?) {
        assertFalse(value != null && value.isNotEmpty(), "Expected null/empty but got non-empty: '$value'")
    }
}
