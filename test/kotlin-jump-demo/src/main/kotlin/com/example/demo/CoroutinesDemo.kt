@file:Suppress("unused") // demo fixture: declarations showcase other features

package com.example.demo

import com.example.data.Pokemon

// Stubs coroutines — non disponibles dans un projet JVM console
object Dispatchers {
    val IO      = "IO"
    val Main    = "Main"
    val Default = "Default"
    val Unconfined = "Unconfined"
}

class CoroutineScope(val context: Any)
class Job
class Deferred<T>(val value: T)
class Flow<T>

fun <T> CoroutineScope.launch(
    context: Any = Dispatchers.Default,
    block: suspend CoroutineScope.() -> T
): Job = Job()

fun <T> CoroutineScope.async(
    context: Any = Dispatchers.Default,
    block: suspend CoroutineScope.() -> T
): Deferred<T> = Deferred(block.toString() as T)

suspend fun <T> withContext(context: Any, block: suspend CoroutineScope.() -> T): T =
    block.toString() as T

suspend fun delay(ms: Long) = Unit

fun <T> flow(block: suspend () -> T): Flow<T> = Flow()
fun <T> Flow<T>.collect(block: (T) -> Unit) = Unit
fun <T> Flow<T>.collectOn(context: Any, block: (T) -> Unit) = Unit

val viewModelScope = CoroutineScope(Dispatchers.Main)
val lifecycleScope = CoroutineScope(Dispatchers.Main)

// ─────────────────────────────────────────────────────────────────────────────
// DÉMO : suspend call marker (⚡) + Coroutine dispatcher badge
//
// suspend fun → ⚡ avant chaque appel
// withContext(Dispatchers.XX) → badge inline du dispatcher
// launch/async avec contexte → badge dispatcher
// ─────────────────────────────────────────────────────────────────────────────

// ── Fonctions suspend à marquer ⚡ ────────────────────────────────────────────

suspend fun fetchAllPokemon(): List<Pokemon> = withContext(Dispatchers.IO) {    // 🧵 IO
    emptyList()
}

suspend fun fetchPokemonById(id: Int): Pokemon? = withContext(Dispatchers.IO) { // 🧵 IO
    null
}

suspend fun savePokemon(pokemon: Pokemon) = withContext(Dispatchers.IO) {       // 🧵 IO
    Unit
}

suspend fun deletePokemon(id: Int) = withContext(Dispatchers.IO) {              // 🧵 IO
    Unit
}

suspend fun updateUi(block: () -> Unit) = withContext(Dispatchers.Main) {       // 🖥 Main
    block()
}

suspend fun heavyComputation(data: List<Int>): Int = withContext(Dispatchers.Default) { // ⚙ Default
    data.sum()
}

suspend fun delay100() {
    delay(100)   // ⚡ (stdlib suspend)
}

// ── Dispatcher badges — withContext ───────────────────────────────────────────

fun dispatcherBadgesWithContext() {
    val scope = CoroutineScope(Dispatchers.Main)

    scope.launch {
        withContext(Dispatchers.IO) { }         // 🧵 IO
        withContext(Dispatchers.Main) { }       // 🖥 Main
        withContext(Dispatchers.Default) { }    // ⚙ Default
        withContext(Dispatchers.Unconfined) { } // ∞ Unconfined
    }
}

// ── Dispatcher badges — launch / async ────────────────────────────────────────

fun dispatcherBadgesLaunch() {
    val scope = CoroutineScope(Dispatchers.Main)

    scope.launch(Dispatchers.IO) { }            // 🧵 IO
    scope.launch(Dispatchers.Main) { }          // 🖥 Main
    scope.launch(Dispatchers.Default) { }       // ⚙ Default

    scope.async(Dispatchers.IO) { "result" }    // 🧵 IO
    scope.async(Dispatchers.Default) { 42 }     // ⚙ Default

    viewModelScope.launch(Dispatchers.IO) { }   // 🧵 IO
    viewModelScope.launch(Dispatchers.Main) { } // 🖥 Main
    lifecycleScope.launch(Dispatchers.Default) { } // ⚙ Default
}

// ── Call sites avec ⚡ ────────────────────────────────────────────────────────

fun callSitesWithSuspendMarkers() {
    val scope = CoroutineScope(Dispatchers.Main)

    scope.launch {
        val allPokemon = fetchAllPokemon()           // ⚡
        val pokemon    = fetchPokemonById(1)         // ⚡
        delay(500)                                   // ⚡
        savePokemon(allPokemon.first())              // ⚡
        delay(100)                                   // ⚡

        val count = heavyComputation(listOf(1,2,3)) // ⚡
        updateUi { println("Done: $count") }        // ⚡
    }
}

// ── Chaîne withContext imbriquée ──────────────────────────────────────────────

suspend fun nestedDispatchers(): String = withContext(Dispatchers.IO) {         // 🧵 IO
    val data = fetchAllPokemon()                    // ⚡
    withContext(Dispatchers.Default) {              // ⚙ Default
        val processed = data.map { it.name }
        withContext(Dispatchers.Main) {             // 🖥 Main
            processed.joinToString()
        }
    }
}

// ── async/await pattern ───────────────────────────────────────────────────────

suspend fun parallelFetch(): Pair<List<Pokemon>, Pokemon?> {
    val scope = CoroutineScope(Dispatchers.IO)      // 🧵 IO

    val allDeferred  = scope.async(Dispatchers.IO) { fetchAllPokemon() }    // 🧵 IO
    val oneDeferred  = scope.async(Dispatchers.IO) { fetchPokemonById(1) }  // 🧵 IO

    delay(10)                                       // ⚡
    return Pair(allDeferred.value, oneDeferred.value)
}

// ── ViewModel-style usage ─────────────────────────────────────────────────────

class PokemonViewModel {

    fun loadData() {
        viewModelScope.launch(Dispatchers.IO) {     // 🧵 IO
            val pokemon = fetchAllPokemon()          // ⚡
            withContext(Dispatchers.Main) {          // 🖥 Main
                println("Loaded: ${pokemon.size}")
            }
        }
    }

    fun refresh() {
        viewModelScope.launch {
            val data = withContext(Dispatchers.IO) { // 🧵 IO
                fetchAllPokemon()                    // ⚡
            }
            withContext(Dispatchers.Default) {       // ⚙ Default
                val names = data.map { it.name }
                println(names)
            }
        }
    }

    suspend fun getTeamAsync(): List<Pokemon> = withContext(Dispatchers.IO) {  // 🧵 IO
        delay(100)                                  // ⚡
        fetchAllPokemon()                           // ⚡
    }
}
