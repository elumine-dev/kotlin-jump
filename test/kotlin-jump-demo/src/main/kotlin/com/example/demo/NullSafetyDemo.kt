package com.example.demo

import com.example.data.Pokemon

// ─────────────────────────────────────────────────────────────────────────────
// DÉMO : !! non-null assertion highlight + Dead code fading
//
// !! → surligné en amber/orange
// !! dans un commentaire ou une string → NE PAS surligner (✗)
// Code mort (après return/throw sans condition) → atténué visuellement
// ─────────────────────────────────────────────────────────────────────────────

data class User(val id: Int, val name: String, val email: String?)
data class Response<T>(val data: T?, val error: String?)
data class Node(val value: Int, val next: Node?)

// ── 1. Cas simples — !! à surligner ──────────────────────────────────────────

fun getPokemonName(pokemon: Pokemon?): String {
    return pokemon!!.name       // !! surligné
}

fun getEmail(user: User?): String {
    return user!!.email!!       // deux !! sur la même ligne
}

fun getFirst(list: List<Pokemon>?): Pokemon {
    return list!!.first()       // !! surligné
}

fun getNodeValue(node: Node?): Int {
    return node!!.next!!.value  // deux !! chaînés
}

// ── 2. !! dans des affectations ──────────────────────────────────────────────

fun assignments(user: User?, pokemon: Pokemon?) {
    val name  = user!!.name          // !!
    val email = user!!.email!!       // deux !!
    val id    = pokemon!!.id         // !!
    val level = pokemon!!.level      // !!
}

// ── 3. !! dans des conditions ────────────────────────────────────────────────

fun conditions(response: Response<List<Pokemon>>?) {
    if (response!!.data != null) {          // !!
        val first = response.data!!.first() // !!
        println(first.name)
    }

    val isValid = response!!.error == null  // !!
    val count   = response.data!!.size      // !!
}

// ── 4. !! dans des appels de fonction ────────────────────────────────────────

fun functionCalls(pokemon: Pokemon?, list: List<String>?) {
    println(pokemon!!.name)          // !!
    val upper = pokemon!!.name.uppercase()  // !!
    val len   = list!!.size          // !!
    list!!.forEach { println(it) }   // !!
}

// ── 5. !! dans un return ─────────────────────────────────────────────────────

fun findById(id: Int, list: List<Pokemon>?): Pokemon {
    return list!!.first { it.id == id }  // !!
}

fun getOrThrow(map: Map<String, Pokemon>?, key: String): Pokemon {
    return map!!.getValue(key)  // !!
}

// ── 6. NE PAS surligner — !! dans des commentaires (✗) ───────────────────────

// !! dans un commentaire → pas de surligné
// val x = y!! → ne pas décorer ici car c'est dans un commentaire
/*
 * Attention !! Ne jamais utiliser l'opérateur !! en production
 * result!!.value est dangereux
 */

// ── 7. NE PAS surligner — !! dans des strings (✗) ────────────────────────────

fun stringLiterals() {
    val warning  = "Attention !! valeur nulle"          // (✗) dans string
    val message  = "Do not use !! operator here"        // (✗) dans string
    val docNote  = "!! This will crash if null"         // (✗) dans string
    val template = "Error!! Please check your input"    // (✗) dans string
}

fun tripleQuotedStrings() {
    val doc = """
        AVERTISSEMENT !!
        Ne jamais utiliser l'opérateur !! en production.
        val x = y!! peut causer des NullPointerException.
    """.trimIndent()                                     // (✗) dans triple-quoted
}

// ── 8. Dead code — après return inconditionnel ────────────────────────────────

fun earlyReturn(x: Int): String {
    if (x < 0) return "negative"
    return "positive"
    println("unreachable après return")   // dead code
    val unused = 42                        // dead code
}

fun alwaysReturns(flag: Boolean): Int {
    if (flag) {
        return 1
    } else {
        return 2
    }
    return 3  // dead code — tous les chemins ont déjà un return
}

fun throwsAlways(): Nothing {
    throw IllegalStateException("always throws")
    println("unreachable après throw")    // dead code
}

fun whenExhaustive(x: Boolean): String {
    return when (x) {
        true  -> "yes"
        false -> "no"
    }
    println("unreachable — when exhaustif")  // dead code
}

// ── 9. Cas limites ────────────────────────────────────────────────────────────

fun edgeCases(a: String?, b: String?, c: List<String>?) {
    // Multiple !! sur une seule expression
    val result = a!!.trim().uppercase().also { println(it) }  // !!

    // !! dans une lambda
    val lengths = c!!.map { it!!.length }    // deux !!

    // !! dans une interpolation
    val msg = "Name: ${a!!}"               // !!
    val msg2 = "${a!!} and ${b!!}"         // deux !!

    // !! dans une condition ternaire (Elvis)
    val safe = a ?: b!!                    // !!
}
