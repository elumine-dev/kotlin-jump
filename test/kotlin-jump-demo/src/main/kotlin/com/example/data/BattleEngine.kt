package com.example.data

/**
 * Determines the outcome of a battle between two Pokemon.
 * Type advantage is checked first; level is the tiebreaker; equal level → Draw.
 */
class BattleEngine {
    fun fight(attacker: Pokemon, defender: Pokemon): BattleResult = when {
        attacker.type.isStrongAgainst(defender.type) -> BattleResult.Victory(attacker)
        defender.type.isStrongAgainst(attacker.type) -> BattleResult.Defeat(attacker)
        attacker.level > defender.level              -> BattleResult.Victory(attacker)
        defender.level > attacker.level              -> BattleResult.Defeat(attacker)
        else                                         -> BattleResult.Draw
    }
}
