package com.example.demo

import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

// Cmd+Click on any coroutine function below → jumps into the kotlinx.coroutines JAR source.
// Try: launch, withContext, delay, Dispatchers.IO
class PokemonSyncService {

    private val scope = CoroutineScope(Dispatchers.Default)

    fun syncPokedex(onComplete: (Int) -> Unit) {
        scope.launch {
            val count = withContext(Dispatchers.IO) {
                delay(100)
                fetchFromServer()
            }
            onComplete(count)
        }
    }

    private suspend fun fetchFromServer(): Int = 151
}
