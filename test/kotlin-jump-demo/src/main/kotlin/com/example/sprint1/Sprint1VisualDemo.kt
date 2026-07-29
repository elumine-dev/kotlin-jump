@file:Suppress("unused") // demo fixture: declarations showcase other features

package com.example.sprint1

import com.example.app.R

// ─────────────────────────────────────────────────────────────────────────────
// SPRINT 1 — Visual Feature Demo
//
// Ouvrir ce fichier pour tester visuellement les 6 fonctionnalités du Sprint 1.
//
//  Feature 1 │ !! non-null assertion highlight       → amber/orange sur !!
//  Feature 2 │ Hex color literal swatch             → ■ inline sur chaque hex
//  Feature 3 │ @RequiresApi human-readable level     → hint "Android X.Y Nom"
//  Feature 4 │ Format string preview in hover        → hover R.string.xxx = %s/%d anno
//  Feature 5 │ R.plurals.* + R.array.* folding/hover → overlay valeur inline
//  Feature 6 │ Translation completeness in hover     → grille ✓/✗ par locale
// ─────────────────────────────────────────────────────────────────────────────

// ── Stubs Android (non disponible dans un projet JVM console) ─────────────────

annotation class SuppressLint(vararg val value: String)
annotation class RequiresApi(val value: Int = 1, val api: Int = 1)

object Build {
    object VERSION { val SDK_INT: Int = 33 }
    object VERSION_CODES {
        const val LOLLIPOP          = 21
        const val LOLLIPOP_MR1      = 22
        const val M                 = 23
        const val N                 = 24
        const val N_MR1             = 25
        const val O                 = 26
        const val O_MR1             = 27
        const val P                 = 28
        const val Q                 = 29
        const val R                 = 30
        const val S                 = 31
        const val S_V2              = 32
        const val TIRAMISU          = 33
        const val UPSIDE_DOWN_CAKE  = 34
        const val VANILLA_ICE_CREAM = 35
    }
}

data class Color(val argb: Int) {
    companion object {
        fun parseColor(hex: String): Color = Color(hex.hashCode())
    }
}

data class Sprint1Pokemon(val id: Int, val name: String, val level: Int, val hp: Int = 100)
data class PokemonMove(val name: String, val pp: Int, val maxPp: Int)
data class Node(val value: Int, val next: Node?)

// ═════════════════════════════════════════════════════════════════════════════
// FEATURE 1 — !! non-null assertion highlight
//
// Attendu  : chaque !! est surligné en amber/orange
// Exclus   : !! dans un commentaire ou string → NE PAS surligner (✗)
// ═════════════════════════════════════════════════════════════════════════════

// ── 1a. Une seule !! par expression ──────────────────────────────────────────

fun f1aGetName(p: Sprint1Pokemon?): String    = p!!.name
fun f1aGetLevel(p: Sprint1Pokemon?): Int      = p!!.level
fun f1aGetHp(p: Sprint1Pokemon?): Int         = p!!.hp
fun f1aFirst(list: List<Sprint1Pokemon>?): Sprint1Pokemon = list!!.first()
fun f1aSize(list: List<Sprint1Pokemon>?): Int = list!!.size
fun f1aMove(m: PokemonMove?): String          = m!!.name

// ── 1b. Deux !! sur la même ligne ────────────────────────────────────────────

fun f1bNameUpper(p: Sprint1Pokemon?): String   = p!!.name.uppercase()
fun f1bEmailAndName(p: Sprint1Pokemon?, q: Sprint1Pokemon?): String = "${p!!.name} / ${q!!.name}"
fun f1bChained(n: Node?): Int                  = n!!.next!!.value
fun f1bDeepChain(n: Node?): Int                = n!!.next!!.next!!.value

// ── 1c. Affectations locales ──────────────────────────────────────────────────

fun f1cAssignments(p: Sprint1Pokemon?, list: List<Sprint1Pokemon>?) {
    val name   = p!!.name
    val level  = p!!.level
    val first  = list!!.first()
    val count  = list!!.size
    val move   = list!!.firstOrNull { it.level > 50 }
    var backup = p!!.hp
    backup     = p!!.level
}

// ── 1d. !! dans des conditions ────────────────────────────────────────────────

fun f1dConditions(p: Sprint1Pokemon?, list: List<Sprint1Pokemon>?) {
    if (p!!.level > 50)                println("strong")
    if (p!!.hp > 0 && list!!.isNotEmpty()) println("alive in team")
    val isElite   = p!!.level >= 80
    val teamReady = list!!.size == 6
    val hasFainted = p!!.hp <= 0 || list!!.all { it.hp <= 0 }
}

// ── 1e. !! dans des lambdas ───────────────────────────────────────────────────

fun f1eLambdas(list: List<Sprint1Pokemon>?, filter: ((Sprint1Pokemon) -> Boolean)?) {
    val names   = list!!.map { it.name }
    val strong  = list!!.filter { it.level > 50 }
    val matched = list!!.firstOrNull { filter!!(it) }
    val total   = list!!.sumOf { it.level }
    list!!.forEach { p -> println(p.name) }
    val sorted  = list!!.sortedByDescending { it.level }
}

