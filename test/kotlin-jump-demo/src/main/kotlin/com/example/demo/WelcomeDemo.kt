package com.example.demo

import com.example.data.Pokemon

// ── Open this file · Kotlin Jump lights up every declaration with code lenses ──

interface GymChallenge {
    fun accept(challenger: Trainer): ChallengeOutcome
    fun reward(): Badge
    fun gymName(): String
}

sealed class ChallengeOutcome {
    data class Victory(val winner: Trainer, val prize: Badge) : ChallengeOutcome()
    data class Defeat(val loser: Trainer, val retries: Int)   : ChallengeOutcome()
    data object Draw                                          : ChallengeOutcome()
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
        if (challenger.team.isEmpty()) ChallengeOutcome.Draw
        else ChallengeOutcome.Victory(challenger, Badge.Boulder)
    override fun reward() = Badge.Boulder
    override fun gymName() = "Pewter City Gym"
}

class CeruleanGym : GymChallenge {
    override fun accept(challenger: Trainer) =
        if (challenger.team.size < 2) ChallengeOutcome.Defeat(challenger, 1)
        else ChallengeOutcome.Victory(challenger, Badge.Cascade)
    override fun reward() = Badge.Cascade
    override fun gymName() = "Cerulean City Gym"
}

class VermilionGym : GymChallenge {
    override fun accept(challenger: Trainer) =
        if (challenger.badges.contains(Badge.Cascade)) ChallengeOutcome.Victory(challenger, Badge.Thunder)
        else ChallengeOutcome.Defeat(challenger, 2)
    override fun reward() = Badge.Thunder
    override fun gymName() = "Vermilion City Gym"
}
