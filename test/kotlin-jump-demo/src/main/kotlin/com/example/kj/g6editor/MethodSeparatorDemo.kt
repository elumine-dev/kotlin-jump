package com.example.kj.g6editor

/**
 * KJ-011: Method separator line.
 * Expected: a thin rule between each top-level declaration of the class
 * (functions, companion, nested class), NOT between consecutive simple
 * properties, NOT inside function bodies.
 */
class MethodSeparatorDemo {

    private val cache = mutableMapOf<Int, String>()
    private var hits = 0

    fun lookup(id: Int): String? {
        hits += 1
        return cache[id]
    }

    fun hitCount() = hits

    fun store(id: Int, name: String) {
        cache[id] = name
    }

    // Expression body: the rule must precede one-liners too.
    fun size(): Int = cache.size

    fun clear() = cache.clear()

    class Snapshot(val entries: Map<Int, String>)

    companion object {
        const val MAX_ENTRIES = 151

        fun empty() = MethodSeparatorDemo()
    }
}