// ── 1f. !! dans des interpolations ───────────────────────────────────────────

fun f1fInterpolation(p: Sprint1Pokemon?, m: PokemonMove?) {
    val msg1 = "Pokémon : ${p!!.name}"
    val msg2 = "${p!!.name} Lv.${p!!.level}"
    val msg3 = "${p!!.name} — HP:${p!!.hp} — Move:${m!!.name} PP:${m!!.pp}/${m!!.maxPp}"
    val msg4 = "Team : ${p!!.name} (${p!!.hp}hp / Lv${p!!.level})"
    println("Leader: ${p!!.name}")
}

// ── 1g. !! comme argument de fonction ────────────────────────────────────────

private fun display(name: String, level: Int) = println("$name Lv.$level")
private fun battle(a: String, b: String)      = println("$a vs $b")
private fun heal(hp: Int, max: Int)           = println("$hp/$max")

fun f1gAsArgument(p: Sprint1Pokemon?, q: Sprint1Pokemon?, m: PokemonMove?) {
    display(p!!.name, p!!.level)
    display(q!!.name, q!!.level)
    battle(p!!.name, q!!.name)
    heal(p!!.hp, 100)
    println(m!!.name.uppercase())
    println(p!!.name.trim().lowercase())
}

// ── 1h. !! dans des valeurs de retour ────────────────────────────────────────

fun f1hReturn(p: Sprint1Pokemon?): String    = p!!.name
fun f1hReturnLevel(p: Sprint1Pokemon?): Int  = p!!.level
fun f1hFindById(id: Int, list: List<Sprint1Pokemon>?): Sprint1Pokemon =
    list!!.first { it.id == id }

fun f1hElvis(p: Sprint1Pokemon?, q: Sprint1Pokemon?): String =
    p?.name ?: q!!.name

// ── 1i. !! dans des scope functions ──────────────────────────────────────────

fun f1iScope(p: Sprint1Pokemon?, list: List<Sprint1Pokemon>?) {
    val name   = p!!.let { it.name.uppercase() }
    val result = p!!.run { "$name Lv.$level" }
    p!!.also { display(it.name, it.level) }
    val safe   = p!!.takeIf { it.level > 0 }?.name ?: "fainted"
    val size   = list!!.let { it.size }
    list!!.also { println("Team size: ${it.size}") }
}

// ── 1j. !! dans des expressions when ─────────────────────────────────────────

fun f1jWhen(p: Sprint1Pokemon?, list: List<Sprint1Pokemon>?): String = when {
    p == null        -> "no pokemon"
    p!!.level >= 80  -> "elite"
    p!!.level >= 50  -> "strong"
    list!!.isEmpty() -> "empty team"
    else             -> "beginner"
}

// ── 1k. !! dans un data class / companion ────────────────────────────────────

data class BattleResult(val winner: Sprint1Pokemon?, val loser: Sprint1Pokemon?) {
    val winnerName: String get() = winner!!.name
    val loserName: String  get() = loser!!.name
    val score: String      get() = "${winner!!.level} > ${loser!!.level}"
}

// ── 1l. NE PAS surligner — dans des commentaires (✗) ─────────────────────────

// val x = p!! ← commentaire, pas de surligné
// pokemon!! est dangereux — éviter en production
/*
 * Attention !! cet opérateur lance une NullPointerException si null.
 * result!!.value n'est jamais sûr sans vérification préalable.
 */

// ── 1m. NE PAS surligner — dans des strings (✗) ──────────────────────────────

fun f1mStrings() {
    val s1 = "Attention !! valeur nulle"
    val s2 = "Ne pas utiliser !! en production"
    val s3 = "Opérateur !! : NullPointerException garantie"
    val s4 = """
        AVERTISSEMENT !!
        L'opérateur !! est dangereux.
        val x = y!! peut crasher au runtime.
    """.trimIndent()
}

// ═════════════════════════════════════════════════════════════════════════════
// FEATURE 2 — Hex color literal swatch ■
//
// Attendu  : un ■ coloré inline devant chaque valeur hex valide
// Formats  : #RGB  #ARGB  #RRGGBB  #AARRGGBB  0xAARRGGBB
// Exclus   : trop court, sans #, 0x sans FF prefix, dans commentaire/string (✗)
// ═════════════════════════════════════════════════════════════════════════════

// ── 2a. Format 0xAARRGGBB — Kotlin/Android ───────────────────────────────────

