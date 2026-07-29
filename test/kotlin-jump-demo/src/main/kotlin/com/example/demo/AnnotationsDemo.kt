@file:Suppress("unused") // demo fixture: declarations showcase other features

package com.example.demo

// Stubs Android — non disponibles dans un projet JVM console
annotation class SuppressLint(vararg val value: String)
object Build {
    object VERSION {
        val SDK_INT: Int = 33
    }
    object VERSION_CODES {
        const val LOLLIPOP      = 21
        const val LOLLIPOP_MR1  = 22
        const val M             = 23
        const val N             = 24
        const val N_MR1         = 25
        const val O             = 26
        const val O_MR1         = 27
        const val P             = 28
        const val Q             = 29
        const val R             = 30
        const val S             = 31
        const val S_V2          = 32
        const val TIRAMISU            = 33
        const val UPSIDE_DOWN_CAKE    = 34
        const val VANILLA_ICE_CREAM   = 35
    }
}
annotation class RequiresApi(val value: Int = 1, val api: Int = 1)

// ─────────────────────────────────────────────────────────────────────────────
// DÉMO : @Suppress, @SuppressLint, @RequiresApi
//
// @Suppress("ID")     → hover sur "ID" affiche la description de l'avertissement
// @SuppressLint("ID") → idem pour les lint Android
// @RequiresApi(N)     → inlay hint "Android X.Y NomVersion"
// ─────────────────────────────────────────────────────────────────────────────

// ── @Suppress — IDs Kotlin courants ──────────────────────────────────────────

@Suppress("UNCHECKED_CAST")
fun legacyCast(): Any = mapOf("key" to "value") as Map<String, Int>

@Suppress("unused")
fun unusedFunction() = Unit

@Suppress("DEPRECATION")
fun usesDeprecatedApi() = Unit

@Suppress("unused", "DEPRECATION")
fun twoWarnings() = Unit

@Suppress("NAME_SHADOWING")
fun shadowedParam(x: Int) {
    val x = x + 1   // name shadowing
    println(x)
}

@Suppress("UNCHECKED_CAST", "unused", "DEPRECATION")
class LegacyHelper {
    @Suppress("UNUSED_VARIABLE")
    fun withUnusedVar() {
        val unused = "not referenced"
    }

    @Suppress("UNUSED_PARAMETER")
    fun withUnusedParam(param: String) = Unit

    @Suppress("REDUNDANT_ELSE_IN_WHEN")
    fun withRedundantElse(x: Boolean): String = when (x) {
        true  -> "yes"
        false -> "no"
        else  -> "impossible"   // redundant else
    }
}

@Suppress("NOTHING_TO_INLINE")
inline fun trivialInline(x: Int) = x + 1

@Suppress("ObjectPropertyName")
val _privateVal = 42

@Suppress("FunctionName")
fun `function with spaces`() = Unit

@Suppress("MagicNumber")
fun withMagicNumbers(): Int = 42 + 7 + 100

@Suppress("TooGenericExceptionCaught")
fun catchesAny() {
    try { Unit } catch (e: Exception) { }
}

@Suppress("SwallowedException")
fun swallowsException() {
    try { Unit } catch (e: Exception) { /* ignored */ }
}

@Suppress("LongMethod")
fun aVeryLongMethodThatDoesLotsOfThings(
    a: Int, b: Int, c: Int, d: Int
): Int {
    val step1 = a + b
    val step2 = step1 * c
    val step3 = step2 - d
    val step4 = step3 / (a + 1)
    return step4
}

// ── @SuppressLint — IDs Android courants ─────────────────────────────────────

@SuppressLint("HardcodedText")
fun hardcodedText() = Unit

@SuppressLint("MissingPermission")
fun accessesWithoutPermission() = Unit

@SuppressLint("NewApi")
fun usesNewApi() = Unit

@SuppressLint("HardcodedText", "MissingPermission")
fun multipleLintsFunction() = Unit

