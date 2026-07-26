package com.example.kj.g2resources

import com.example.app.R

/**
 * KJ-018: Reverse String Map, NON-composable usage side.
 * `battle_cry` is used here (class) AND in BattleRouteScreen (routed screen).
 * Hover R.string.battle_cry or its strings.xml entry. Expected:
 * "Shown on: BattleRouteScreen (route battle/{pokemonId}) · Also used
 * in: BattleAnnouncer" (a non-screen shows the class name).
 */
class BattleAnnouncer {
    fun announce(): Int = R.string.battle_cry
}
