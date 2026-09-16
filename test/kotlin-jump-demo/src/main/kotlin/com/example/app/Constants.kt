package com.example.app

// ─────────────────────────────────────────────────────────────────────────────
// DÉMO : const val inline value folding
//
// Chaque const val doit afficher sa valeur littérale inline à l'endroit où
// elle est référencée, comme `StringFoldingProvider` le fait pour R.string.
// ─────────────────────────────────────────────────────────────────────────────

object Constants {

    // ── Types primitifs ───────────────────────────────────────────────────────
    const val TIMEOUT_MS         = 5000
    const val MAX_RETRIES        = 3
    const val PAGE_SIZE          = 20
    const val MAX_TEAM_SIZE      = 6
    const val LEVEL_CAP          = 100
    const val BASE_XP_MULTIPLIER = 1.5f
    const val ENABLE_ANALYTICS   = true
    const val DEBUG_MODE         = false
    const val API_VERSION        = "v2"
    const val BASE_URL_PATH      = "/api/v2/pokemon"
    const val CACHE_SUFFIX       = ".cache"
    const val LOG_TAG            = "KotlinJumpDemo"
    const val MAX_POKEMON_ID     = 151L
    const val BATTLE_ROUND_LIMIT = 50
}

// ── 1. Affectations locales ───────────────────────────────────────────────────

fun localUsage() {
    val timeout  = Constants.TIMEOUT_MS         // → 5000
    val retries  = Constants.MAX_RETRIES        // → 3
    val pageSize = Constants.PAGE_SIZE          // → 20
    val version  = Constants.API_VERSION        // → "v2"
    val debug    = Constants.DEBUG_MODE         // → false
    val tag      = Constants.LOG_TAG            // → "KotlinJumpDemo"
}

// ── 2. Interpolation de chaîne ────────────────────────────────────────────────

fun interpolation() {
    val msg      = "Timeout après ${Constants.TIMEOUT_MS}ms"
    val url      = "https://api.example.com${Constants.BASE_URL_PATH}"
    val fullTag  = "${Constants.LOG_TAG}:Debug"
    val combined = "Retry ${Constants.MAX_RETRIES}× / ${Constants.PAGE_SIZE} items"
    println("Niveau max : ${Constants.LEVEL_CAP}, XP ×${Constants.BASE_XP_MULTIPLIER}")
}

// ── 3. Paramètre par défaut ───────────────────────────────────────────────────

fun fetchWithTimeout(
    timeoutMs: Int   = Constants.TIMEOUT_MS,
    maxRetries: Int  = Constants.MAX_RETRIES,
    pageSize: Int    = Constants.PAGE_SIZE,
) = Unit

fun buildUrl(basePath: String = Constants.BASE_URL_PATH) = "https://api.example.com$basePath"

// ── 4. when expression ────────────────────────────────────────────────────────

fun describeLevel(level: Int): String = when {
    level >= Constants.LEVEL_CAP    -> "Max level!"
    level >= Constants.MAX_TEAM_SIZE -> "Strong"
    level >= Constants.MAX_RETRIES  -> "Growing"
    else                             -> "Beginner"
}

// ── 5. Collections ────────────────────────────────────────────────────────────

val retryDelays = listOf(
    Constants.TIMEOUT_MS,
    Constants.TIMEOUT_MS * 2,
    Constants.TIMEOUT_MS * 4,
)

val configMap = mapOf(
    "timeout"   to Constants.TIMEOUT_MS,
    "retries"   to Constants.MAX_RETRIES,
    "pageSize"  to Constants.PAGE_SIZE,
    "teamSize"  to Constants.MAX_TEAM_SIZE,
)

// ── 6. Valeur de retour ───────────────────────────────────────────────────────

fun getTimeout(): Int = Constants.TIMEOUT_MS
fun getApiVersion(): String = Constants.API_VERSION
fun getPageSize(): Int = Constants.PAGE_SIZE

// ── 7. Lambda / higher order ──────────────────────────────────────────────────

fun higherOrder() {
    val getTimeout: () -> Int = { Constants.TIMEOUT_MS }
    val levels = (1..10).filter { it <= Constants.MAX_RETRIES }
    val mapped = listOf(1, 2, 3).map { it * Constants.PAGE_SIZE }
}

// ── 8. Conditions ─────────────────────────────────────────────────────────────

fun isOverLimit(count: Int): Boolean = count > Constants.MAX_TEAM_SIZE
fun shouldRetry(attempt: Int): Boolean = attempt < Constants.MAX_RETRIES && !Constants.DEBUG_MODE
fun isMaxLevel(level: Int): Boolean = level >= Constants.LEVEL_CAP

// ── 9. Data class avec const par défaut ───────────────────────────────────────

data class PaginationConfig(
    val pageSize: Int   = Constants.PAGE_SIZE,
    val timeout: Int    = Constants.TIMEOUT_MS,
    val maxRetries: Int = Constants.MAX_RETRIES,
)

data class BattleConfig(
    val roundLimit: Int  = Constants.BATTLE_ROUND_LIMIT,
    val levelCap: Int    = Constants.LEVEL_CAP,
    val teamSize: Int    = Constants.MAX_TEAM_SIZE,
)

// ── 10. Companion object ──────────────────────────────────────────────────────

class ApiClient {
    companion object {
        val DEFAULT_TIMEOUT  = Constants.TIMEOUT_MS
        val DEFAULT_RETRIES  = Constants.MAX_RETRIES
        val DEFAULT_VERSION  = Constants.API_VERSION
    }
}

// ── 11. Scope functions ───────────────────────────────────────────────────────

fun scopeUsage() {
    val t = run { Constants.TIMEOUT_MS }
    val v = Constants.API_VERSION.also { println("Version: $it") }
    val r = Constants.MAX_RETRIES.let { it * 2 }
    val s = Constants.PAGE_SIZE.takeIf { it > 0 } ?: Constants.MAX_RETRIES
}

// ── 12. Opérateur arithmétique ────────────────────────────────────────────────

fun calculations() {
    val totalMs     = Constants.TIMEOUT_MS * Constants.MAX_RETRIES
    val halfPage    = Constants.PAGE_SIZE / 2
    val effectiveXp = Constants.BASE_XP_MULTIPLIER * Constants.LEVEL_CAP
    val maxItems    = Constants.MAX_TEAM_SIZE * Constants.PAGE_SIZE
}
