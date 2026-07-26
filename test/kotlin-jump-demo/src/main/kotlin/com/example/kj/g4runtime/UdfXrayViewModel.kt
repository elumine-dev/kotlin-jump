package com.example.kj.g4runtime

import androidx.compose.material.Text
import androidx.compose.runtime.Composable
import com.example.kj.stubs.LiveData
import com.example.kj.stubs.MutableLiveData
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.StateFlow
import com.example.kj.stubs.collectAsState
import kotlinx.coroutines.flow.asSharedFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update

/**
 * KJ-014: UDF X-Ray (who writes / who reads).
 * Lens expected on every state property, see the counts in each comment.
 */
class BattleXrayViewModel {

    // Expected: "✎ 3 writes · 👁 2 readers"
    // (2 direct here + 1 indirect via applyPotion; read by BattleHud + HpDebugPanel).
    private val _hp = MutableStateFlow(100)
    val hp: StateFlow<Int> = _hp.asStateFlow()

    // Expected: "✎ 1 write · 👁 1 reader" via postValue / observe.
    private val _combatLog = MutableLiveData("ready")
    val combatLog: LiveData<String> = _combatLog

    // Events, expected: "✎ 1 emission · 👁 1 collector".
    private val _events = MutableSharedFlow<String>(extraBufferCapacity = 8)
    val events: SharedFlow<String> = _events.asSharedFlow()

    // Anti-pattern: exposed WITHOUT a private backing. Expected: lens anyway,
    // with the external writes counted.
    val ticker = MutableStateFlow(0)

    // Backing never exposed. Expected: lens "👁 0 readers" (likely dead code).
    private val _secretBuff = MutableStateFlow(1.0)

    fun takeDamage(amount: Int) {
        _hp.value = (_hp.value - amount).coerceAtLeast(0)
        _events.tryEmit("damage:$amount")
        _combatLog.postValue("hit for $amount")
    }

    fun heal(amount: Int) {
        _hp.update { it + amount }
    }

    // Indirect write (1 level). Expected: counted in the _hp lens.
    fun applyPotion() = heal(20)
}

@Composable
fun BattleHud(viewModel: BattleXrayViewModel) {
    // Reader #1 of hp.
    val hp = viewModel.hp.collectAsState()
    Text("HP: $hp")
}

@Composable
fun HpDebugPanel(viewModel: BattleXrayViewModel) {
    // Reader #2 of hp, plus the LiveData reader.
    val hp = viewModel.hp.collectAsState()
    viewModel.combatLog.observe { entry -> println(entry) }
    Text("debug hp=$hp")
}

// The event collector promised by the _events comment:
// "1 emission · 1 collector".
suspend fun observeBattleEvents(viewModel: BattleXrayViewModel) {
    viewModel.events.collect { event -> println("event: $event") }
}
