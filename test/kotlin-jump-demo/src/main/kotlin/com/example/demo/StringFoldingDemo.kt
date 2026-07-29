@file:Suppress("unused") // demo fixture: declarations showcase other features

package com.example.demo

import com.example.app.R
import com.example.data.PokemonType
import com.example.data.UserRole

// ─────────────────────────────────────────────────────────────────────────────
// DÉMO : Tous les patterns R.string.* — couverture exhaustive
//
// Chaque section montre un pattern syntaxique distinct.
// Les décorations doivent apparaître sur toutes les lignes sauf celles
// marquées (✗) dans les edge cases.
// ─────────────────────────────────────────────────────────────────────────────

// Stubs simulant l'API Android — non disponible dans ce projet JVM console.
@Target(AnnotationTarget.VALUE_PARAMETER, AnnotationTarget.PROPERTY, AnnotationTarget.LOCAL_VARIABLE)
@Retention(AnnotationRetention.SOURCE)
annotation class StringRes

private fun getString(resId: Int): String = "#$resId"
private fun getText(resId: Int): CharSequence = "#$resId"
private fun setTitle(@Suppress("UNUSED_PARAMETER") resId: Int) = Unit
private fun showToast(@Suppress("UNUSED_PARAMETER") resId: Int) = Unit
private fun showSnackbar(@Suppress("UNUSED_PARAMETER") resId: Int) = Unit
private fun setHint(@Suppress("UNUSED_PARAMETER") resId: Int) = Unit

// ── 1. Propriétés top-level ───────────────────────────────────────────────────

val APP_TITLE   = R.string.app_name
val APP_VERSION = R.string.app_version

// ── 2. val / var locaux ───────────────────────────────────────────────────────

fun localAssignments() {
    val title    = R.string.title_pokedex
    var section  = R.string.title_team
    section      = R.string.title_battle           // réassignation
    val typed: Int = R.string.title_users
    @StringRes val annotated = R.string.error_unknown
}

// ── 3. Interpolation de chaîne ────────────────────────────────────────────────

fun interpolation() {
    val single   = "Titre : ${R.string.title_pokedex}"
    val double   = "${R.string.action_confirm} / ${R.string.action_cancel}"
    val triple   = "${R.string.msg_battle_won} – ${R.string.msg_battle_lost} – ${R.string.msg_battle_draw}"
    val embedded = "Erreur [${R.string.error_network}] → réessayer : ${R.string.action_retry}"
    println("Chargement : ${R.string.msg_loading}")
}

// ── 4. Argument de fonction (direct) ─────────────────────────────────────────

fun functionArguments() {
    val s1 = getString(R.string.error_network)
    val s2 = getText(R.string.label_pokemon_name)
    setTitle(R.string.title_pokedex)
    showToast(R.string.msg_team_full)
    showSnackbar(R.string.msg_empty_team)
    setHint(R.string.label_pokemon_name)
}

// ── 5. Plusieurs R.string sur un même appel ───────────────────────────────────

private fun showPair(a: Int, b: Int): String = "$a/$b"
private fun showDialog(@Suppress("UNUSED_PARAMETER") titleRes: Int, @Suppress("UNUSED_PARAMETER") confirmRes: Int, @Suppress("UNUSED_PARAMETER") cancelRes: Int) = Unit

fun multiArgCall() {
    showPair(R.string.action_confirm, R.string.action_cancel)
    showDialog(
        titleRes   = R.string.title_battle,
        confirmRes = R.string.action_start_battle,
        cancelRes  = R.string.action_cancel,
    )
}

// ── 6. Paramètres par défaut ──────────────────────────────────────────────────

fun showError(@StringRes messageRes: Int = R.string.error_unknown) = showToast(messageRes)
fun showInfo(
    @StringRes titleRes: Int   = R.string.title_pokedex,
    @StringRes confirmRes: Int = R.string.action_confirm,
    @StringRes cancelRes: Int  = R.string.action_cancel,
) = Unit

fun callWithDefaults() {
    showError()
    showError(R.string.error_network)
    showInfo(titleRes = R.string.title_battle)
    showInfo(
        titleRes   = R.string.title_pokedex,
        confirmRes = R.string.action_add_pokemon,
        cancelRes  = R.string.action_cancel,
    )
}

// ── 7. Valeur de retour ───────────────────────────────────────────────────────

fun getScreenTitle(): Int = R.string.title_pokedex
fun getErrorLabel(): Int  = R.string.error_unknown
fun getRetryLabel(): Int  = R.string.action_retry

// ── 8. Propriété avec getter calculé ─────────────────────────────────────────

val screenTitleRes: Int get() = R.string.title_pokedex
val errorRes: Int       get() = R.string.error_unknown
val dynamicRes: Int     get() = if (true) R.string.action_confirm else R.string.action_cancel

// ── 9. Propriété lazy ─────────────────────────────────────────────────────────