val f2aPrimary        = Color(0xFF7F52FF.toInt())   // ■ violet Kotlin brand
val f2aPrimaryDark    = Color(0xFF5B3FBF.toInt())   // ■ violet foncé
val f2aPrimaryLight   = Color(0xFFA87FFF.toInt())   // ■ violet clair
val f2aSecondary      = Color(0xFFFF5722.toInt())   // ■ orange vif
val f2aSecondaryDark  = Color(0xFFBF360C.toInt())   // ■ orange foncé
val f2aBackground     = Color(0xFFFFFFFF.toInt())   // ■ blanc
val f2aSurface        = Color(0xFFF5F5F5.toInt())   // ■ gris très clair
val f2aError          = Color(0xFFB00020.toInt())   // ■ rouge erreur
val f2aSuccess        = Color(0xFF388E3C.toInt())   // ■ vert succès
val f2aWarning        = Color(0xFFF57C00.toInt())   // ■ orange avertissement
val f2aInfo           = Color(0xFF1976D2.toInt())   // ■ bleu info
val f2aOnPrimary      = Color(0xFFFFFFFF.toInt())   // ■ blanc sur primary
val f2aOnSurface      = Color(0xFF212121.toInt())   // ■ presque noir

// ── 2b. Semi-transparent (alpha < FF) ────────────────────────────────────────

val f2bScrim           = Color(0x66000000.toInt())  // ■ noir 40%
val f2bOverlay50       = Color(0x80000000.toInt())  // ■ noir 50%
val f2bOverlay25       = Color(0x40000000.toInt())  // ■ noir 25%
val f2bTransPrimary    = Color(0x807F52FF.toInt())  // ■ violet 50%
val f2bTransError      = Color(0x40B00020.toInt())  // ■ rouge 25%
val f2bTransWhite      = Color(0xCCFFFFFF.toInt())  // ■ blanc 80%

// ── 2c. Format "#RRGGBB" string ───────────────────────────────────────────────

val f2cPrimary    = "#5731c0"   // ■ violet
val f2cError      = "#B00020"   // ■ rouge
val f2cSuccess    = "#388E3C"   // ■ vert
val f2cWarning    = "#F57C00"   // ■ orange
val f2cInfo       = "#1976D2"   // ■ bleu
val f2cBlack      = "#000000"   // ■ noir
val f2cWhite      = "#FFFFFF"   // ■ blanc
val f2cGray       = "#9E9E9E"   // ■ gris
val f2cDark       = "#121212"   // ■ presque noir (dark theme bg)
val f2cDarkSurf   = "#1E1E1E"   // ■ surface dark

// ── 2d. Format "#AARRGGBB" (avec canal alpha) ─────────────────────────────────

val f2dScrimHex       = "#66000000"   // ■ noir semi-transparent
val f2dOverlayHex     = "#80FFFFFF"   // ■ blanc semi-transparent
val f2dTransPrimHex   = "#807F52FF"   // ■ violet 50%
val f2dTransErrHex    = "#40B00020"   // ■ rouge 25%

// ── 2e. Format "#RGB" shorthand ───────────────────────────────────────────────

val f2eRed    = "#F00"   // ■ rouge
val f2eGreen  = "#0F0"   // ■ vert
val f2eBlue   = "#00F"   // ■ bleu
val f2eWhite  = "#FFF"   // ■ blanc
val f2eBlack  = "#000"   // ■ noir
val f2eCyan   = "#0FF"   // ■ cyan
val f2eMagenta = "#F0F"  // ■ magenta
val f2eYellow = "#FF0"   // ■ jaune

// ── 2f. Format "#ARGB" shorthand ─────────────────────────────────────────────

val f2fSemiWhite  = "#8FFF"   // ■ blanc semi-transparent
val f2fSemiBlack  = "#8000"   // ■ noir semi-transparent
val f2fSemiRed    = "#8F00"   // ■ rouge semi-transparent

// ── 2g. Pokémon type palette ──────────────────────────────────────────────────

val f2gFire      = Color.parseColor("#FF4500")   // ■ rouge-orange feu
val f2gWater     = Color.parseColor("#1E90FF")   // ■ bleu eau
val f2gGrass     = Color.parseColor("#228B22")   // ■ vert herbe
val f2gElectric  = Color.parseColor("#FFD700")   // ■ jaune électrique
val f2gPsychic   = Color.parseColor("#FF69B4")   // ■ rose psychique
val f2gDragon    = Color.parseColor("#6A0DAD")   // ■ violet dragon
val f2gIce       = Color.parseColor("#98D8D8")   // ■ bleu glacé
val f2gGhost     = Color.parseColor("#705898")   // ■ violet fantôme
val f2gSteel     = Color.parseColor("#B8B8D0")   // ■ gris acier
val f2gDark      = Color.parseColor("#705848")   // ■ brun sombre
val f2gFighting  = Color.parseColor("#C03028")   // ■ rouge combat
val f2gPoison    = Color.parseColor("#A040A0")   // ■ violet poison

// ── 2h. Dans des conditions if/else ──────────────────────────────────────────

fun f2hAdaptiveColor(isDark: Boolean) {
    val bg      = if (isDark) "#121212" else "#FFFFFF"
    val text    = if (isDark) "#FFFFFF" else "#212121"
    val surface = if (isDark) "#1E1E1E" else "#F5F5F5"
    val accent  = if (isDark) "#A87FFF" else "#7F52FF"
    val divider = if (isDark) "#2E2E2E" else "#E0E0E0"
    println("bg=$bg text=$text")
}

// ── 2i. Dans un when ─────────────────────────────────────────────────────────

