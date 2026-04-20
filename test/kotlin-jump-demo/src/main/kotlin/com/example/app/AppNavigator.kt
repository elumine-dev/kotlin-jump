package com.example.app

import com.example.ui.PokedexScreen
import com.example.ui.UserScreen

enum class Screen { POKEDEX, USERS }

class AppNavigator(
    private val pokedex: PokedexScreen,
    private val users: UserScreen,
) {
    var current: Screen = Screen.POKEDEX
        private set

    fun navigate(target: Screen) {
        current = target
        when (target) {
            Screen.POKEDEX -> pokedex.render()
            Screen.USERS   -> users.render()
        }
    }
}
