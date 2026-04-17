package com.example.sprint2

import com.example.app.R

// ─────────────────────────────────────────────────────────────────────────────
// SPRINT 2 — Visual Feature Demo
//
// Ouvrir ce fichier dans VS Code avec l'extension Kotlin Jump active.
//
//  Feature 1 │ const val inline folding       → valeur affichée sur SCREAMING_CASE
//  Feature 2 │ suspend call marker ⚡          → ⚡ avant chaque appel suspend
//  Feature 3 │ R.color inline swatch ■        → ■ coloré avant chaque R.color.xxx
//  Feature 4 │ Missing resource diagnostic 🔴  → squiggle rouge sur clés inconnues
//  Feature 5 │ Version catalog hover          → ouvrir build.gradle.kts, hover libs.xxx
//  Feature 6 │ Override/implement gutter ⬆ ⬇  → CodeLens sur overrides/abstracts
// ─────────────────────────────────────────────────────────────────────────────

// ═════════════════════════════════════════════════════════════════════════════
// FEATURE 1 — const val inline folding
//
// Attendu  : chaque SCREAMING_SNAKE_CASE est remplacé par sa valeur littérale
// Exclus   : la ligne de déclaration const val elle-même (✗)
// ═════════════════════════════════════════════════════════════════════════════

object CatchConfig {
    const val MAX_ATTEMPTS       = 5
    const val SHINY_RATE         = 0.00012f
    const val POKEBALL_BASE_RATE = 0.255f
    const val GEN_ONE_LIMIT      = 151
    const val EVOLUTION_LEVEL    = 16
    const val TEAM_CAPACITY      = 6
    const val FRIENDSHIP_START   = 70
    const val ANIMATION_MS       = 300
    const val FEATURE_ENABLED    = true
    const val DEMO_TAG           = "Sprint2Demo"
}

// ── 1a. Affectations locales ──────────────────────────────────────────────────

fun constValLocalUsage() {
    val maxTries   = CatchConfig.MAX_ATTEMPTS       // → 5
    val shinyChance = CatchConfig.SHINY_RATE        // → 0.00012
    val genLimit   = CatchConfig.GEN_ONE_LIMIT      // → 151
    val evoMin     = CatchConfig.EVOLUTION_LEVEL    // → 16
    val teamMax    = CatchConfig.TEAM_CAPACITY      // → 6
    val animMs     = CatchConfig.ANIMATION_MS       // → 300
    val tag        = CatchConfig.DEMO_TAG           // → "Sprint2Demo"
    val enabled    = CatchConfig.FEATURE_ENABLED    // → true
}

// ── 1b. Paramètres par défaut ─────────────────────────────────────────────────

fun attemptCatch(
    maxAttempts: Int  = CatchConfig.MAX_ATTEMPTS,       // → 5
    catchRate: Float  = CatchConfig.POKEBALL_BASE_RATE, // → 0.255
    teamMax: Int      = CatchConfig.TEAM_CAPACITY,      // → 6
) = Unit

// ── 1c. Expressions when ──────────────────────────────────────────────────────

fun pokemonCategory(level: Int): String = when {
    level >= CatchConfig.GEN_ONE_LIMIT   -> "Legendary"  // → 151
    level >= CatchConfig.EVOLUTION_LEVEL -> "Evolved"    // → 16
    level >= CatchConfig.FRIENDSHIP_START -> "Friendly"  // → 70
    else                                 -> "Baby"
}

// ── 1d. Collections ───────────────────────────────────────────────────────────

val catchParams = mapOf(
    "maxAttempts" to CatchConfig.MAX_ATTEMPTS,        // → 5
    "teamCapacity" to CatchConfig.TEAM_CAPACITY,      // → 6
    "evolutionLevel" to CatchConfig.EVOLUTION_LEVEL,  // → 16
    "animationMs" to CatchConfig.ANIMATION_MS,        // → 300
)

// ── 1e. Interpolation ─────────────────────────────────────────────────────────

fun logCatchAttempt(attempt: Int) {
    println("[${CatchConfig.DEMO_TAG}] Attempt $attempt / ${CatchConfig.MAX_ATTEMPTS}")
    val msg = "Gen ${CatchConfig.GEN_ONE_LIMIT} limit, team ${CatchConfig.TEAM_CAPACITY}/6"
}

// ── 1f. Conditions ────────────────────────────────────────────────────────────