fun f2iTypeColor(type: String): String = when (type) {
    "fire"     -> "#FF4500"
    "water"    -> "#1E90FF"
    "grass"    -> "#228B22"
    "electric" -> "#FFD700"
    "psychic"  -> "#FF69B4"
    "dragon"   -> "#6A0DAD"
    "ice"      -> "#98D8D8"
    "ghost"    -> "#705898"
    "steel"    -> "#B8B8D0"
    "dark"     -> "#705848"
    "fighting" -> "#C03028"
    "poison"   -> "#A040A0"
    "normal"   -> "#A8A878"
    else       -> "#9E9E9E"
}

// ── 2j. Dans un data class ───────────────────────────────────────────────────

data class Sprint1Palette(
    val primary: String    = "#7F52FF",
    val secondary: String  = "#FF5722",
    val background: String = "#FFFFFF",
    val surface: String    = "#F5F5F5",
    val error: String      = "#B00020",
    val success: String    = "#388E3C",
    val warning: String    = "#F57C00",
    val info: String       = "#1976D2",
)

val lightPalette = Sprint1Palette(
    primary    = "#7F52FF",
    secondary  = "#FF5722",
    background = "#FFFFFF",
    surface    = "#F5F5F5",
    error      = "#B00020",
)

val darkPalette = Sprint1Palette(
    primary    = "#A87FFF",
    secondary  = "#FF8A65",
    background = "#121212",
    surface    = "#1E1E1E",
    error      = "#CF6679",
)

// ── 2k. Dans des collections ──────────────────────────────────────────────────

val typeColors = mapOf(
    "fire"     to "#FF4500",
    "water"    to "#1E90FF",
    "grass"    to "#228B22",
    "electric" to "#FFD700",
    "psychic"  to "#FF69B4",
    "dragon"   to "#6A0DAD",
)

val statusColors = listOf("#388E3C", "#F57C00", "#B00020", "#1976D2")

// ── 2l. Dans des interpolations ───────────────────────────────────────────────

