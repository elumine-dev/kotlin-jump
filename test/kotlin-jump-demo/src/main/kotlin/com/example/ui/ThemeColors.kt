package com.example.ui

// Stub Color class — Android Color n'est pas disponible dans un projet JVM console
data class Color(val value: Int) {
    companion object {
        fun parseColor(hex: String): Color = Color(hex.hashCode())
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// DÉMO : Hex color literal swatch
//
// Chaque valeur hexadécimale de couleur doit afficher un ■ coloré inline.
// Formats supportés : #RGB, #ARGB, #RRGGBB, #AARRGGBB, 0xAARRGGBB
// Les cas (✗) ne doivent PAS afficher de ■.
// ─────────────────────────────────────────────────────────────────────────────

object ThemeColors {

    // ── Format 0xAARRGGBB (Kotlin/Android) ───────────────────────────────────
    val primary         = Color(0xFF7F52FF.toInt())   // ■ violet Kotlin
    val primaryDark     = Color(0xFF5B3FBF.toInt())   // ■ violet foncé
    val primaryLight    = Color(0xFFA87FFF.toInt())   // ■ violet clair
    val secondary       = Color(0xFFFF5722.toInt())   // ■ orange vif
    val secondaryDark   = Color(0xFFBF360C.toInt())   // ■ orange foncé
    val background      = Color(0xFFFFFFFF.toInt())   // ■ blanc
    val surface         = Color(0xFFF5F5F5.toInt())   // ■ gris très clair
    val onPrimary       = Color(0xFFFFFFFF.toInt())   // ■ blanc sur primary
    val error           = Color(0xFFB00020.toInt())   // ■ rouge erreur
    val success         = Color(0xFF388E3C.toInt())   // ■ vert succès
    val warning         = Color(0xFFF57C00.toInt())   // ■ orange avertissement

    // ── Semi-transparent (alpha < FF) ─────────────────────────────────────────
    val scrim           = Color(0x66000000.toInt())   // ■ noir semi-transparent
    val overlay         = Color(0x80000000.toInt())   // ■ overlay 50%
    val transparentPrimary = Color(0x807F52FF.toInt()) // ■ primary 50%

    // ── Format "#RRGGBB" string ────────────────────────────────────────────────
    val errorHex        = "#B00020"         // ■ rouge
    val successHex      = "#388E3C"         // ■ vert
    val surfaceHex      = "#F5F5F5"         // ■ gris clair
    val primaryHex      = "#7F52FF"         // ■ violet

    // ── Format "#AARRGGBB" string ─────────────────────────────────────────────
    val scrimHex        = "#66000000"       // ■ noir semi-transparent
    val transparentHex  = "#80FFFFFF"       // ■ blanc semi-transparent

    // ── Format "#RGB" shorthand ───────────────────────────────────────────────
    val redShort        = "#F00"            // ■ rouge
    val greenShort      = "#0F0"            // ■ vert
    val whiteShort      = "#FFF"            // ■ blanc
    val blackShort      = "#000"            // ■ noir

    // ── Format "#ARGB" shorthand ──────────────────────────────────────────────
    val semiWhiteShort  = "#8FFF"           // ■ blanc semi-transparent

    // ── Pokémon type colors ───────────────────────────────────────────────────
    val typeFire        = Color.parseColor("#FF4500")   // ■ rouge-orange
    val typeWater       = Color.parseColor("#1E90FF")   // ■ bleu
    val typeGrass       = Color.parseColor("#228B22")   // ■ vert forêt
    val typeElectric    = Color.parseColor("#FFD700")   // ■ jaune or
    val typePsychic     = Color.parseColor("#FF69B4")   // ■ rose
    val typeDragon      = Color.parseColor("#6A0DAD")   // ■ violet foncé

    // ── Cas NON colorés (✗) ───────────────────────────────────────────────────
    val notAColor       = "not-a-color-string"          // (✗) pas un hex
    val tooShort        = "#FF"                          // (✗) trop court
    val tooLong         = "#RRGGBBAA1234"               // (✗) trop long
    val notHex          = "#GGHHII"                     // (✗) caractères invalides
    // val inComment    = 0xDEADBEEF                    // (✗) dans un commentaire
    val plainInt        = 0x001234                      // (✗) pas préfixé 0xFF
}

// ── Utilisations dans des fonctions ──────────────────────────────────────────

fun applyTheme(isDark: Boolean) {
    val bg      = if (isDark) "#212121" else "#FFFFFF"
    val text    = if (isDark) "#FFFFFF" else "#212121"
    val accent  = if (isDark) "#A87FFF" else "#7F52FF"
    println("bg=$bg text=$text accent=$accent")
}

fun typeColorHex(type: String): String = when (type) {
    "fire"     -> "#FF4500"
    "water"    -> "#1E90FF"
    "grass"    -> "#228B22"
    "electric" -> "#FFD700"
    "psychic"  -> "#FF69B4"
    "dragon"   -> "#6A0DAD"
    else       -> "#9E9E9E"
}

fun interpolation() {
    val hex1 = "Color 1: ${"#7F52FF"}"
    val hex2 = "Primary=${ThemeColors.primaryHex} Error=${ThemeColors.errorHex}"
    println("Surface: ${ThemeColors.surfaceHex}, Scrim: ${ThemeColors.scrimHex}")
}

data class ColorPalette(
    val primary: String   = "#7F52FF",
    val secondary: String = "#FF5722",
    val background: String = "#FFFFFF",
    val error: String     = "#B00020",
)

val lightPalette = ColorPalette(
    primary    = "#7F52FF",
    secondary  = "#FF5722",
    background = "#FFFFFF",
    error      = "#B00020",
)

val darkPalette = ColorPalette(
    primary    = "#A87FFF",
    secondary  = "#FF8A65",
    background = "#121212",
    error      = "#CF6679",
)
