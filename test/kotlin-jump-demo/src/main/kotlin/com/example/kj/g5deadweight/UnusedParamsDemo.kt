package com.example.kj.g5deadweight

// KJ-025 demo: unused parameters get a Warning + native graying + a quick fix
// that removes the parameter at the declaration AND at every call site.

class ReportService(
    name: String,
    retryCount: Int,
    private val wallClock: java.time.Clock,
    private val logger: StringBuilder,
) {
    val title = "Report for $name" // simple template: counts as a usage of `name`

    private fun render(rows: List<Int>, verbose: Boolean) {
        logger.append("rendering ${rows.size} rows")
    }

    fun build() {
        render(listOf(1, 2), true)
    }
}

// Positional and named call sites for the removal quick fix demo.
fun demoCallSites(clock: java.time.Clock): ReportService {
    val svc = ReportService("Q3", 3, clock, StringBuilder())
    val alt = ReportService("Q4", retryCount = 5, clock, StringBuilder())
    return if (svc.title.length > alt.title.length) svc else alt
}

// Traps below: none of these may ever be flagged.

data class Point(val x: Int, val y: Int) // componentN/copy use every property

abstract class Renderer {
    abstract fun draw(canvas: String) // no body, not private
}

class SolidRenderer : Renderer() {
    override fun draw(canvas: String) = Unit // override keeps its signature
}

class OptedOut(@Suppress("UNUSED_PARAMETER") flags: Int) // explicit opt-out
