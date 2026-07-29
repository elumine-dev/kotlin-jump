package com.example.kj.g5deadweight

// KJ-026 demo: private declarations that are never referenced in their file
// get a Warning + native graying + quick fixes (remove, or @Suppress).

annotation class Persisted // stand-in for a codegen-style annotation

class ReportEngine {
    private val staleCache = HashMap<String, String>() // DEAD: never read

    private val pageSize = 20 // alive: used in buildPage

    private fun legacyFormat(row: String): String { // DEAD: never called
        return row.uppercase()
    }

    private fun countdown(n: Int) { // DEAD: only calls itself
        if (n > 0) countdown(n - 1)
    }

    private fun buildPage(rows: List<String>): List<String> = rows.take(pageSize)

    fun render(rows: List<String>) = buildPage(rows).forEach(::println)
}

private class LegacyEncoder { // DEAD: top-level, never referenced
    fun encode(value: String) = value.reversed()
}

// Traps below: none of these may ever be flagged.

class Traps {
    private val label = "count" // alive: used through the "$label" template
    private fun handler(x: Int) = x + 1 // alive: ::handler reference below

    val summary = "value: $label"
    val callback = ::handler

    private operator fun invoke(): Int = 0 // alive: operator convention

    @Suppress("unused")
    private fun keptForDebug() = Unit // alive: explicit opt-out

    fun sharedTotal() = SHARED

    companion object {
        private val SHARED = 1 // alive: used from the outer class body
    }
}

@Persisted
class AnnotatedDto(val id: String) {
    private val mirror = id // alive by rule: codegen may read these properties
    private fun compute(): Int = 42 // DEAD: functions stay flaggable even here
}

class Overloads {
    private fun parse(value: Int) = value.toString() // alive: duplicate-name rule
    private fun parse(value: String) = value
    fun use() = parse(1)
}

class InitUser {
    private val helper = 1
    init { println(helper) } // alive: init blocks emit no parser symbol
}