fun isTeamFull(size: Int): Boolean = size >= CatchConfig.TEAM_CAPACITY      // → 6
fun canEvolve(level: Int): Boolean = level >= CatchConfig.EVOLUTION_LEVEL   // → 16
fun isShiny(roll: Float): Boolean  = roll < CatchConfig.SHINY_RATE          // → 0.00012

// ═════════════════════════════════════════════════════════════════════════════
// FEATURE 2 — suspend call marker ⚡
//
// Attendu  : ⚡ inline avant chaque appel à une suspend fun
// Exclus   : les déclarations suspend fun elles-mêmes (✗)
//            les appels à des fonctions normales (✗)
// ═════════════════════════════════════════════════════════════════════════════

// ── Stubs suspend (indexés par Kotlin Jump) ───────────────────────────────────

suspend fun fetchPokedex(): List<String>      = emptyList()
suspend fun     loadPokemon(id: Int): String?     = null
suspend fun saveTeam(team: List<String>)      = Unit
suspend fun deleteFromTeam(id: Int)           = Unit
suspend fun syncWithServer()                  = Unit
suspend fun computeStats(data: List<Int>): Int = data.sum()
suspend fun waitFor(ms: Long)                 = Unit

// ── 2a. Appels dans une fonction suspend ─────────────────────────────────────

suspend fun runCatchWorkflow(id: Int): String? {
    syncWithServer()                             // ⚡
    val all    = fetchPokedex()                  // ⚡
    val target = loadPokemon(id)                 // ⚡
    waitFor(CatchConfig.ANIMATION_MS.toLong())   // ⚡  +  → 300
    if (target != null) saveTeam(listOf(target)) // ⚡
    return target
}

// ── 2b. Chaîne d'appels séquentiels ──────────────────────────────────────────

suspend fun teamSyncOrchestration(): List<String> {
    syncWithServer()                             // ⚡
    waitFor(50)                                  // ⚡
    val roster = fetchPokedex()                  // ⚡
    val stats  = computeStats(List(roster.size) { it }) // ⚡
    saveTeam(roster.take(CatchConfig.TEAM_CAPACITY))    // ⚡  +  → 6
    waitFor(CatchConfig.ANIMATION_MS.toLong())   // ⚡  +  → 300
    return roster
}

// ── 2c. Branchements conditionnels ───────────────────────────────────────────

suspend fun conditionalSync(force: Boolean) {
    if (force) {
        syncWithServer()                         // ⚡
        waitFor(100)                             // ⚡
    }
    val pokemon = loadPokemon(1)                 // ⚡
    if (pokemon != null) {
        saveTeam(listOf(pokemon))                // ⚡
    } else {
        deleteFromTeam(1)                        // ⚡
    }
}

// ── 2d. PAS de ⚡ — fonctions normales (✗) ────────────────────────────────────

fun nonSuspendUsage() {
    val x = listOf("Pikachu", "Charmander")     // (✗) pas de ⚡
    println("Team: $x")                         // (✗) pas de ⚡
    isTeamFull(x.size)                          // (✗) pas de ⚡
}

// ═════════════════════════════════════════════════════════════════════════════
// FEATURE 3 — R.color inline swatch ■
//
// Attendu  : ■ coloré inline avant chaque R.color.xxx résolu
// Exclus   : clés inconnues → aucune décoration (✗)
// ═════════════════════════════════════════════════════════════════════════════

// ── 3a. Couleurs de marque ────────────────────────────────────────────────────

val swatchPrimary     = R.color.primary       // ■ #7F52FF violet Kotlin
val swatchPrimaryDark = R.color.primary_dark  // ■ #5B3FBF violet foncé
val swatchPrimaryLight = R.color.primary_light // ■ #A87FFF violet clair
val swatchSecondary   = R.color.secondary     // ■ #FF5722 orange
val swatchError       = R.color.error         // ■ #B00020 rouge
val swatchSuccess     = R.color.success       // ■ #388E3C vert
val swatchWarning     = R.color.warning       // ■ #F57C00 orange avertissement
val swatchInfo        = R.color.info          // ■ #1976D2 bleu

// ── 3b. Palette type Pokémon ──────────────────────────────────────────────────

val colorFire     = R.color.type_fire      // ■ #FF4500
val colorWater    = R.color.type_water     // ■ #1E90FF
val colorGrass    = R.color.type_grass     // ■ #228B22
val colorElectric = R.color.type_electric  // ■ #FFD700
val colorPsychic  = R.color.type_psychic   // ■ #FF69B4
val colorDragon   = R.color.type_dragon    // ■ #6A0DAD

