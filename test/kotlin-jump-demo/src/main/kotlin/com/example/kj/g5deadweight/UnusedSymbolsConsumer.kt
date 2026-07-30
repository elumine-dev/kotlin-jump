package com.example.kj.g5deadweight

/**
 * The live half of the KJ-032 fixture: what this file references stays alive,
 * what it ignores is reported.
 */
class UnusedSymbolsConsumer {

    fun badge(): String = formatBadgeLabel(3)

    fun annotated(): String = KeptSerializable("x").id
}

/** KJ-032: the only mention of GhostReflected is this literal. */
object GhostReflectionRegistry {
    val reflected = "com.example.kj.g5deadweight.GhostReflected"
}
