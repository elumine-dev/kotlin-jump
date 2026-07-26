package com.example.kj.g5deadweight

// KJ-009: Unused import graying. Expected per line:
import com.example.data.Pokemon          // used
import com.example.data.User             // ⚠ dead
import com.example.kj.stubs.Log          // used
import com.example.kj.stubs.WakeLock as Lantern   // live alias
import com.example.kj.stubs.Intent as Unused      // ⚠ dead alias
import kotlinx.coroutines.flow.*         // wildcard: never flagged
import kotlinx.coroutines.sync.Mutex     // ⚠ dead

/**
 * Trap: "User" shows up in THIS comment and in the string below,
 * but never in code, so the import must stay grayed out.
 */
object UnusedImportsDemo {

    private val lamp = Lantern()
    private val state = MutableStateFlow(0)

    fun inspect(pokemon: Pokemon) {
        Log.d(tag = "KJ009", msg = "name=${pokemon.name} state=${state.value}")
        lamp.acquire()
    }
}
