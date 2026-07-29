@file:Suppress("unused") // demo fixture: declarations showcase other features

package com.example.demo

import com.example.app.R
import com.example.data.PokemonType

// ─────────────────────────────────────────────────────────────────────────────
// DÉMO : Tous les patterns R.color.* — couverture exhaustive
//
// Chaque R.color.xxx doit afficher un ■ coloré inline.
// Les cas (✗) ne doivent PAS afficher de décoration.
// ─────────────────────────────────────────────────────────────────────────────

private fun setBackgroundColor(@Suppress("UNUSED_PARAMETER") colorRes: Int) = Unit
private fun setTextColor(@Suppress("UNUSED_PARAMETER") colorRes: Int) = Unit
private fun setTint(@Suppress("UNUSED_PARAMETER") colorRes: Int) = Unit
private fun applyColors(vararg colors: Int) = Unit

// ── 1. Propriétés top-level ───────────────────────────────────────────────────

val BRAND_PRIMARY   = R.color.primary
val BRAND_SECONDARY = R.color.secondary
val BRAND_ERROR     = R.color.error

// ── 2. val / var locaux ───────────────────────────────────────────────────────

fun colorLocal() {
    val bg        = R.color.background
    var text      = R.color.text_primary
    text          = R.color.text_secondary       // réassignation
    val typed: Int = R.color.surface
    val hint      = R.color.text_hint
}

// ── 3. Interpolation de chaîne ────────────────────────────────────────────────

fun colorInterpolation() {
    val single   = "Background : ${R.color.background}"
    val double   = "${R.color.primary} / ${R.color.primary_dark}"
    val triple   = "Primary: ${R.color.primary}, Error: ${R.color.error}, Success: ${R.color.success}"
    println("Couleur de surface : ${R.color.surface}")
}

// ── 4. Argument de fonction (direct) ─────────────────────────────────────────

fun colorFunctionArgs() {
    setBackgroundColor(R.color.background)
    setTextColor(R.color.text_primary)
    setTint(R.color.primary)
    setBackgroundColor(R.color.error)
    setTextColor(R.color.on_primary)
}

// ── 5. Plusieurs R.color sur un même appel ────────────────────────────────────

fun colorMultiArg() {
    applyColors(R.color.primary, R.color.secondary, R.color.error)
    applyColors(
        R.color.text_primary,
        R.color.text_secondary,
        R.color.text_hint,
        R.color.surface,
    )
}

// ── 6. Paramètres par défaut ──────────────────────────────────────────────────

fun showWithColor(
    backgroundRes: Int = R.color.background,
    textColorRes: Int  = R.color.text_primary,
    accentRes: Int     = R.color.primary,
) = Unit

@Suppress("unused")
private fun showColorError(colorRes: Int = R.color.error) = setBackgroundColor(colorRes)

// ── 7. Valeur de retour ───────────────────────────────────────────────────────

fun getPrimaryColor(): Int = R.color.primary
fun getErrorColor(): Int   = R.color.error
fun getSurfaceColor(): Int = R.color.surface

// ── 8. Propriété avec getter calculé ─────────────────────────────────────────

val backgroundColorRes: Int get() = R.color.background
val errorColorRes: Int      get() = R.color.error
val dynamicColor: Int       get() = if (true) R.color.primary else R.color.secondary

// ── 9. Propriété lazy ─────────────────────────────────────────────────────────

val lazyPrimary by lazy { R.color.primary }
val lazyColorError by lazy { R.color.error }
val lazySurface by lazy { R.color.surface }

// ── 10. if / else ─────────────────────────────────────────────────────────────

fun stateColor(isError: Boolean): Int =
    if (isError) R.color.error else R.color.success

fun levelColor(level: Int): Int =
    if (level >= 50)      R.color.success
    else if (level >= 20) R.color.warning
    else                  R.color.error

// ── 11. Opérateur Elvis ───────────────────────────────────────────────────────

fun resolveColor(custom: Int?): Int = custom ?: R.color.primary
fun resolveTextColor(a: Int?, b: Int?): Int = a ?: b ?: R.color.text_primary

