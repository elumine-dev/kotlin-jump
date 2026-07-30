package com.example.kj.g5deadweight

import com.example.kj.g5deadweight.GhostAliased as Spirit

/**
 * KJ-032: reference forms that a per-symbol usage scan misses.
 */
class UnusedSymbolsIndirect {

    // The simple name GhostAliased never appears at this call site, only the
    // alias does. Missing this deletes a class the project still compiles on.
    fun aliased(): Spirit = Spirit()

    // Fully qualified, no import, different style: a reachability prefilter
    // built from imports would skip this file entirely.
    fun qualified(): String = com.example.kj.g5deadweight.GhostQualified().tag()
}
