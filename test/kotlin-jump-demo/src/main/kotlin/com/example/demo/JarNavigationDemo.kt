package com.example.demo

import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.runBlocking

// Cmd+Click on `runBlocking` or `MutableStateFlow` below →
// jumps into the kotlinx.coroutines JAR source (Builders.kt /
// StateFlow.kt). Both are real top-level kotlinx symbols with no
// local stub in this workspace, so the regex resolver lands cleanly
// in the JAR's KDoc-rich source instead of a fake declaration.
class PokemonCounterService {

    val counter = MutableStateFlow(0)

    fun loadInitial(): Int = runBlocking {
        counter.value = 151
        counter.value
    }
}