fun f2lInterpolation() {
    println("Primary: ${"#7F52FF"}, Error: ${"#B00020"}")
    val log = "Theme: bg=#FFFFFF text=#212121 accent=#7F52FF"
    val msg = "Colors: primary=${lightPalette.primary} error=${lightPalette.error}"
}

// ── 2m. Cas NON colorés (✗) ──────────────────────────────────────────────────

fun f2mNotColors() {
    val text    = "not-a-hex"      // (✗) pas un pattern hex
    val short   = "#FF"            // (✗) trop court (< 3 hex digits)
    val noHash  = "7F52FF"         // (✗) sans #
    val noAlpha = 0x001234         // (✗) 0x sans prefix FF
    val tooLong = "#1234567890"    // (✗) trop long
    // val inComment = "#DEADBE"   // (✗) dans un commentaire
    val inStr   = "la couleur est #G0G0G0"  // (✗) chars invalides
}

// ═════════════════════════════════════════════════════════════════════════════
// FEATURE 3 — @RequiresApi human-readable level
//
// Attendu  : inlay hint "Android X.Y Nom" à côté de @RequiresApi(N)
//            et des gardes Build.VERSION.SDK_INT >= N au runtime
// ═════════════════════════════════════════════════════════════════════════════

// ── 3a. Par niveau entier — tous les niveaux courants ─────────────────────────

@RequiresApi(21) fun f3aLollipop()        = Unit   // → Android 5.0 Lollipop
@RequiresApi(22) fun f3aLollipopMr1()     = Unit   // → Android 5.1 Lollipop MR1
@RequiresApi(23) fun f3aMarshmallow()     = Unit   // → Android 6.0 Marshmallow
@RequiresApi(24) fun f3aNougat()          = Unit   // → Android 7.0 Nougat
@RequiresApi(25) fun f3aNougatMr1()       = Unit   // → Android 7.1 Nougat MR1
@RequiresApi(26) fun f3aOreo()            = Unit   // → Android 8.0 Oreo
@RequiresApi(27) fun f3aOreoMr1()         = Unit   // → Android 8.1 Oreo MR1
@RequiresApi(28) fun f3aPie()             = Unit   // → Android 9 Pie
@RequiresApi(29) fun f3aQ()               = Unit   // → Android 10
@RequiresApi(30) fun f3aR()               = Unit   // → Android 11
@RequiresApi(31) fun f3aS()               = Unit   // → Android 12
@RequiresApi(32) fun f3aSv2()             = Unit   // → Android 12L
@RequiresApi(33) fun f3aTiramisu()        = Unit   // → Android 13 Tiramisu
@RequiresApi(34) fun f3aUpsideDownCake()  = Unit   // → Android 14 Upside Down Cake
@RequiresApi(35) fun f3aVanilla()         = Unit   // → Android 15 Vanilla Ice Cream

// ── 3b. Par VERSION_CODES constant ───────────────────────────────────────────

@RequiresApi(Build.VERSION_CODES.LOLLIPOP)          fun f3bByLollipop()    = Unit
@RequiresApi(Build.VERSION_CODES.LOLLIPOP_MR1)                                 fun f3bByLollMr1()     = Unit
@RequiresApi(Build.VERSION_CODES.M)                  fun f3bByMarshmallow() = Unit
@RequiresApi(Build.VERSION_CODES.N)                  fun f3bByNougat()      = Unit
@RequiresApi(Build.VERSION_CODES.O)                  fun f3bByOreo()        = Unit
@RequiresApi(Build.VERSION_CODES.P)                  fun f3bByPie()         = Unit
@RequiresApi(Build.VERSION_CODES.Q)                  fun f3bByQ()           = Unit
@RequiresApi(Build.VERSION_CODES.R)                  fun f3bByR()           = Unit
@RequiresApi(Build.VERSION_CODES.S)                  fun f3bByS()           = Unit
@RequiresApi(Build.VERSION_CODES.TIRAMISU)           fun f3bByTiramisu()    = Unit
@RequiresApi(Build.VERSION_CODES.UPSIDE_DOWN_CAKE)   fun f3bByUDC()         = Unit
@RequiresApi(Build.VERSION_CODES.VANILLA_ICE_CREAM)  fun f3bByVIC()         = Unit

// ── 3c. Sur une classe avec méthodes imbriquées ───────────────────────────────

@RequiresApi(26)
class NotificationManager {
    fun createChannel() = Unit

    @RequiresApi(29)
    fun setCustomSound() = Unit

    @RequiresApi(30)
    fun setConversationType() = Unit

    @RequiresApi(31)
    fun setConversationId() = Unit

    @RequiresApi(33)
    fun setForegroundServiceType() = Unit
}

@RequiresApi(31)
class SplashScreenManager {
    fun setSplashScreen() = Unit

    @RequiresApi(33)
    fun setAnimationListener() = Unit
}

// ── 3d. @SuppressLint combiné avec @RequiresApi ───────────────────────────────

@RequiresApi(23)
@SuppressLint("MissingPermission")
fun f3dFingerprintAuth() = Unit

@RequiresApi(26)
@SuppressLint("NewApi")
fun f3dNotificationChannel() = Unit

// ── 3e. Gardes SDK_INT au runtime ────────────────────────────────────────────

fun f3eRuntimeGuards() {
    if (Build.VERSION.SDK_INT >= 21) println("Lollipop+")
    if (Build.VERSION.SDK_INT >= 23) println("Marshmallow+: fingerprint")
    if (Build.VERSION.SDK_INT >= 24) println("Nougat+: direct boot")
    if (Build.VERSION.SDK_INT >= 26) println("Oreo+: notification channels")
    if (Build.VERSION.SDK_INT >= 28) println("Pie+: dark theme")
    if (Build.VERSION.SDK_INT >= 29) println("Q+: gesture navigation")
    if (Build.VERSION.SDK_INT >= 30) println("R+: call screening")
    if (Build.VERSION.SDK_INT >= 31) println("S+: SplashScreen")
    if (Build.VERSION.SDK_INT >= 32) println("S_V2+: 12L")
    if (Build.VERSION.SDK_INT >= 33) println("Tiramisu+: predictive back")
    if (Build.VERSION.SDK_INT >= 34) println("UDC+: health connect")
    if (Build.VERSION.SDK_INT >= 35) println("VIC+: Android 15")
}

// ── 3f. Gardes SDK_INT par VERSION_CODES au runtime ──────────────────────────

fun f3fRuntimeByConst() {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M)               println("M+")
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O)               println("O+")
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P)               println("P+")
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q)               println("Q+")
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R)               println("R+")
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S)               println("S+")
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU)        println("Tiramisu+")
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) println("UDC+")
}

// ── 3g. Variables booléennes ──────────────────────────────────────────────────

fun f3gBoolVars() {
    val isAtLeastMarshmallow = Build.VERSION.SDK_INT >= 23
    val isAtLeastOreo        = Build.VERSION.SDK_INT >= 26
    val isAtLeastAndroid10   = Build.VERSION.SDK_INT >= 29
    val isAtLeastAndroid12   = Build.VERSION.SDK_INT >= 31
    val isAtLeastTiramisu    = Build.VERSION.SDK_INT >= 33
    val isModern             = Build.VERSION.SDK_INT >= Build.VERSION_CODES.S
    val isLatest             = Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU
}

// ── 3h. Dans un when ─────────────────────────────────────────────────────────

fun f3hFeatureByLevel(): String = when {
    Build.VERSION.SDK_INT >= 34 -> "Health Connect (API 34)"
    Build.VERSION.SDK_INT >= 33 -> "Predictive Back (API 33)"
    Build.VERSION.SDK_INT >= 31 -> "SplashScreen (API 31)"
    Build.VERSION.SDK_INT >= 29 -> "Bubbles (API 29)"
    Build.VERSION.SDK_INT >= 26 -> "NotificationChannels (API 26)"
    Build.VERSION.SDK_INT >= 23 -> "Fingerprint (API 23)"
    Build.VERSION.SDK_INT >= 21 -> "Material (API 21)"
    else                        -> "Legacy"
}

