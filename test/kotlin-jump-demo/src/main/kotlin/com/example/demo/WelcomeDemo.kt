package com.example.demo

import com.example.data.Pokemon

// ── Open this file · Kotlin Jump lights up every declaration with code lenses ──

interface GymChallenge {
    fun accept(challenger: Trainer): BattleOutcome
    fun reward(): Badge
    fun gymName(): String
}

sealed class BattleOutcome {
    data class Victory(val winner: Trainer, val prize: Badge) : BattleOutcome()
    data class Defeat(val loser: Trainer, val retries: Int)   : BattleOutcome()
    data object Draw                                          : BattleOutcome()
}

enum class Badge {
    Boulder, Cascade, Thunder, Rainbow, Soul, Marsh, Volcano, Earth;
    val gymNumber get() = ordinal + 1
}

data class Trainer(
    val id: Int,
    val name: String,
    val badges: Set<Badge> = emptySet(),
    val team: List<Pokemon> = emptyList(),
) {
    val isChampion get() = badges.size == Badge.entries.size
    fun canChallenge(gym: GymChallenge) = team.isNotEmpty()
}

class PewterGym : GymChallenge {
    override fun accept(challenger: Trainer) =
        if (challenger.team.isEmpty()) BattleOutcome.Draw
        else BattleOutcome.Victory(challenger, Badge.Boulder)
    override fun reward() = Badge.Boulder
    override fun gymName() = "Pewter City Gym"
}

class CeruleanGym : GymChallenge {
    override fun accept(challenger: Trainer) =
        if (challenger.team.size < 2) BattleOutcome.Defeat(challenger, 1)
        else BattleOutcome.Victory(challenger, Badge.Cascade)
    override fun reward() = Badge.Cascade
    override fun gymName() = "Cerulean City Gym"
}

class VermilionGym : GymChallenge {
    override fun accept(challenger: Trainer) =
        if (challenger.badges.contains(Badge.Cascade)) BattleOutcome.Victory(challenger, Badge.Thunder)
        else BattleOutcome.Defeat(challenger, 2)
    override fun reward() = Badge.Thunder
    override fun gymName() = "Vermilion City Gym"
}
