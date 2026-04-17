package com.example.junit5

import com.example.data.Pokemon
import com.example.data.PokemonStorage
import com.example.data.PokemonType.*
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertNotNull
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.condition.DisabledOnOs
import org.junit.jupiter.api.condition.EnabledIfSystemProperty
import org.junit.jupiter.api.condition.EnabledOnJre
import org.junit.jupiter.api.condition.EnabledOnOs
import org.junit.jupiter.api.condition.JRE
import org.junit.jupiter.api.condition.OS

/**
 * Conditional test execution — @EnabledOnOs, @DisabledOnOs, @EnabledOnJre,
 * @EnabledIfSystemProperty.
 *
 * Most tests here run unconditionally; a few are skipped based on the environment.
 * The important thing is verifying the annotation is recognised and behaves correctly —
 * a skipped test means the condition evaluated to false, which is a valid outcome.
 */
class ConditionalExecutionTest {

    // ── @EnabledOnOs ──────────────────────────────────────────────────────────

    @Test
    @EnabledOnOs(OS.MAC, OS.LINUX, OS.WINDOWS)
    fun `runs on any major OS — always active in CI and local dev`() {
        val storage = PokemonStorage()
        storage.save(Pokemon(1, "Bulbasaur", GRASS, 5, 45))
        assertEquals(1, storage.count())
    }

    @Test
    @EnabledOnOs(OS.MAC)
    fun `mac-only — file-system path separator is forward-slash`() {
        assertEquals("/", java.io.File.separator)
    }

    // ── @DisabledOnOs ─────────────────────────────────────────────────────────

    @Test
    @DisabledOnOs(OS.WINDOWS)
    fun `disabled on Windows — forward-slash separator assumed`() {
        assertTrue(java.io.File.separator != "\\")
    }

    // ── @EnabledOnJre ─────────────────────────────────────────────────────────

    @Test
    @EnabledOnJre(JRE.JAVA_11, JRE.JAVA_17, JRE.JAVA_21, JRE.OTHER)
    fun `runs on JDK 11 or later — the project target`() {
        val version = System.getProperty("java.version")
        assertNotNull(version)
        assertTrue(version.isNotEmpty())
    }

    // ── @EnabledIfSystemProperty ──────────────────────────────────────────────

    @Test
    @EnabledIfSystemProperty(named = "os.name", matches = ".*[Mm]ac.*")
    fun `enabled only when running on macOS (system property variant)`() {
        val osName = System.getProperty("os.name")
        assertTrue(osName.contains("Mac", ignoreCase = true), "Expected Mac, got: $osName")
    }

    @Test
    @EnabledIfSystemProperty(named = "java.vm.name", matches = ".*")
    fun `always enabled — any JVM name matches the wildcard`() {
        val vmName = System.getProperty("java.vm.name")
        assertNotNull(vmName)
    }

    @Test
    @EnabledIfSystemProperty(named = "kotlinJump.runSlowTests", matches = "true")
    fun `skipped unless -DkotlinJump_runSlowTests=true is passed to Gradle`() {
        // This test is skipped in normal runs; it documents a pattern for
        // gating expensive tests behind a system property flag.
        val storage = PokemonStorage()
        repeat(10_000) { i -> storage.save(Pokemon(i, "P$i", GRASS, 1, 10)) }
        assertEquals(10_000, storage.count())
        storage.clear()
    }

    // ── unconditional baseline — always runs, documents the OS at test time ───

    @Test
    fun `baseline — current OS and JVM info is accessible`() {
        val os  = System.getProperty("os.name")
        val jvm = System.getProperty("java.version")
        assertNotNull(os,  "os.name must be set")
        assertNotNull(jvm, "java.version must be set")
    }
}