// ═════════════════════════════════════════════════════════════════════════════
// FEATURE 4 — Format string preview in hover
//
// Hover sur un R.string.xxx contenant des format specifiers.
// Attendu  : tooltip = valeur brute + une ligne par spécificateur (%s → String, etc.)
// Exclus   : strings sans specifiers → hover normal, pas d'annotation (✗)
// ═════════════════════════════════════════════════════════════════════════════

private fun getString(resId: Int): String = "#$resId"
private fun format(resId: Int, vararg args: Any): String = "#$resId(${args.joinToString()})"

// ── 4a. %s — String argument ──────────────────────────────────────────────────

val f4aWelcomeRes  = R.string.msg_welcome_user   // "Hello, %s!"         → %s = String
val f4aCaughtRes   = R.string.msg_pokemon_caught // "%s was caught!"      → %s = String

// ── 4b. %d — Integer argument ────────────────────────────────────────────────

val f4bExpRes      = R.string.msg_exp_needed     // "%d EXP to next level"    → %d = Integer
val f4bRewardRes   = R.string.msg_reward         // "You earned %d coins!"    → %d = Integer

// ── 4c. %s + %d — String + Integer ───────────────────────────────────────────

val f4cLevelUpRes  = R.string.msg_level_up       // "%s reached level %d!"   → %s = String, %d = Integer

// ── 4d. Arguments positionnels (%1$s, %2$d, %3$s) ────────────────────────────

val f4dDamageRes   = R.string.msg_damage         // "%1$s dealt %2$d damage to %3$s!"
val f4dScoreRes    = R.string.msg_score          // "Score: %1$d / %2$d"
val f4dSlotsRes    = R.string.msg_team_slots     // "Team: %1$d / %2$d slots"
val f4dPpRes       = R.string.msg_move_pp        // "PP: %1$d / %2$d"
val f4dHpBarRes    = R.string.msg_hp_bar         // "HP: %d / %d remaining"

// ── 4e. %.Nf — Float avec précision ──────────────────────────────────────────

val f4eCatchRate   = R.string.msg_catch_rate     // "Catch rate: %.1f%%"  → %.1f = Float

// ── 4f. Appels dans des fonctions ────────────────────────────────────────────

fun f4fFormattedMessages(p: Sprint1Pokemon, count: Int, rate: Float) {
    val greeting  = format(R.string.msg_welcome_user, p.name)
    val levelMsg  = format(R.string.msg_level_up, p.name, p.level)
    val expMsg    = format(R.string.msg_exp_needed, 100 - p.level)
    val slotsMsg  = format(R.string.msg_team_slots, count, 6)
    val damageMsg = format(R.string.msg_damage, p.name, 42, "Pikachu")
    val scoreMsg  = format(R.string.msg_score, 1800, 2000)
    val catchMsg  = format(R.string.msg_catch_rate, rate)
    val rewardMsg = format(R.string.msg_reward, 150)
    val ppMsg     = format(R.string.msg_move_pp, 15, 20)
    val hpMsg     = format(R.string.msg_hp_bar, p.hp, 100)
    val caughtMsg = format(R.string.msg_pokemon_caught, p.name)
}

// ── 4g. Dans des conditions ───────────────────────────────────────────────────

fun f4gConditional(p: Sprint1Pokemon, count: Int): Int = when {
    p.level >= 80 -> R.string.msg_damage      // a format string
    p.level >= 50 -> R.string.msg_level_up    // a format string
    count >= 6    -> R.string.msg_team_slots  // a format string
    else          -> R.string.msg_exp_needed  // a format string
}

// ── 4h. Dans des collections ──────────────────────────────────────────────────

val formatStringRefs = listOf(
    R.string.msg_welcome_user,    // "Hello, %s!"
    R.string.msg_level_up,        // "%s reached level %d!"
    R.string.msg_damage,          // "%1$s dealt %2$d damage to %3$s!"
    R.string.msg_catch_rate,      // "Catch rate: %.1f%%"
    R.string.msg_score,           // "Score: %1$d / %2$d"
    R.string.msg_pokemon_caught,  // "%s was caught!"
)

// ── 4i. Plain strings — pas d'annotation (✗) ─────────────────────────────────

fun f4iPlainStrings() {
    val appName    = R.string.app_name        // "Kotlin Jump Demo"   → pas de %s
    val loading    = R.string.msg_loading     // "Loading…"           → plain
    val battleWon  = R.string.msg_battle_won  // "Victory! You won…"  → plain
    val errorMsg   = R.string.error_network   // plain
    val cancelBtn  = R.string.action_cancel   // plain
}

// ═════════════════════════════════════════════════════════════════════════════
// FEATURE 5 — R.plurals.* + R.array.* folding + hover
//
// Attendu  : R.plurals.xxx → affiche la forme "other" inline
//            R.array.xxx   → affiche les éléments joints inline
// Exclus   : clés inconnues → aucune décoration (✗)
// ═════════════════════════════════════════════════════════════════════════════

private fun getQuantityString(resId: Int, quantity: Int): String = "#$resId($quantity)"
private fun getStringArray(resId: Int): Array<String> = arrayOf("#$resId")

// ── 5a. Références top-level ─────────────────────────────────────────────────