// ── 3c. Semi-transparent ──────────────────────────────────────────────────────

val colorScrim         = R.color.scrim              // ■ #66000000 (alpha)
val colorTransPrimary  = R.color.translucent_primary // ■ #807F52FF
val colorTransBlack    = R.color.translucent_black   // ■ #99000000

// ── 3d. Dans un when ─────────────────────────────────────────────────────────

fun hpBarColor(hp: Int, maxHp: Int): Int = when {
    hp * 100 / maxHp >= 50 -> R.color.success   // ■ vert
    hp * 100 / maxHp >= 20 -> R.color.warning   // ■ orange
    else                   -> R.color.error     // ■ rouge
}

fun typeToColor(type: String): Int = when (type) {
    "fire"     -> R.color.type_fire      // ■
    "water"    -> R.color.type_water     // ■
    "grass"    -> R.color.type_grass     // ■
    "electric" -> R.color.type_electric  // ■
    "psychic"  -> R.color.type_psychic   // ■
    "dragon"   -> R.color.type_dragon    // ■
    else       -> R.color.text_secondary // ■
}

// ── 3e. Plusieurs refs sur une ligne ─────────────────────────────────────────

fun multiColorLine() {
    println("${R.color.primary} / ${R.color.secondary} / ${R.color.error}")  // ■ ■ ■
    val pair = listOf(R.color.success, R.color.warning)  // ■ ■
}

// ── 3f. Clé inconnue — PAS de ■ (✗) ─────────────────────────────────────────

val unknownColorRef = R.color.sprint2_gradient_overlay  // (✗) clé inconnue

// ═════════════════════════════════════════════════════════════════════════════
// FEATURE 4 — Missing resource diagnostic 🔴
//
// Attendu  : squiggle rouge sous les clés inconnues (R.string.xxx / R.color.xxx)
//            Message au hover : "Unknown resource R.xxx.yyy"
// Existants : clés valides — aucun squiggle (✓)
// ═════════════════════════════════════════════════════════════════════════════

// ── 4a. R.color inconnus → squiggle rouge ─────────────────────────────────────

val diagMissingColor1 = R.color.sprint2_primary_gradient  // 🔴 inconnu
val diagMissingColor2 = R.color.sprint2_ripple_overlay    // 🔴 inconnu
val diagMissingColor3 = R.color.sprint2_divider_line      // 🔴 inconnu
val diagMissingColor4 = R.color.sprint2_shimmer_base      // 🔴 inconnu

// ── 4b. R.string inconnus → squiggle rouge ────────────────────────────────────

val diagMissingStr1 = R.string.sprint2_catch_dialog      // 🔴 inconnu
val diagMissingStr2 = R.string.sprint2_evolution_prompt  // 🔴 inconnu
val diagMissingStr3 = R.string.sprint2_sync_status       // 🔴 inconnu
val diagMissingStr4 = R.string.sprint2_team_saved_msg    // 🔴 inconnu

// ── 4c. Clés valides — aucun squiggle (✓) ────────────────────────────────────

val validStr   = R.string.app_name         // ✓ "Kotlin Jump Demo"
val validStr2  = R.string.error_network    // ✓ "Cannot reach server…"
val validStr3  = R.string.action_confirm   // ✓ "Confirm"
val validColor =  R.color.primary           // ✓ #7F52FF
val validColor2 = R.color.success          // ✓ #388E3C

// ═════════════════════════════════════════════════════════════════════════════
// FEATURE 5 — Version catalog hover
//
// Ouvrir build.gradle.kts (à la racine du projet).
// Placer le curseur sur n'importe quel libs.xxx → tooltip group:name:version
//
// Exemples dans build.gradle.kts :
//   libs.core.ktx            → androidx.core:core-ktx:1.12.0
//   libs.compose.ui          → androidx.compose.ui:ui:1.6.2
//   libs.retrofit.core       → com.squareup.retrofit2:retrofit:2.9.0
//   libs.hilt.android        → com.google.dagger:hilt-android:2.50
//   libs.room.runtime        → androidx.room:room-runtime:2.6.1
//   libs.coroutines.core     → org.jetbrains.kotlinx:kotlinx-coroutines-core:1.7.3
//   libs.mockk               → io.mockk:mockk:1.13.9
// ═════════════════════════════════════════════════════════════════════════════

