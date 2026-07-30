package com.example.kj.g5deadweight

/** Alive only through an aliased import. */
class GhostAliased

/** Alive only through a fully qualified call with no import. */
class GhostQualified {
    fun tag(): String = "qualified"
}
