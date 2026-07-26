package com.example.kj.g3navigation

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.material.Button
import androidx.compose.material.Text
import androidx.compose.runtime.Composable

/** KJ-015: Compose Outline Tree. Caret in a composable, the view maps the UI. */

@Composable
fun BattleDashboard(loading: Boolean, weather: String, team: List<String>) {
    Column {
        TrainerBadge(hp = 87)

        if (loading) {
            LoadingPanel()
        } else {
            ArenaPanel()
        }

        when (weather) {
            "sun" -> SunnyBanner()
            "rain" -> RainBanner()
            else -> Text("Clear skies")
        }

        RosterList(team)
    }
    RematchTree(depth = 3)
}

@Composable
fun TrainerBadge(hp: Int) {
    Row {
        Text("Ash")
        HpBar(hp)
    }
}

@Composable fun HpBar(value: Int) { Text("HP $value") }
@Composable fun LoadingPanel() { Text("Loading…") }
@Composable fun ArenaPanel() { Text("Arena") }
@Composable fun SunnyBanner() { Text("Harsh sunlight!") }
@Composable fun RainBanner() { Text("It's raining!") }

@Composable
fun RosterList(team: List<String>) {
    Column {
        // Slot lambda + loop. Expected: PokemonSlot suffixed with ×items.
        team.forEach { name ->
            PokemonSlot(name)
        }
    }
}

@Composable
fun PokemonSlot(name: String) {
    Button(onClick = {}) { Text(name) }
}

@Composable
fun RematchTree(depth: Int) {
    // Recursion. Expected: the panel cuts the cycle (↺ marker, no infinite loop).
    if (depth > 0) {
        Text("Round $depth")
        RematchTree(depth - 1)
    }
}