// ═════════════════════════════════════════════════════════════════════════════
// FEATURE 6 — Override/implement gutter icons ⬆ ⬇
//
// Attendu  :
//   ⬇ N implementations  — CodeLens au-dessus d'une méthode abstract/interface
//   ⬆ overrides          — CodeLens au-dessus d'une méthode override
//
// Cliquer sur le CodeLens navigue vers la définition / les implémentations.
// ═════════════════════════════════════════════════════════════════════════════

// ── 6a. Interface → ⬇ N implementations ──────────────────────────────────────

interface PokemonDataSource {
    fun findById(id: Int): String?           // ⬇ 2 implementations
    fun findAll(): List<String>              // ⬇ 2 implementations
    suspend fun save(item: String)           // ⬇ 2 implementations
    suspend fun delete(id: Int)              // ⬇ 2 implementations
    fun count(): Int                         // ⬇ 2 implementations
}

interface CacheStore {
    fun get(key: String): String?            // ⬇ 1 implementation
    fun put(key: String, value: String)      // ⬇ 1 implementation
    fun invalidate()                         // ⬇ 1 implementation
}

// ── 6b. Classe abstraite → ⬇ N implementations ───────────────────────────────

abstract class BaseProcessor {
    abstract fun process(input: String): String        // ⬇ 2 implementations
    abstract fun validate(input: String): Boolean      // ⬇ 2 implementations
    abstract suspend fun processAsync(input: String): String  // ⬇ 2 implementations
}

// ── 6c. Implémentation 1 → ⬆ overrides ──────────────────────────────────────

class LocalDataSource : PokemonDataSource {
    override fun findById(id: Int): String? = "local-$id"        // ⬆ overrides
    override fun findAll(): List<String> = listOf("Bulbasaur")   // ⬆ overrides
    override suspend fun save(item: String) = Unit                // ⬆ overrides
    override suspend fun delete(id: Int) = Unit                   // ⬆ overrides
    override fun count(): Int = 1                                 // ⬆ overrides
}

class RemoteDataSource : PokemonDataSource {
    override fun findById(id: Int): String? = null                // ⬆ overrides
    override fun findAll(): List<String> = emptyList()            // ⬆ overrides
    override suspend fun save(item: String) = Unit                // ⬆ overrides
    override suspend fun delete(id: Int) = Unit                   // ⬆ overrides
    override fun count(): Int = 0                                 // ⬆ overrides
}

// ── 6d. Implémentation de la classe abstraite → ⬆ overrides ──────────────────

class CatchProcessor : BaseProcessor() {
    override fun process(input: String): String = "caught: $input"      // ⬆ overrides
    override fun validate(input: String): Boolean = input.isNotEmpty()  // ⬆ overrides
    override suspend fun processAsync(input: String): String {           // ⬆ overrides
        waitFor(CatchConfig.ANIMATION_MS.toLong())                       // ⚡  +  → 300
        return "async-caught: $input"
    }
}

class EvolveProcessor : BaseProcessor() {
    override fun process(input: String): String = "evolved: $input"     // ⬆ overrides
    override fun validate(input: String): Boolean = input.length > 2    // ⬆ overrides
    override suspend fun processAsync(input: String): String {           // ⬆ overrides
        waitFor(50)                                                      // ⚡
        return "async-evolved: $input"
    }
}

// ── 6e. Cache store → ⬆ overrides ────────────────────────────────────────────

class InMemoryCacheStore : CacheStore {
    private val store = mutableMapOf<String, String>()
    override fun get(key: String): String? = store[key]          // ⬆ overrides
    override fun put(key: String, value: String) { store[key] = value }  // ⬆ overrides
    override fun invalidate() = store.clear()                    // ⬆ overrides
}

// ── 6f. Combinaison ⚡ + ⬆ + const val ───────────────────────────────────────

class Sprint2Coordinator(
    private val source: PokemonDataSource,
    private val cache: CacheStore,
) {
    suspend fun loadWithCache(id: Int): String? {
        val cached = cache.get("pokemon-$id")  // (✗ non-suspend, pas de ⚡)
        if (cached != null) return cached

        syncWithServer()                       // ⚡
        waitFor(CatchConfig.ANIMATION_MS.toLong())  // ⚡  +  → 300
        val result = loadPokemon(id)           // ⚡
        if (result != null) cache.put("pokemon-$id", result)
        return result
    }

    suspend fun syncAll() {
        val all = fetchPokedex()               // ⚡
        val stats = computeStats(List(CatchConfig.TEAM_CAPACITY) { it })  // ⚡  +  → 6
        println("Synced ${all.size} items, stats=$stats")
    }
}
