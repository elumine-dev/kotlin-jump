package com.example.demo

import com.example.data.Pokemon

// ── Note : anonymous objects sont indexés ────────────────────────────────────
//
// PokemonObserver a 1 implémentation nommée (AuditObserver) + 1 anonyme.
// Code lens affiche "2 implementations" — les deux sont comptés.
// Le parser émet un symbole synthétique $anon$N pour chaque `object : Interface`.

interface PokemonObserver {
    fun onCaught(pokemon: Pokemon)
    fun onReleased(pokemon: Pokemon)
}

// Implémentation nommée — indexée → comptée dans "1 implementation"
class AuditObserver : PokemonObserver {
    private val log = mutableListOf<String>()
    override fun onCaught(pokemon: Pokemon)   { log.add("Caught: ${pokemon.name}") }
    override fun onReleased(pokemon: Pokemon) { log.add("Released: ${pokemon.name}") }
    fun getLog() = log.toList()
}

// ── Limitation C : Go to Implementation depuis un call site ──────────────────
//
// `observer.onCaught(pokemon)` est un call site.
// • Cmd+Click → PokemonObserver.onCaught (déclaration de l'interface) ✅ correct
// • Clic droit → "Go to Implementation" → rien ❌ (fonctionne seulement
//   depuis la déclaration, pas depuis un call site)

class PokemonTrainer(private val observer: PokemonObserver) {

    fun processCatch(pokemon: Pokemon) {
        observer.onCaught(pokemon)   // ← tester C ici : clic droit → Go to Implementation
    }

    fun processRelease(pokemon: Pokemon) {
        observer.onReleased(pokemon)
    }

    fun catchWithSilentObserver(pokemon: Pokemon) {
        val silent = object : PokemonObserver {        // ← objet anonyme non indexé (B)
            override fun onCaught(pokemon: Pokemon)   { /* silent */ }
            override fun onReleased(pokemon: Pokemon) { /* silent */ }
        }
        silent.onCaught(pokemon)
    }
}