val lazyTitle by lazy { R.string.title_pokedex }
val lazyError by lazy { R.string.error_network }
val lazyAction by lazy { R.string.action_start_battle }

// ── 10. Bloc init ─────────────────────────────────────────────────────────────

class ScreenManager {
    private val titleRes: Int
    private val errorRes: Int

    init {
        titleRes = R.string.title_pokedex
        errorRes = R.string.error_unknown
    }

    fun getTitle() = titleRes
}

// ── 11. Classe abstraite / override de propriété ──────────────────────────────

abstract class BaseScreen {
    abstract val titleRes: Int
    abstract val actionRes: Int
}

class PokedexVariantScreen : BaseScreen() {
    override val titleRes  = R.string.title_pokedex
    override val actionRes = R.string.action_add_pokemon
}

class BattleVariantScreen : BaseScreen() {
    override val titleRes  = R.string.title_battle
    override val actionRes = R.string.action_start_battle
}

// ── 12. if / else ─────────────────────────────────────────────────────────────

fun ifElse(isWinner: Boolean): Int =
    if (isWinner) R.string.msg_battle_won else R.string.msg_battle_lost

fun multiIf(level: Int): Int =
    if (level >= 50)      R.string.msg_battle_won
    else if (level >= 20) R.string.msg_loading
    else                  R.string.msg_battle_lost

// ── 13. Opérateur Elvis (?:) ──────────────────────────────────────────────────

fun elvis(custom: Int?): Int = custom ?: R.string.label_pokemon_name
fun elvisChain(a: Int?, b: Int?): Int = a ?: b ?: R.string.error_unknown

// ── 14. when — enum exhaustif ─────────────────────────────────────────────────

fun pokemonTypeLabel(type: PokemonType): Int = when (type) {
    PokemonType.FIRE     -> R.string.type_fire
    PokemonType.WATER    -> R.string.type_water
    PokemonType.GRASS    -> R.string.type_grass
    PokemonType.ELECTRIC -> R.string.type_electric
    PokemonType.PSYCHIC  -> R.string.type_psychic
    PokemonType.DRAGON   -> R.string.type_dragon
}

fun userRoleLabel(role: UserRole): Int = when (role) {
    UserRole.ADMIN  -> R.string.role_admin
    UserRole.EDITOR -> R.string.role_editor
    UserRole.VIEWER -> R.string.role_viewer
}

// ── 15. when — sealed class ───────────────────────────────────────────────────

sealed class AppError {
    object Network  : AppError()
    object NotFound : AppError()
    object Unknown  : AppError()
}

fun errorMessage(error: AppError): Int = when (error) {
    is AppError.Network  -> R.string.error_network
    is AppError.NotFound -> R.string.error_not_found
    is AppError.Unknown  -> R.string.error_unknown
}

// ── 16. when — conditions booléennes ─────────────────────────────────────────

fun guardedWhen(level: Int): Int = when {
    level >= 50 -> R.string.msg_battle_won
    level >= 20 -> R.string.msg_loading
    else        -> R.string.msg_battle_lost
}

// ── 17. Collections ───────────────────────────────────────────────────────────

val tabTitles = listOf(
    R.string.title_pokedex,
    R.string.title_team,
    R.string.title_battle,
    R.string.title_users,
)

val labelMap = mapOf(
    "name"  to R.string.label_pokemon_name,
    "level" to R.string.label_pokemon_level,
    "type"  to R.string.label_pokemon_type,
    "hp"    to R.string.label_pokemon_hp,
)

val actionSet = setOf(
    R.string.action_confirm,
    R.string.action_cancel,
    R.string.action_retry,
)

val tabArray    = arrayOf(R.string.title_pokedex, R.string.title_team, R.string.title_battle)
val tabIntArray = intArrayOf(R.string.title_pokedex, R.string.title_team, R.string.title_battle)

// ── 18. Sealed class avec R.string dans le constructeur ──────────────────────

sealed class Screen(val titleRes: Int, val actionRes: Int) {
    object Pokedex : Screen(R.string.title_pokedex, R.string.action_add_pokemon)
    object Team    : Screen(R.string.title_team,    R.string.action_catch_pokemon)
    object Battle  : Screen(R.string.title_battle,  R.string.action_start_battle)
    object Users   : Screen(R.string.title_users,   R.string.action_confirm)
}

// ── 19. Data class avec R.string par défaut ───────────────────────────────────

data class DialogConfig(
    @StringRes val titleRes: Int   = R.string.title_battle,
    @StringRes val messageRes: Int = R.string.msg_empty_team,
    @StringRes val confirmRes: Int = R.string.action_confirm,
    @StringRes val cancelRes: Int  = R.string.action_cancel,
)

data class ErrorConfig(
    @StringRes val labelRes: Int  = R.string.error_unknown,
    @StringRes val retryRes: Int  = R.string.action_retry,
)

// ── 20. Companion object ──────────────────────────────────────────────────────

