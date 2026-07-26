package com.example.kj.g3navigation

/**
 * KJ-013: routes as constants. NavigationIndex must resolve
 * Routes.TEAM through the const val index, not only inline literals.
 */
object Routes {
    const val POKEDEX = "pokedex"
    const val TEAM = "team"
    const val BATTLE = "battle/{pokemonId}"
    const val SETTINGS_GRAPH = "settings_graph"
    const val SETTINGS_HOME = "settings/home"
    const val SETTINGS_ABOUT = "settings/about"
}
