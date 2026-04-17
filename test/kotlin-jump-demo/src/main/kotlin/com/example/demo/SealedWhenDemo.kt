package com.example.demo

// ─────────────────────────────────────────────────────────────────────────────
// DÉMO : Sealed `when` coverage CodeLens
//
// CodeLens au-dessus de chaque when(sealedValue) :
//   ✓ 3/3 branches — couverture complète
//   ⚠ 2/3 branches — branches manquantes identifiées
// ─────────────────────────────────────────────────────────────────────────────

// ── Sealed classes de démo ────────────────────────────────────────────────────

sealed class CombatResult {
    object Victory : CombatResult()
    object Defeat  : CombatResult()
    object Draw    : CombatResult()
}

sealed class LoadState {
    object Loading : LoadState()
    data class Success<T>(val data: T) : LoadState()
    data class Error(val message: String, val cause: Throwable? = null) : LoadState()
}

sealed class NetworkState {
    object Connected    : NetworkState()
    object Disconnected : NetworkState()
    object Connecting   : NetworkState()
    data class Error(val code: Int) : NetworkState()
}

sealed class PokemonAction {
    data class Catch(val pokemonId: Int) : PokemonAction()
    data class Release(val pokemonId: Int) : PokemonAction()
    data class LevelUp(val pokemonId: Int, val levels: Int) : PokemonAction()
    object ViewTeam : PokemonAction()
    object StartBattle : PokemonAction()
}

sealed class UiEvent {
    data class ShowToast(val message: String) : UiEvent()
    data class Navigate(val route: String) : UiEvent()
    object Dismiss : UiEvent()
}

// ── EXHAUSTIF ✓ 3/3 ──────────────────────────────────────────────────────────

fun describeResult(result: CombatResult): String = when (result) { // ✓ 3/3
    is CombatResult.Victory -> "You won!"
    is CombatResult.Defeat  -> "You lost…"
    is CombatResult.Draw    -> "It's a draw!"
}

fun handleLoadState(state: LoadState): String = when (state) {    // ✓ 3/3
    is LoadState.Loading    -> "Loading…"
    is LoadState.Success<*> -> "Success: ${state.data}"
    is LoadState.Error      -> "Error: ${state.message}"
}

fun networkLabel(state: NetworkState): String = when (state) {    // ✓ 4/4
    is NetworkState.Connected    -> "Online"
    is NetworkState.Disconnected -> "Offline"
    is NetworkState.Connecting   -> "Connecting…"
    is NetworkState.Error        -> "Error ${state.code}"
}

fun handleAction(action: PokemonAction): String = when (action) { // ✓ 5/5
    is PokemonAction.Catch      -> "Catching #${action.pokemonId}"
    is PokemonAction.Release    -> "Releasing #${action.pokemonId}"
    is PokemonAction.LevelUp    -> "Leveling up #${action.pokemonId} by ${action.levels}"
    is PokemonAction.ViewTeam   -> "Viewing team"
    is PokemonAction.StartBattle-> "Starting battle"
}

// ── INCOMPLET ⚠ 2/3 ──────────────────────────────────────────────────────────

fun incompleteResult(result: CombatResult): String = when (result) { // ⚠ 2/3 (Draw manquant)
    is CombatResult.Victory -> "Victory!"
    is CombatResult.Defeat  -> "Defeat…"
    // CombatResult.Draw manquant
    else -> "Unknown"
}

fun incompleteLoadState(state: LoadState): String = when (state) { // ⚠ 1/3 (Success, Error manquants)
    is LoadState.Loading -> "Loading…"
    else -> "Not loading"
}

fun incompleteNetwork(state: NetworkState) = when (state) {       // ⚠ 2/4
    is NetworkState.Connected    -> println("online")
    is NetworkState.Disconnected -> println("offline")
    else -> Unit
}

fun incompleteAction(action: PokemonAction) = when (action) {     // ⚠ 3/5
    is PokemonAction.Catch   -> println("catch")
    is PokemonAction.Release -> println("release")
    is PokemonAction.LevelUp -> println("levelup")
    // ViewTeam et StartBattle manquants
    else -> Unit
}

// ── AVEC else — compte comme couvert ──────────────────────────────────────────

fun withElse(result: CombatResult): String = when (result) {     // couvert via else
    is CombatResult.Victory -> "win"
    else                    -> "not a win"
}

fun withElseLoadState(state: LoadState) = when (state) {         // couvert via else
    is LoadState.Loading -> "loading"
    else -> "done"
}

// ── when sur une expression (pas un argument) ─────────────────────────────────

fun expressionWhen(result: CombatResult): Int {
    return when {
        result is CombatResult.Victory -> 1
        result is CombatResult.Defeat  -> -1
        else                           -> 0
    }
}

// ── Nested sealed ─────────────────────────────────────────────────────────────

sealed class NavigationScreen {
    sealed class Home : NavigationScreen() {
        object Feed    : Home()
        object Profile : Home()
    }
    sealed class Battle : NavigationScreen() {
        object Setup  : Battle()
        object Active : Battle()
        object Result : Battle()
    }
    object Settings : NavigationScreen()
}

fun screenTitle(screen: NavigationScreen): String = when (screen) {        // ✓ 3/3 top-level
    is NavigationScreen.Home    -> "Home"
    is NavigationScreen.Battle  -> "Battle"
    is NavigationScreen.Settings -> "Settings"
}

fun homeTitle(screen: NavigationScreen.Home): String = when (screen) {     // ✓ 2/2
    is NavigationScreen.Home.Feed    -> "Feed"
    is NavigationScreen.Home.Profile -> "Profile"
}

fun battleTitle(screen: NavigationScreen.Battle): String = when (screen) { // ✓ 3/3
    is NavigationScreen.Battle.Setup  -> "Setup"
    is NavigationScreen.Battle.Active -> "Battle!"
    is NavigationScreen.Battle.Result -> "Results"
}
