package com.example.data

import com.example.data.PokemonType.*
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertNotEquals
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

/**
 * Data class contract — equals, hashCode, copy, toString, destructuring.
 * Covers both Pokemon and User to show the pattern applies to any data class.
 */
class DataClassPropertiesTest {

    // ── Pokemon equals ────────────────────────────────────────────────────────

    @Test
    fun `two pokemon with identical fields are equal`() {
        val a = Pokemon(25, "Pikachu", ELECTRIC, 25, 100)
        val b = Pokemon(25, "Pikachu", ELECTRIC, 25, 100)
        assertEquals(a, b)
    }

    @Test
    fun `pokemon with different id are not equal`() {
        val a = Pokemon(25, "Pikachu", ELECTRIC, 25, 100)
        val b = Pokemon(26, "Pikachu", ELECTRIC, 25, 100)
        assertNotEquals(a, b)
    }

    @Test
    fun `pokemon with different name are not equal`() {
        val a = Pokemon(25, "Pikachu",   ELECTRIC, 25, 100)
        val b = Pokemon(25, "Raichu",    ELECTRIC, 50, 100)
        assertNotEquals(a, b)
    }

    @Test
    fun `pokemon with different type are not equal`() {
        val a = Pokemon(1, "Bulbasaur", GRASS, 5, 45)
        val b = Pokemon(1, "Bulbasaur", FIRE,  5, 45)
        assertNotEquals(a, b)
    }

    @Test
    fun `pokemon is equal to itself (reflexive)`() {
        val p = Pokemon(25, "Pikachu", ELECTRIC, 25, 100)
        assertEquals(p, p)
    }

    // ── Pokemon hashCode ──────────────────────────────────────────────────────

    @Test
    fun `equal pokemon have the same hashCode`() {
        val a = Pokemon(7, "Squirtle", WATER, 15, 44)
        val b = Pokemon(7, "Squirtle", WATER, 15, 44)
        assertEquals(a.hashCode(), b.hashCode())
    }

    @Test
    fun `pokemon can be used as map key`() {
        val pikachu = Pokemon(25, "Pikachu", ELECTRIC, 25, 100)
        val map = mapOf(pikachu to "starter")
        val lookup = Pokemon(25, "Pikachu", ELECTRIC, 25, 100)
        assertEquals("starter", map[lookup])
    }

    // ── Pokemon copy ──────────────────────────────────────────────────────────

    @Test
    fun `copy with no overrides produces equal instance`() {
        val original = Pokemon(4, "Charmander", FIRE, 10, 39)
        assertEquals(original, original.copy())
    }

    @Test
    fun `copy with level override only changes level`() {
        val original = Pokemon(4, "Charmander", FIRE, 10, 39)
        val leveled  = original.copy(level = 36)
        assertEquals(36,         leveled.level)
        assertEquals(original.id,   leveled.id)
        assertEquals(original.name, leveled.name)
        assertEquals(original.type, leveled.type)
        assertEquals(original.hp,   leveled.hp)
    }

    @Test
    fun `copy does not mutate the original`() {
        val original = Pokemon(1, "Bulbasaur", GRASS, 5, 45)
        original.copy(id = 999, name = "Clone")
        assertEquals(1,           original.id)
        assertEquals("Bulbasaur", original.name)
    }

    @Test
    fun `copy allows type change`() {
        val charizard = Pokemon(6, "Charizard", FIRE,   50, 78)
        val variant   = charizard.copy(type = DRAGON)
        assertEquals(DRAGON, variant.type)
        assertEquals(FIRE,   charizard.type)
    }

    @Test
    fun `copy allows multiple fields to change at once`() {
        val base    = Pokemon(1, "Bulbasaur", GRASS, 5, 45)
        val evolved = base.copy(id = 2, name = "Ivysaur", level = 16, hp = 60)
        assertEquals(2,         evolved.id)
        assertEquals("Ivysaur", evolved.name)
        assertEquals(16,        evolved.level)
        assertEquals(60,        evolved.hp)
        assertEquals(GRASS,     evolved.type)
    }

    // ── Pokemon destructuring (componentN) ───────────────────────────────────

    @Test
    fun `component1 extracts id`() {
        val p = Pokemon(25, "Pikachu", ELECTRIC, 25, 100)
        val (id) = p
        assertEquals(25, id)
    }

    @Test
    fun `all five components extract in declaration order`() {
        val p = Pokemon(7, "Squirtle", WATER, 15, 44)
        val (id, name, type, level, hp) = p
        assertEquals(7,          id)
        assertEquals("Squirtle", name)
        assertEquals(WATER,      type)
        assertEquals(15,         level)
        assertEquals(44,         hp)
    }

    // ── Pokemon toString ──────────────────────────────────────────────────────

    @Test
    fun `toString contains class name and key fields`() {
        val p = Pokemon(25, "Pikachu", ELECTRIC, 25, 100)
        val s = p.toString()
        assertTrue(s.contains("Pokemon"),  "toString: $s")
        assertTrue(s.contains("Pikachu"),  "toString: $s")
        assertTrue(s.contains("ELECTRIC"), "toString: $s")
    }

    // ── User equals / hashCode / copy ─────────────────────────────────────────

    @Test
    fun `two users with identical fields are equal`() {
        val a = User("1", "Alice", "alice@example.com", UserRole.ADMIN)
        val b = User("1", "Alice", "alice@example.com", UserRole.ADMIN)
        assertEquals(a, b)
        assertEquals(a.hashCode(), b.hashCode())
    }

    @Test
    fun `users with different email are not equal`() {
        val a = User("1", "Alice", "alice@example.com",     UserRole.ADMIN)
        val b = User("1", "Alice", "alice-alt@example.com", UserRole.ADMIN)
        assertNotEquals(a, b)
    }

    @Test
    fun `user copy with role promotion`() {
        val original = User("1", "Alice", "alice@example.com", UserRole.VIEWER)
        val promoted = original.copy(role = UserRole.ADMIN)
        assertEquals(UserRole.ADMIN,   promoted.role)
        assertEquals(UserRole.VIEWER,  original.role)
        assertEquals(original.id,      promoted.id)
        assertEquals(original.name,    promoted.name)
        assertEquals(original.email,   promoted.email)
    }

    @Test
    fun `user copy does not mutate original`() {
        val original = User("1", "Alice", "alice@example.com", UserRole.VIEWER)
        original.copy(role = UserRole.ADMIN)
        assertEquals(UserRole.VIEWER, original.role)
    }
}
