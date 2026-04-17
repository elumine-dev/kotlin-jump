package com.example.demo

import com.example.data.Pokemon

// ── Limitation A : abstract class methods ────────────────────────────────────
//
// Code lens sur `execute` et `describe` affiche "N usages" au lieu de
// "N implementations" — car l'extension ne traite que `enclosingKind === 'interface'`.
// En comparaison : PokemonRepository.catch affiche "1 implementation".
//
// Cmd+Click sur `override fun execute` dans PhysicalMove ou SpecialMove
// navigue vers MoveStrategy.execute. ✅

abstract class MoveStrategy {
    abstract fun execute(attacker: Pokemon, defender: Pokemon): Int
    abstract fun describe(): String
    fun isEffective(damage: Int) = damage > 0
}

class PhysicalMove(private val power: Int) : MoveStrategy() {
    override fun execute(attacker: Pokemon, defender: Pokemon): Int = attacker.level * power
    override fun describe() = "Physical attack (power=$power)"
}

class SpecialMove(private val element: String) : MoveStrategy() {
    override fun execute(attacker: Pokemon, defender: Pokemon): Int = attacker.level * 3
    override fun describe() = "Special $element attack"
}
