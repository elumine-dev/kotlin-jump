package com.example.kj.g1edition

import com.example.kj.stubs.Log
import com.example.kj.stubs.PokemonApi

/**
 * KJ-006: surround with… (Cmd+Alt+T).
 * Select the given lines, then apply the template.
 */
object SurroundWithDemo {

    private val api = PokemonApi()

    suspend fun scenarios(retries: Int) {
        // 1. Select the next 2 lines → Surround with try/catch.
        //    Expected: try { } catch (e: Exception) { } block, indentation
        //    kept, cursor inside the catch.
        val fetched = api.fetchPokemon(25)
        Log.d("KJ006", fetched)

        // 2. Select PART of the line (just the call) → Surround with let.
        //    Expected: the selection becomes .let { } without breaking the val.
        val name = api.fetchPokemon(1)

        // 3. Multi-line selection, mixed indentation → Surround with if.
        //    Expected: consistent re-indentation of the whole block.
        var total = 0
        for (i in 0 until retries) {
                total += i
            total -= 1
        }

        // 4. Empty selection (cursor alone on the next line) → expected:
        //    the action expands to the full line.
        println("surround me: $name $total")
    }
}