val f5aPokemonCountPlural = R.plurals.pokemon_count    // → "%d Pokémon"
val f5aBattleWinsPlural   = R.plurals.battle_wins      // → "%d wins"
val f5aItemCountPlural    = R.plurals.item_count       // → "%d items"

val f5aPokemonTypesArray  = R.array.pokemon_types      // → "[Fire, Water, Grass, …]"
val f5aUserRolesArray     = R.array.user_roles         // → "[Admin, Editor, Viewer]"
val f5aDifficultyArray    = R.array.difficulty_levels  // → "[Easy, Medium, Hard, Expert]"

// ── 5b. Affectations locales ──────────────────────────────────────────────────

fun f5bLocal() {
    val countRes  = R.plurals.pokemon_count
    val winsRes   = R.plurals.battle_wins
    val itemsRes  = R.plurals.item_count

    val typesRes  = R.array.pokemon_types
    val rolesRes  = R.array.user_roles
    val diffRes   = R.array.difficulty_levels
}

// ── 5c. Appels de fonctions ───────────────────────────────────────────────────

fun f5cFunctionCalls(count: Int) {
    val pokemonMsg = getQuantityString(R.plurals.pokemon_count, count)
    val winsMsg    = getQuantityString(R.plurals.battle_wins, count)
    val itemsMsg   = getQuantityString(R.plurals.item_count, count)

    val types      = getStringArray(R.array.pokemon_types)
    val roles      = getStringArray(R.array.user_roles)
    val difficulty = getStringArray(R.array.difficulty_levels)
}

// ── 5d. Paramètres par défaut ─────────────────────────────────────────────────

fun f5dShowCount(
    pluralRes: Int = R.plurals.pokemon_count,
    count: Int     = 0,
) = getQuantityString(pluralRes, count)

fun f5dShowList(
    arrayRes: Int  = R.array.pokemon_types,
) = getStringArray(arrayRes)

// ── 5e. Dans un when ─────────────────────────────────────────────────────────

fun f5ePluralForCategory(category: String): Int = when (category) {
    "pokemon" -> R.plurals.pokemon_count
    "wins"    -> R.plurals.battle_wins
    "items"   -> R.plurals.item_count
    else      -> R.plurals.item_count
}

fun f5eArrayForSection(section: String): Int = when (section) {
    "types"      -> R.array.pokemon_types
    "roles"      -> R.array.user_roles
    "difficulty" -> R.array.difficulty_levels
    else         -> R.array.pokemon_types
}

// ── 5f. Collections ───────────────────────────────────────────────────────────

val f5fAllPlurals = listOf(
    R.plurals.pokemon_count,
    R.plurals.battle_wins,
    R.plurals.item_count,
)

val f5fAllArrays = listOf(
    R.array.pokemon_types,
    R.array.user_roles,
    R.array.difficulty_levels,
)

val f5fPluralMap = mapOf(
    "pokemon" to R.plurals.pokemon_count,
    "wins"    to R.plurals.battle_wins,
    "items"   to R.plurals.item_count,
)

val f5fArrayMap = mapOf(
    "types"      to R.array.pokemon_types,
    "roles"      to R.array.user_roles,
    "difficulty" to R.array.difficulty_levels,
)

// ── 5g. Plusieurs refs sur une même ligne ─────────────────────────────────────

fun f5gSameLine() {
    println("${R.plurals.pokemon_count} / ${R.array.pokemon_types}")
    println("Wins: ${R.plurals.battle_wins}, Items: ${R.plurals.item_count}")
    println("Types: ${R.array.pokemon_types}, Roles: ${R.array.user_roles}")
}

// ── 5h. Data class ───────────────────────────────────────────────────────────

data class ResourceBundle(
    val countPlural:   Int = R.plurals.pokemon_count,
    val winsPlural:    Int = R.plurals.battle_wins,
    val typesArray:    Int = R.array.pokemon_types,
    val rolesArray:    Int = R.array.user_roles,
)

// ── 5i. Companion object ─────────────────────────────────────────────────────

class Sprint1ResourceRefs {
    companion object {
        val POKEMON_PLURAL  = R.plurals.pokemon_count
        val BATTLE_PLURAL   = R.plurals.battle_wins
        val TYPES_ARRAY     = R.array.pokemon_types
        val ROLES_ARRAY     = R.array.user_roles
        val DIFFICULTY_ARRAY = R.array.difficulty_levels
    }
}

// ── 5j. Clés manquantes — pas de décoration (✗) ──────────────────────────────

fun f5jMissingKeys() {
    val p = R.plurals.this_plural_does_not_exist   // (✗) clé inconnue
    val a = R.array.this_array_does_not_exist      // (✗) clé inconnue
}

// ═════════════════════════════════════════════════════════════════════════════
// FEATURE 6 — Translation completeness in hover
//
// Hover sur un R.string.xxx → grille des locales dans le tooltip
//   values ✓  values-en ✓  → clé présente dans TOUTES les locales
//   values ✓  values-en ✗  → clé absente de values-en
// ═════════════════════════════════════════════════════════════════════════════

