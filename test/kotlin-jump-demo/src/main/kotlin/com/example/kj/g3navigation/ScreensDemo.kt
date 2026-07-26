package com.example.kj.g3navigation

import androidx.compose.material.Text
import androidx.compose.runtime.Composable
import com.example.app.R
import com.example.kj.stubs.stringResource

/**
 * KJ-013 (route targets) + KJ-018 (strings → screens).
 * Each screen uses specific strings for the Reverse String Map.
 */

@Composable
fun PokedexRouteScreen(
    onOpenBattle: (Int) -> Unit,
    onOpenTeam: () -> Unit,
    onOpenSettings: () -> Unit,
) {
    // KJ-018: hover title_pokedex → "Shown on: PokedexRouteScreen (route pokedex)"
    Text(stringResource(R.string.title_pokedex))
}

@Composable
fun TeamRouteScreen(onFight: () -> Unit) {
    Text(stringResource(R.string.title_team))
}

@Composable
fun BattleRouteScreen() {
    // KJ-018: battle_cry is also used in BattleAnnouncer (not a screen).
    Text(stringResource(R.string.battle_cry))
    Text(stringResource(R.string.battle_start))
}

@Composable
fun SettingsHomeScreen(onAbout: () -> Unit) {
    Text(stringResource(R.string.settings_title))
}

@Composable
fun SettingsAboutScreen() {
    Text(stringResource(R.string.settings_about))
}

@Composable
fun OrphanScreen() {
    // KJ-013: this screen is never navigated to, orphan node expected.
    Text(stringResource(R.string.orphan_notice))
}
