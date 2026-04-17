package com.example.demo

import com.example.app.R

// ─────────────────────────────────────────────────────────────────────────────
// DÉMO : R.plurals.* et R.array.* — folding + hover
//
// R.plurals.xxx → affiche la forme "other" (ex: "%d Pokémon")
// R.array.xxx   → affiche les éléments joints (ex: "[Fire, Water, …]")
// ─────────────────────────────────────────────────────────────────────────────

private fun getQuantityString(resId: Int, quantity: Int): String = "#$resId($quantity)"
private fun getStringArray(resId: Int): Array<String> = arrayOf("#$resId")

// ── 1. Propriétés top-level ───────────────────────────────────────────────────

val POKEMON_COUNT_PLURAL = R.plurals.pokemon_count
val BATTLE_WINS_PLURAL   = R.plurals.battle_wins
val ITEM_COUNT_PLURAL    = R.plurals.item_count

val POKEMON_TYPES_ARRAY  = R.array.pokemon_types
val USER_ROLES_ARRAY     = R.array.user_roles
val DIFFICULTY_ARRAY     = R.array.difficulty_levels

// ── 2. val / var locaux ───────────────────────────────────────────────────────

fun pluralLocal() {
    val countRes  = R.plurals.pokemon_count
    val winsRes   = R.plurals.battle_wins
    val itemsRes  = R.plurals.item_count

    val typesRes  = R.array.pokemon_types
    val rolesRes  = R.array.user_roles
    val diffRes   = R.array.difficulty_levels
}

// ── 3. Utilisation directe ────────────────────────────────────────────────────

fun directUsage(count: Int) {
    val pokemonMsg = getQuantityString(R.plurals.pokemon_count, count)
    val winsMsg    = getQuantityString(R.plurals.battle_wins, count)
    val itemsMsg   = getQuantityString(R.plurals.item_count, count)

    val types      = getStringArray(R.array.pokemon_types)
    val roles      = getStringArray(R.array.user_roles)
    val difficulty = getStringArray(R.array.difficulty_levels)
}

// ── 4. Interpolation ─────────────────────────────────────────────────────────

fun interpolation(count: Int) {
    val msg1 = "Compteur : ${R.plurals.pokemon_count}"
    val msg2 = "Types : ${R.array.pokemon_types}"
    val msg3 = "${R.plurals.battle_wins} / ${R.plurals.item_count}"
    println("Array: ${R.array.pokemon_types}, Plural: ${R.plurals.pokemon_count}")
}

// ── 5. Paramètres par défaut ──────────────────────────────────────────────────

fun showCount(
    pluralRes: Int = R.plurals.pokemon_count,
    count: Int     = 0,
) = getQuantityString(pluralRes, count)

fun showList(
    arrayRes: Int  = R.array.pokemon_types,
) = getStringArray(arrayRes)

// ── 6. Valeur de retour ───────────────────────────────────────────────────────

fun getPokemonCountRes(): Int  = R.plurals.pokemon_count
fun getBattleWinsRes(): Int    = R.plurals.battle_wins
fun getTypesArrayRes(): Int    = R.array.pokemon_types
fun getRolesArrayRes(): Int    = R.array.user_roles

// ── 7. when ───────────────────────────────────────────────────────────────────

fun pluralForCategory(category: String): Int = when (category) {
    "pokemon" -> R.plurals.pokemon_count
    "battles" -> R.plurals.battle_wins
    "items"   -> R.plurals.item_count
    else      -> R.plurals.item_count
}

fun arrayForCategory(category: String): Int = when (category) {
    "types"      -> R.array.pokemon_types
    "roles"      -> R.array.user_roles
    "difficulty" -> R.array.difficulty_levels
    else         -> R.array.pokemon_types
}

// ── 8. Collections ────────────────────────────────────────────────────────────

val allPlurals = listOf(
    R.plurals.pokemon_count,
    R.plurals.battle_wins,
    R.plurals.item_count,
)

val allArrays = listOf(
    R.array.pokemon_types,
    R.array.user_roles,
    R.array.difficulty_levels,
)

val pluralMap = mapOf(
    "pokemon" to R.plurals.pokemon_count,
    "wins"    to R.plurals.battle_wins,
    "items"   to R.plurals.item_count,
)

val arrayMap = mapOf(
    "types"  to R.array.pokemon_types,
    "roles"  to R.array.user_roles,
    "diff"   to R.array.difficulty_levels,
)

// ── 9. Data class ────────────────────────────────────────────────────────────

data class CounterConfig(
    val singlePluralRes: Int  = R.plurals.pokemon_count,
    val winsPluralRes: Int    = R.plurals.battle_wins,
    val typesArrayRes: Int    = R.array.pokemon_types,
)

// ── 10. Companion object ──────────────────────────────────────────────────────

class ResourceRefs {
    companion object {
        val POKEMON_PLURAL = R.plurals.pokemon_count
        val TYPES_ARRAY    = R.array.pokemon_types
        val ROLES_ARRAY    = R.array.user_roles
    }
}

// ── 11. Scope functions ───────────────────────────────────────────────────────

fun scopeUsage() {
    val p = run { R.plurals.pokemon_count }
    val a = R.array.pokemon_types.also { println("types array: $it") }
    val m = R.plurals.battle_wins.let { getQuantityString(it, 5) }
}

// ── 12. Edge cases ────────────────────────────────────────────────────────────

fun pluralEdgeCases() {
    // Plusieurs refs sur une même ligne
    println("${R.plurals.pokemon_count} / ${R.array.pokemon_types}")

    // Clés inconnues → pas de décoration (✗)
    val missingPlural = R.plurals.this_plural_does_not_exist
    val missingArray  = R.array.this_array_does_not_exist
}
