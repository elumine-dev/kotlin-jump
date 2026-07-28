package com.example.demo

import com.example.app.R

// ─────────────────────────────────────────────────────────────────────────────
// DÉMO : Tous les patterns R.drawable.* — couverture exhaustive
//
// Chaque R.drawable.xxx doit afficher un aperçu du drawable au hover
// et une miniature dans la gouttière.
// ─────────────────────────────────────────────────────────────────────────────

private fun setImageResource(@Suppress("UNUSED_PARAMETER") drawableRes: Int) = Unit
private fun setIcon(@Suppress("UNUSED_PARAMETER") drawableRes: Int) = Unit
private fun loadDrawable(@Suppress("UNUSED_PARAMETER") drawableRes: Int): Any? = null

// ── 1. Propriétés top-level ───────────────────────────────────────────────────

val APP_ICON       = R.drawable.ic_pokeball
val TYPE_FIRE      = R.drawable.ic_type_fire
val TYPE_WATER     = R.drawable.ic_type_water
val TYPE_GRASS     = R.drawable.ic_type_grass
val TYPE_ELECTRIC  = R.drawable.ic_type_electric

// ── 2. val / var locaux ───────────────────────────────────────────────────────

fun drawableLocal() {
    val pokeball = R.drawable.ic_pokeball
    var typeIcon = R.drawable.ic_type_fire
    typeIcon     = R.drawable.ic_type_water     // réassignation
    typeIcon     = R.drawable.ic_type_grass
    typeIcon     = R.drawable.ic_type_electric
    val typed: Int = R.drawable.ic_type_fire
}

// ── 3. Interpolation de chaîne ────────────────────────────────────────────────

fun drawableInterpolation() {
    val msg      = "Icône : ${R.drawable.ic_pokeball}"
    val both     = "${R.drawable.ic_pokeball} / ${R.drawable.ic_type_fire}"
    println("App icon ID : ${R.drawable.ic_pokeball}")
}

// ── 4. Argument de fonction ───────────────────────────────────────────────────

fun drawableFunctionArgs() {
    setImageResource(R.drawable.ic_pokeball)
    setIcon(R.drawable.ic_type_fire)
    loadDrawable(R.drawable.ic_pokeball)
}

// ── 5. Paramètres par défaut ──────────────────────────────────────────────────

fun showIcon(
    iconRes: Int     = R.drawable.ic_pokeball,
    fallback: Int    = R.drawable.ic_type_fire,
) = Unit

// ── 6. Valeur de retour ───────────────────────────────────────────────────────

fun getAppIcon(): Int      = R.drawable.ic_pokeball
fun getTypeIcon(): Int     = R.drawable.ic_type_fire

// ── 7. when ───────────────────────────────────────────────────────────────────

fun iconForType(type: String): Int = when (type) {
    "fire"    -> R.drawable.ic_type_fire
    "pokeball"-> R.drawable.ic_pokeball
    else      -> R.drawable.ic_pokeball
}

// ── 8. if / else ─────────────────────────────────────────────────────────────

fun iconForLevel(level: Int): Int =
    if (level >= 50) R.drawable.ic_pokeball else R.drawable.ic_type_fire

// ── 9. Elvis ─────────────────────────────────────────────────────────────────

fun resolveIcon(custom: Int?): Int = custom ?: R.drawable.ic_pokeball

// ── 10. Collections ───────────────────────────────────────────────────────────

val iconList = listOf(
    R.drawable.ic_pokeball,
    R.drawable.ic_type_fire,
)

val iconMap = mapOf(
    "app"  to R.drawable.ic_pokeball,
    "fire" to R.drawable.ic_type_fire,
)

// ── 11. Data class ────────────────────────────────────────────────────────────

data class DrawableConfig(
    val iconRes:     Int = R.drawable.ic_pokeball,
    val fallbackRes: Int = R.drawable.ic_type_fire,
)

// ── 12. Companion object ──────────────────────────────────────────────────────

class IconProvider {
    companion object {
        val DEFAULT = R.drawable.ic_pokeball
        val TYPE    = R.drawable.ic_type_fire
    }
}

// ── 13. Edge cases ────────────────────────────────────────────────────────────

fun drawableEdgeCases() {
    // Clé inconnue → pas de décoration (✗)
    val missing = R.drawable.this_drawable_does_not_exist

    // Plusieurs refs sur une même ligne
    println("${R.drawable.ic_pokeball} / ${R.drawable.ic_type_fire}")

    // Triple-quoted
    val multiline = """
        app  : ${R.drawable.ic_pokeball}
        type : ${R.drawable.ic_type_fire}
    """.trimIndent()
}