// ── 12. when — enum exhaustif ─────────────────────────────────────────────────

fun typeColor(type: PokemonType): Int = when (type) {
    PokemonType.FIRE     -> R.color.type_fire
    PokemonType.WATER    -> R.color.type_water
    PokemonType.GRASS    -> R.color.type_grass
    PokemonType.ELECTRIC -> R.color.type_electric
    PokemonType.PSYCHIC  -> R.color.type_psychic
    PokemonType.DRAGON   -> R.color.type_dragon
}

// ── 13. when — conditions booléennes ─────────────────────────────────────────

fun guardedColor(value: Int): Int = when {
    value >= 80 -> R.color.success
    value >= 50 -> R.color.warning
    value >= 20 -> R.color.info
    else        -> R.color.error
}

// ── 14. Collections ───────────────────────────────────────────────────────────

val statusColors = listOf(
    R.color.success,
    R.color.warning,
    R.color.error,
    R.color.info,
)

val typeColorMap = mapOf(
    "fire"     to R.color.type_fire,
    "water"    to R.color.type_water,
    "grass"    to R.color.type_grass,
    "electric" to R.color.type_electric,
    "psychic"  to R.color.type_psychic,
    "dragon"   to R.color.type_dragon,
)

val brandPalette = setOf(
    R.color.primary,
    R.color.primary_dark,
    R.color.primary_light,
    R.color.secondary,
)

// ── 15. Sealed class avec R.color dans le constructeur ───────────────────────

sealed class ColorTheme(val bg: Int, val text: Int, val accent: Int) {
    object Light : ColorTheme(R.color.background, R.color.text_primary, R.color.primary)
    object Dark  : ColorTheme(R.color.on_surface,  R.color.on_primary,   R.color.primary_light)
    object Error : ColorTheme(R.color.error,        R.color.on_primary,   R.color.warning)
}

// ── 16. Data class ────────────────────────────────────────────────────────────

data class ColorConfig(
    val primaryRes:    Int = R.color.primary,
    val secondaryRes:  Int = R.color.secondary,
    val backgroundRes: Int = R.color.background,
    val errorRes:      Int = R.color.error,
    val textRes:       Int = R.color.text_primary,
)

// ── 17. Companion object ──────────────────────────────────────────────────────

class BrandColors {
    companion object {
        val PRIMARY   = R.color.primary
        val SECONDARY = R.color.secondary
        val ERROR     = R.color.error
        val SUCCESS   = R.color.success
        val WARNING   = R.color.warning
    }
}

// ── 18. Lambda / fonctions d'ordre supérieur ──────────────────────────────────

fun colorHigherOrder() {
    val getColor: () -> Int = { R.color.primary }
    val resolve: (Boolean) -> Int = { ok ->
        if (ok) R.color.success else R.color.error
    }
    val mapped = listOf(1, 2, 3).map { R.color.text_secondary }
    val filtered = statusColors.filter { it == R.color.error }
}

// ── 19. Scope functions ───────────────────────────────────────────────────────

fun colorScopeFns() {
    val c1 = run { R.color.primary }
    val c2 = R.color.error.also { setBackgroundColor(it) }
    val c3 = R.color.success.let { setTextColor(it) }
    val c4 = R.color.warning.takeIf { it > 0 } ?: R.color.error
}

// ── 20. Edge cases ────────────────────────────────────────────────────────────

fun colorEdgeCases() {
    // Deux refs adjacentes dans la même interpolation
    val adjacent = "${R.color.primary}${R.color.secondary}"

    // Triple-quoted
    val multiline = """
        primary  : ${R.color.primary}
        error    : ${R.color.error}
        surface  : ${R.color.surface}
    """.trimIndent()

    // Clé inconnue → pas de décoration (✗)
    val missing = R.color.this_color_does_not_exist

    // Plusieurs refs sur une même ligne
    println("${R.color.primary} / ${R.color.secondary} / ${R.color.error}")
}
