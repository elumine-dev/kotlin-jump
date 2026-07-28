package com.example.demo

import com.example.app.R

// ─────────────────────────────────────────────────────────────────────────────
// DÉMO : Tous les patterns R.dimen.* — couverture exhaustive
//
// Chaque R.dimen.xxx doit afficher sa valeur dp/sp inline.
// ─────────────────────────────────────────────────────────────────────────────

private fun setMargin(@Suppress("UNUSED_PARAMETER") dimenRes: Int) = Unit
private fun setPadding(@Suppress("UNUSED_PARAMETER") dimenRes: Int) = Unit
private fun setTextSize(@Suppress("UNUSED_PARAMETER") dimenRes: Int) = Unit
private fun setSize(@Suppress("UNUSED_PARAMETER") w: Int, @Suppress("UNUSED_PARAMETER") h: Int) = Unit
private fun setCornerRadius(@Suppress("UNUSED_PARAMETER") dimenRes: Int) = Unit

// ── 1. Propriétés top-level ───────────────────────────────────────────────────

val DEFAULT_PADDING  = R.dimen.spacing_md
val DEFAULT_MARGIN   = R.dimen.spacing_lg
val DEFAULT_TEXT     = R.dimen.text_size_body

// ── 2. val / var locaux ───────────────────────────────────────────────────────

fun dimenLocal() {
    val paddingXs  = R.dimen.spacing_xs
    val paddingSm  = R.dimen.spacing_sm
    val paddingMd  = R.dimen.spacing_md
    val paddingLg  = R.dimen.spacing_lg
    val paddingXl  = R.dimen.spacing_xl
    val bodyText   = R.dimen.text_size_body
    val titleText  = R.dimen.text_size_title
    val radius     = R.dimen.card_corner_radius
}

// ── 3. Interpolation de chaîne ────────────────────────────────────────────────

fun dimenInterpolation() {
    val msg     = "Padding: ${R.dimen.spacing_md}, Margin: ${R.dimen.spacing_lg}"
    val sizes   = "Body: ${R.dimen.text_size_body}sp, Title: ${R.dimen.text_size_title}sp"
    val layout  = "Card ${R.dimen.pokemon_card_width}×${R.dimen.pokemon_card_height}"
    println("Spacing xl = ${R.dimen.spacing_xl}")
}

// ── 4. Argument de fonction ───────────────────────────────────────────────────

fun dimenFunctionArgs() {
    setPadding(R.dimen.spacing_md)
    setMargin(R.dimen.spacing_lg)
    setTextSize(R.dimen.text_size_body)
    setCornerRadius(R.dimen.card_corner_radius)
    setSize(R.dimen.pokemon_card_width, R.dimen.pokemon_card_height)
}

// ── 5. Paramètres par défaut ──────────────────────────────────────────────────

fun buildCard(
    paddingRes:  Int = R.dimen.spacing_md,
    marginRes:   Int = R.dimen.spacing_lg,
    radiusRes:   Int = R.dimen.card_corner_radius,
    elevRes:     Int = R.dimen.card_elevation,
) = Unit

fun buildText(
    sizeRes:     Int = R.dimen.text_size_body,
    paddingRes:  Int = R.dimen.spacing_sm,
) = Unit

// ── 6. Valeur de retour ───────────────────────────────────────────────────────

fun getBodyTextSize(): Int    = R.dimen.text_size_body
fun getTitleTextSize(): Int   = R.dimen.text_size_title
fun getCardRadius(): Int      = R.dimen.card_corner_radius
fun getButtonHeight(): Int    = R.dimen.button_height

// ── 7. when ───────────────────────────────────────────────────────────────────

fun spacingForSize(size: String): Int = when (size) {
    "xs"  -> R.dimen.spacing_xs
    "sm"  -> R.dimen.spacing_sm
    "md"  -> R.dimen.spacing_md
    "lg"  -> R.dimen.spacing_lg
    "xl"  -> R.dimen.spacing_xl
    "xxl" -> R.dimen.spacing_xxl
    else  -> R.dimen.spacing_md
}

fun iconSizeRes(level: Int): Int = when {
    level >= 3 -> R.dimen.icon_size_lg
    level >= 2 -> R.dimen.icon_size_md
    else       -> R.dimen.icon_size_sm
}

// ── 8. Collections ────────────────────────────────────────────────────────────

val spacingScale = listOf(
    R.dimen.spacing_xs,
    R.dimen.spacing_sm,
    R.dimen.spacing_md,
    R.dimen.spacing_lg,
    R.dimen.spacing_xl,
    R.dimen.spacing_xxl,
)

val textSizeScale = listOf(
    R.dimen.text_size_caption,
    R.dimen.text_size_body,
    R.dimen.text_size_body_large,
    R.dimen.text_size_title,
    R.dimen.text_size_headline,
    R.dimen.text_size_display,
)

val iconSizes = mapOf(
    "sm" to R.dimen.icon_size_sm,
    "md" to R.dimen.icon_size_md,
    "lg" to R.dimen.icon_size_lg,
    "xl" to R.dimen.icon_size_xl,
)

// ── 9. Sealed class ───────────────────────────────────────────────────────────

sealed class ComponentSize(val padding: Int, val textSize: Int, val iconSize: Int) {
    object Small  : ComponentSize(R.dimen.spacing_xs, R.dimen.text_size_caption, R.dimen.icon_size_sm)
    object Medium : ComponentSize(R.dimen.spacing_md, R.dimen.text_size_body,    R.dimen.icon_size_md)
    object Large  : ComponentSize(R.dimen.spacing_lg, R.dimen.text_size_title,   R.dimen.icon_size_lg)
}

// ── 10. Data class ────────────────────────────────────────────────────────────

data class LayoutConfig(
    val paddingRes: Int = R.dimen.spacing_md,
    val marginRes:  Int = R.dimen.spacing_lg,
    val textRes:    Int = R.dimen.text_size_body,
    val radiusRes:  Int = R.dimen.card_corner_radius,
    val buttonRes:  Int = R.dimen.button_height,
)

// ── 11. Companion object ──────────────────────────────────────────────────────

class CardView {
    companion object {
        val PADDING   = R.dimen.spacing_md
        val MARGIN    = R.dimen.spacing_lg
        val RADIUS    = R.dimen.card_corner_radius
        val ELEVATION = R.dimen.card_elevation
        val WIDTH     = R.dimen.pokemon_card_width
        val HEIGHT    = R.dimen.pokemon_card_height
    }
}

// ── 12. Edge cases ────────────────────────────────────────────────────────────

fun dimenEdgeCases() {
    // Plusieurs refs sur une même ligne
    println("${R.dimen.spacing_xs} / ${R.dimen.spacing_md} / ${R.dimen.spacing_xl}")

    // Triple-quoted
    val multiline = """
        padding : ${R.dimen.spacing_md}
        margin  : ${R.dimen.spacing_lg}
        text    : ${R.dimen.text_size_body}
    """.trimIndent()

    // Clé inconnue → pas de décoration (✗)
    val missing = R.dimen.this_dimen_does_not_exist
}
