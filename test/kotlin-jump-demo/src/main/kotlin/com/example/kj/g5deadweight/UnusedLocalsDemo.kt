package com.example.kj.g5deadweight

// KJ-027 demo: locals, lambda parameters and catch bindings that are never
// used. Quick fixes rename to _, delete the line, or keep the call.

class ReportBuilder(private val rows: List<String>) {

    fun build(): String {
        val staleTotal = 0 // DEAD, pure: the whole line can go
        val labels = listOf("draft", "final") // DEAD, pure factory
        val report = renderRows(rows) // DEAD, but the call must survive
        val cached = registry.snapshot // DEAD: a getter may run code

        val count = rows.size
        return "total: $count" // count stays alive through the template
    }

    fun printAll() {
        rows.forEachIndexed { index, row -> // DEAD: 'index' is never read
            println(row)
        }
    }

    fun printNested() {
        rows.forEach { row ->
            labelsFor(row).forEach { label ->
                println("$row -> $label") // both stay alive
            }
        }
    }

    fun save() {
        try {
            persist()
        } catch (e: IllegalStateException) { // DEAD: 'e' is never touched
            fallback()
        }

        try {
            persist()
        } catch (cause: IllegalArgumentException) {
            throw wrap(cause) // alive: rethrown
        }
    }

    fun traps() {
        rows.map { it.trim() } // 'it' is implicit, never flagged
        rows.forEachIndexed { _, row -> println(row) } // already underscored
        val (first, second) = rows.first() to rows.last() // destructuring
        println("$first $second")

        @Suppress("unused")
        val keptForDebug = 42 // explicit opt-out
    }

    private val registry = Registry()
    private fun renderRows(input: List<String>) = input.joinToString()
    private fun labelsFor(row: String) = listOf(row)
    private fun persist() = Unit
    private fun fallback() = Unit
    private fun wrap(cause: Throwable) = IllegalStateException(cause)
}

class Registry {
    val snapshot: String get() = "snapshot"
}
