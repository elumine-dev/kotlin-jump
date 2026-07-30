package com.example.kj.g5deadweight

/**
 * KJ-032: top-level declarations nothing in the workspace references.
 *
 * The first cross-file detector of the family. Everything below is either
 * proven dead or kept alive by a reference somewhere else in this project.
 */

// Dead: declared here, named nowhere else in the workspace.
class GhostMapper {
    fun map(input: String): String = input.uppercase()
}

// Dead: a top-level function nobody calls.
fun buildGhostReport(rows: List<String>): String = rows.joinToString("\n")

// Dead: a top-level property nobody reads.
val ghostTimeoutMs = 5_000

// Alive: UnusedSymbolsConsumer calls it.
fun formatBadgeLabel(count: Int): String = "$count items"

// Alive: an operator is called as `a + b`, so its name never appears at the
// call site. Flagging it would delete compiling code.
operator fun String.plus(times: Int): String = this.repeat(times)
