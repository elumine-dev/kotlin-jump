package com.example.kj.g4runtime

import com.example.kj.stubs.PokemonApi
import com.example.kj.stubs.ViewBinding
import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.flow
import kotlinx.coroutines.flow.flowOn
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/**
 * KJ-019: Dispatcher Lens.
 * Expected gutters: "IO" / "Main" / "Default" on the block lines,
 * soft hints (never red) on the lines marked ⚠.
 */
class DispatcherLensDemo(
    private val api: PokemonApi,
    private val binding: ViewBinding,
    private val scope: CoroutineScope,
    // Injected dispatcher. Expected: NO gutter in the blocks that use it
    // (value not known statically, stay conservative).
    private val injected: CoroutineDispatcher,
) {

    suspend fun loadRoster() {
        withContext(Dispatchers.IO) {
            // "IO" gutter expected on these lines.
            val data = api.fetchPokemon(25)

            // ⚠ hint expected: binding (View) access inside an IO scope.
            binding.title.setText(data)

            withContext(Dispatchers.Main) {
                // Nesting: nearest one wins, so "Main" gutter here.
                binding.subtitle.setText(data)
            }
        }
    }

    fun refreshOnMain() {
        scope.launch(Dispatchers.Main) {
            // "Main" gutter expected.
            // ⚠ hint expected: network call (api.fetch…) in an explicit Main scope.
            val heavy = api.fetchPokemon(150)
            binding.title.setText(heavy)
        }
    }

    fun computeStats() {
        scope.launch(Dispatchers.Default) {
            // "Default" gutter expected. Pure compute, no hint.
            (1..1_000_000).sum()
        }
    }

    fun streamEvents() = flow {
        // flowOn: "IO" gutter expected on the flow block.
        emit(api.fetchPokemon(1))
    }.flowOn(Dispatchers.IO)

    suspend fun withInjected() {
        withContext(injected) {
            // Expected: NO gutter (dispatcher not resolvable).
            api.fetchPokemon(7)
        }
    }
}