// ── 6a. Clés présentes dans TOUTES les locales → ✓ ✓ ─────────────────────────

val f6aFullAppName   = R.string.app_name            // values ✓   values-en ✓
val f6aFullPokedex   = R.string.title_pokedex        // values ✓   values-en ✓
val f6aFullTeam      = R.string.title_team           // values ✓   values-en ✓
val f6aFullBattle    = R.string.title_battle         // values ✓   values-en ✓
val f6aFullConfirm   = R.string.action_confirm       // values ✓   values-en ✓
val f6aFullCancel    = R.string.action_cancel        // values ✓   values-en ✓
val f6aFullError     = R.string.error_network        // values ✓   values-en ✓
val f6aFullBattleWon = R.string.msg_battle_won       // values ✓   values-en ✓
val f6aSprint1Ok1    = R.string.sprint1_welcome      // values ✓   values-en ✓
val f6aSprint1Ok2    = R.string.sprint1_start        // values ✓   values-en ✓

// ── 6b. Clés absentes de values-en → values ✓  values-en ✗ ──────────────────

val f6bMissing1   = R.string.msg_missing_in_en       // values ✓   values-en ✗
val f6bMissing2   = R.string.title_missing_in_en     // values ✓   values-en ✗
val f6bFrOnly     = R.string.sprint1_fr_only         // values ✓   values-en ✗
val f6bDefaultOnly = R.string.sprint1_default_only   // values ✓   values-en ✗

// ── 6c. Mix ✓/✗ côte à côte dans un when ─────────────────────────────────────

fun f6cGetTitle(screen: String): Int = when (screen) {
    "pokedex"  -> R.string.title_pokedex       // values ✓   values-en ✓
    "team"     -> R.string.title_team          // values ✓   values-en ✓
    "battle"   -> R.string.title_battle        // values ✓   values-en ✓
    "missing"  -> R.string.msg_missing_in_en   // values ✓   values-en ✗
    "fr_only"  -> R.string.sprint1_fr_only     // values ✓   values-en ✗
    else       -> R.string.app_name            // values ✓   values-en ✓
}

// ── 6d. Liste mix ✓/✗ — pour comparer visuellement ──────────────────────────

val f6dMixedRefs = listOf(
    R.string.app_name,               // ✓ ✓ — app name
    R.string.title_pokedex,          // ✓ ✓ — screen title
    R.string.action_confirm,         // ✓ ✓ — action button
    R.string.sprint1_welcome,        // ✓ ✓ — sprint1 ok
    R.string.sprint1_start,          // ✓ ✓ — sprint1 ok
    R.string.msg_missing_in_en,      // ✓ ✗ — missing from EN
    R.string.title_missing_in_en,    // ✓ ✗ — missing from EN
    R.string.sprint1_fr_only,        // ✓ ✗ — FR only
    R.string.sprint1_default_only,   // ✓ ✗ — default only
)

// ── 6e. Dans des fonctions simulant une vraie UI ──────────────────────────────

fun f6eScreenLabels(): List<Int> = listOf(
    R.string.title_pokedex,    // ✓ ✓
    R.string.title_team,       // ✓ ✓
    R.string.title_battle,     // ✓ ✓
    R.string.title_users,      // ✓ ✓
)

fun f6eActionLabels(): List<Int> = listOf(
    R.string.action_add_pokemon,      // ✓ ✓
    R.string.action_start_battle,     // ✓ ✓
    R.string.action_catch_pokemon,    // ✓ ✓
    R.string.action_confirm,          // ✓ ✓
    R.string.action_cancel,           // ✓ ✓
)

fun f6eIncompleteI18n(): List<Int> = listOf(
    R.string.sprint1_fr_only,         // ✓ ✗ — manque EN
    R.string.sprint1_default_only,    // ✓ ✗ — manque EN
    R.string.msg_missing_in_en,       // ✓ ✗ — manque EN
)

// ── 6f. Data class avec mix ✓/✗ ──────────────────────────────────────────────

data class I18nConfig(
    val titleRes:   Int = R.string.title_pokedex,        // ✓ ✓
    val actionRes:  Int = R.string.action_confirm,        // ✓ ✓
    val missingRes: Int = R.string.sprint1_fr_only,       // ✓ ✗
)

// ── 6g. Fonctions construisant des messages ───────────────────────────────────

fun f6gBuildWelcomeMessage(name: String): String {
    val greeting      = getString(R.string.sprint1_welcome)       // ✓ ✓
    val appTitle      = getString(R.string.app_name)              // ✓ ✓
    val frenchOnly    = getString(R.string.sprint1_fr_only)       // ✓ ✗
    val defaultOnly   = getString(R.string.sprint1_default_only)  // ✓ ✗
    return "$greeting $name — $appTitle"
}

fun f6gErrorMessage(type: String): Int = when (type) {
    "network"  -> R.string.error_network        // ✓ ✓
    "notfound" -> R.string.error_not_found       // ✓ ✓
    "fr"       -> R.string.sprint1_fr_only       // ✓ ✗
    else       -> R.string.error_unknown         // ✓ ✓
}
