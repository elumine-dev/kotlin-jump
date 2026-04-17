package com.example.demo

// Stubs UI — non disponibles dans un projet JVM console
private fun Text(text: String) = Unit
private fun setText(text: String) = Unit
private fun setTitle(text: String) = Unit
private fun setHint(text: String) = Unit
private fun showToast(text: String) = Unit
private fun showSnackbar(text: String) = Unit
private fun setContentDescription(text: String) = Unit
private fun setLabel(text: String) = Unit
private fun setError(text: String) = Unit
private fun setPlaceholder(text: String) = Unit

// Stub Android Log
private object android {
    object util {
        object Log {
            fun d(tag: String, msg: String) = Unit
            fun e(tag: String, msg: String) = Unit
            fun i(tag: String, msg: String) = Unit
            fun w(tag: String, msg: String) = Unit
        }
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// DÉMO : Hardcoded string lint
//
// ⚠ VRAIS POSITIFS : strings codées en dur dans des appels UI → doit avertir
// ✓ FAUX POSITIFS  : strings non-UI (logs, URLs, IDs techniques) → ne pas avertir
// ─────────────────────────────────────────────────────────────────────────────

// ── VRAIS POSITIFS — fonctions UI ────────────────────────────────────────────

fun uiStrings() {
    // Compose
    Text("Battle!")                    // ⚠ Hardcoded string
    Text("Loading Pokémon…")           // ⚠ Hardcoded string
    Text("Catch!")                     // ⚠ Hardcoded string
    Text("Pokédex")                    // ⚠ Hardcoded string

    // View system
    setText("Click me")               // ⚠ Hardcoded string
    setText("Pokémon not found")      // ⚠ Hardcoded string
    setTitle("My screen")             // ⚠ Hardcoded string
    setTitle("Battle screen")         // ⚠ Hardcoded string
    setHint("Enter name…")            // ⚠ Hardcoded string
    setHint("Search Pokémon")         // ⚠ Hardcoded string
    showToast("Success!")             // ⚠ Hardcoded string
    showToast("Error occurred")       // ⚠ Hardcoded string
    showSnackbar("Team is full")      // ⚠ Hardcoded string
    setContentDescription("Camera")  // ⚠ Hardcoded string
    setLabel("Username")              // ⚠ Hardcoded string
    setError("Invalid input")         // ⚠ Hardcoded string
    setPlaceholder("Type here…")      // ⚠ Hardcoded string
}

// ── FAUX POSITIFS — logs ──────────────────────────────────────────────────────

fun logStrings() {
    println("Loading...")                              // ✓ log
    println("Error: connection failed")                // ✓ log
    android.util.Log.d("TAG", "Debug message")        // ✓ log
    android.util.Log.e("TAG", "Error occurred")       // ✓ log
    android.util.Log.i("Pokemon", "Fetching data…")   // ✓ log
    android.util.Log.w("Battle", "Low HP warning")    // ✓ log
}

// ── FAUX POSITIFS — assertions et exceptions ──────────────────────────────────

fun assertionStrings() {
    require(true) { "Name must not be blank" }         // ✓ assertion
    check(true) { "State must be initialized" }        // ✓ assertion
    error("This should never happen")                  // ✓ exception
    throw IllegalArgumentException("Invalid ID")       // ✓ exception
    throw IllegalStateException("Not initialized")     // ✓ exception
}

// ── FAUX POSITIFS — identifiants et clés techniques ──────────────────────────

fun technicalStrings() {
    val id         = "pokemon_key_001"             // ✓ identifiant technique
    val tag        = "POKEMON_TAG"                 // ✓ tag
    val channel    = "battle_notifications"        // ✓ ID de canal
    val pref       = "user_prefs"                  // ✓ clé de préférences
    val argKey     = "extra_pokemon_id"            // ✓ clé d'Intent
    val mimetype   = "application/json"            // ✓ MIME type
    val authority  = "com.example.provider"        // ✓ content authority
    val format     = "%d Pokémon"                  // ✓ format string
    val dateFormat = "yyyy-MM-dd"                  // ✓ format date
    val regex      = "[a-zA-Z]+"                   // ✓ pattern regex
}

// ── FAUX POSITIFS — URLs et chemins ──────────────────────────────────────────

fun urlStrings() {
    val apiBase  = "https://api.example.com/v2"    // ✓ URL
    val imageUrl = "https://cdn.example.com/img/"  // ✓ URL
    val scheme   = "content://"                    // ✓ scheme
    val path     = "/api/v2/pokemon"               // ✓ chemin
    val endpoint = "/pokemon/{id}"                 // ✓ template d'URL
}

// ── FAUX POSITIFS — tests ─────────────────────────────────────────────────────

fun testStrings() {
    // Ces strings seraient dans des tests — pas de warning attendu
    val expected = "Pikachu"
    val actual   = "Pikachu"
    assert(expected == actual) { "Expected $expected but was $actual" }
}

// ── CAS LIMITES ────────────────────────────────────────────────────────────────

fun hardcodedEdgeCases() {
    // String vide → pas de warning
    setText("")
    Text("")

    // String avec variable → difficile à analyser
    val name = "Pikachu"
    Text(name)                     // ✓ variable, pas littéral

    // String concaténée
    val greeting = "Hello, " + "trainer!"
    Text(greeting)                 // ✓ variable

    // Interpolation
    val level = 25
    Text("Level $level")           // ⚠ potentiellement hardcoded
}