class BattleScreen {
    companion object {
        val TITLE    = R.string.title_battle
        val ACTION   = R.string.action_start_battle
        val MSG_WIN  = R.string.msg_battle_won
        val MSG_LOSE = R.string.msg_battle_lost
        val MSG_DRAW = R.string.msg_battle_draw
    }
}

// ── 21. Singleton object ──────────────────────────────────────────────────────

object ErrorStrings {
    val NETWORK   = R.string.error_network
    val NOT_FOUND = R.string.error_not_found
    val UNKNOWN   = R.string.error_unknown
}

object ActionStrings {
    val ADD     = R.string.action_add_pokemon
    val CATCH   = R.string.action_catch_pokemon
    val RELEASE = R.string.action_release_pokemon
    val CONFIRM = R.string.action_confirm
    val CANCEL  = R.string.action_cancel
    val RETRY   = R.string.action_retry
}

// ── 22. Lambda / fonctions d'ordre supérieur ──────────────────────────────────

fun higherOrder() {
    val getTitle: () -> Int = { R.string.title_pokedex }
    val resolve: (Boolean) -> Int = { ok ->
        if (ok) R.string.action_confirm else R.string.action_cancel
    }
    val mapped   = listOf(1, 2, 3).map { R.string.label_pokemon_level }
    val filtered = tabTitles.filter { it == R.string.title_pokedex }
    tabTitles.forEach { res -> println(getString(res)) }
}

// ── 23. Gestion d'erreurs ─────────────────────────────────────────────────────

fun withErrorHandling() {
    try {
        showToast(R.string.msg_loading)
    } catch (e: IllegalStateException) {
        showError(R.string.error_network)
    } catch (e: Exception) {
        showError(R.string.error_unknown)
    } finally {
        showToast(R.string.action_retry)
    }
}

// ── 24. Fonctions d'extension ─────────────────────────────────────────────────

fun Any.showNetworkError() = showToast(R.string.error_network)
fun Any.showUnknownError() = showToast(R.string.error_unknown)
fun Any.confirmAction()    = showToast(R.string.action_confirm)

// ── 25. Appels chaînés ────────────────────────────────────────────────────────

fun chainedCalls() {
    val lower = getString(R.string.label_pokemon_name).lowercase()
    val upper = getString(R.string.error_unknown).uppercase().trim()
    val len   = getString(R.string.disclaimer_long).length
}

// ── 26. buildString ───────────────────────────────────────────────────────────

fun buildStringUsage(): String = buildString {
    append("${getString(R.string.label_pokemon_name)}: Pikachu")
    append(" | ${getString(R.string.label_pokemon_level)}: 25")
    append(" | ${getString(R.string.label_pokemon_hp)}: 100")
}

// ── 27. Varargs / spread ──────────────────────────────────────────────────────

private fun getStrings(vararg resIds: Int): List<String> = resIds.map { "#$it" }

fun varargUsage() {
    val ids = intArrayOf(R.string.title_pokedex, R.string.title_team, R.string.title_battle)
    getStrings(*ids)
    getStrings(R.string.action_confirm, R.string.action_cancel, R.string.action_retry)
}

// ── 28. Pair / Triple / infix to ──────────────────────────────────────────────

fun pairAndTriple() {
    val pair   = Pair(R.string.action_confirm, R.string.action_cancel)
    val triple = Triple(R.string.msg_battle_won, R.string.msg_battle_lost, R.string.msg_battle_draw)
    val entry  = R.string.action_confirm to R.string.action_cancel
}

// ── 29. Scope functions (run / let / also) ────────────────────────────────────

fun scopeFunctions() {
    val title  = run { R.string.title_pokedex }
    val label  = R.string.label_pokemon_name.also { showToast(it) }
    val errStr = R.string.error_unknown.let { getString(it) }
    val batch  = R.string.msg_loading.takeIf { it > 0 } ?: R.string.error_unknown
}

// ── 30. Classe valeur (inline class) ─────────────────────────────────────────

@JvmInline
value class StringResId(val id: Int)

fun valueClassUsage() {
    val title = StringResId(R.string.title_pokedex)
    val error = StringResId(R.string.error_unknown)
    val action = StringResId(R.string.action_confirm)
}

// ── 31. Edge cases ────────────────────────────────────────────────────────────

fun edgeCases() {
    // Deux refs adjacentes sans espace entre les interpolations
    val adjacent = "${R.string.action_confirm}${R.string.action_cancel}"

    // Ref dans un triple-quoted string (multiline)
    val multiline = """
        titre  : ${R.string.title_pokedex}
        action : ${R.string.action_confirm}
        erreur : ${R.string.error_unknown}
    """.trimIndent()

    // Troncature : valeur > 40 caractères → overlay avec …
    val long = R.string.disclaimer_long

    // Clé inconnue → pas de décoration (✗)
    val missing = R.string.this_key_does_not_exist

    // Plusieurs refs sur une même ligne (println)
    println("${R.string.action_confirm} / ${R.string.action_cancel} / ${R.string.action_retry}")
}