@SuppressLint("InflateParams")
fun inflatesWithNull() = Unit

@SuppressLint("SetTextI18n")
fun setsTextDirectly() = Unit

@SuppressLint("UseCompatLoadingForDrawables")
fun loadsDrawable() = Unit

@SuppressLint("ClickableViewAccessibility")
fun missingAccessibility() = Unit

@SuppressLint("HandlerLeak")
class LeakyHandler {
    @SuppressLint("DefaultLocale")
    fun uppercaseFrench(s: String) = s.uppercase()
}

// ── @RequiresApi — niveaux par entier ────────────────────────────────────────

@RequiresApi(21)
fun requiresLollipop() = Unit          // → Android 5.0 Lollipop

@RequiresApi(23)
fun requiresMarshmallow() = Unit       // → Android 6.0 Marshmallow

@RequiresApi(24)
fun requiresNougat() = Unit            // → Android 7.0 Nougat

@RequiresApi(26)
fun requiresOreo() = Unit              // → Android 8.0 Oreo

@RequiresApi(28)
fun requiresPie() = Unit               // → Android 9 Pie

@RequiresApi(29)
fun requiresQ() = Unit                 // → Android 10

@RequiresApi(30)
fun requiresR() = Unit                 // → Android 11

@RequiresApi(31)
fun requiresS() = Unit                 // → Android 12

@RequiresApi(33)
fun requiresTiramisu() = Unit          // → Android 13 Tiramisu

@RequiresApi(34)
fun requiresUpsideDownCake() = Unit    // → Android 14 Upside Down Cake

// ── @RequiresApi — niveaux par VERSION_CODES ──────────────────────────────────

@RequiresApi(Build.VERSION_CODES.LOLLIPOP)
fun byLollipopConst() = Unit           // → Android 5.0 Lollipop

@RequiresApi(Build.VERSION_CODES.M)
fun byMarshmallowConst() = Unit        // → Android 6.0 Marshmallow

@RequiresApi(Build.VERSION_CODES.O)
fun byOreoConst() = Unit               // → Android 8.0 Oreo

@RequiresApi(Build.VERSION_CODES.P)
fun byPieConst() = Unit                // → Android 9 Pie

@RequiresApi(Build.VERSION_CODES.S)
fun bySConst() = Unit                  // → Android 12

@RequiresApi(Build.VERSION_CODES.TIRAMISU)
fun byTiramisuConst() = Unit           // → Android 13 Tiramisu

@RequiresApi(Build.VERSION_CODES.UPSIDE_DOWN_CAKE)
fun byUDCConst() = Unit                // → Android 14 Upside Down Cake

// ── SDK_INT guards runtime ────────────────────────────────────────────────────

fun sdkIntGuards() {
    if (Build.VERSION.SDK_INT >= 33) {                         // → Android 13 Tiramisu
        println("Running on Tiramisu or higher")
    }

    if (Build.VERSION.SDK_INT >= 26) {                         // → Android 8.0 Oreo
        println("Notification channels available")
    }

    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {     // → Android 12
        println("Blur effects available")
    }

    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) { // → Android 13
        println("Photo picker available")
    }

    val isAtLeastOreo    = Build.VERSION.SDK_INT >= 26         // → 8.0 Oreo
    val isAtLeastAndroid12 = Build.VERSION.SDK_INT >= 31       // → Android 12
    val isModern         = Build.VERSION.SDK_INT >= Build.VERSION_CODES.R  // → Android 11

    when {
        Build.VERSION.SDK_INT >= 34 -> println("Android 14+")  // → 14 Upside Down Cake
        Build.VERSION.SDK_INT >= 33 -> println("Android 13")   // → 13 Tiramisu
        Build.VERSION.SDK_INT >= 31 -> println("Android 12")   // → 12
        Build.VERSION.SDK_INT >= 26 -> println("Android 8+")   // → 8.0 Oreo
        else                        -> println("Legacy")
    }
}
