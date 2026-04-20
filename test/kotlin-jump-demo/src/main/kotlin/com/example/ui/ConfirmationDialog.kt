package com.example.ui

import com.example.data.Pokemon

/**
 * Single-responsibility helper for user-facing removal confirmation.
 * Extracted from PokedexScreen so the UI surface stays composition-friendly.
 */
object ConfirmationDialog {
    fun show(pokemon: Pokemon) {
        println("${pokemon.name} removed from the team.")
    }
}
