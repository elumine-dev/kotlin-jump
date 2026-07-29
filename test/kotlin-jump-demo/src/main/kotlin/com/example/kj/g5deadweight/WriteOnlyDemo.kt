package com.example.kj.g5deadweight

import java.io.Serializable

// KJ-028 demo: variables that are assigned, sometimes often, but whose value
// is never read. The quick fix removes the variable and every assignment.

class PlaybackTracker {

    private var isPlaying = false // DEAD: 2 writes, never read

    private var lastError: String? = null // DEAD: assigned once, never read

    private var sessionLabel = "idle" // alive: read through the template below

    fun start() {
        isPlaying = true
        sessionLabel = "playing"
    }

    fun stop() {
        isPlaying = false
        lastError = "stopped early"
    }

    fun describe() = "session: $sessionLabel"

    fun summarize(rows: List<Int>): Int {
        var discarded = 0 // DEAD: accumulated, never read
        var seen = 0 // alive: printed below
        for (row in rows) {
            discarded += row
            seen++
        }
        println("seen $seen")
        return rows.size
    }

    fun traps(source: Counter) {
        var neverMentioned = 0 // KJ-027's job, not ours: zero writes
        var handedOff = 0
        consume(handedOff++) // a read: the value escapes
        source.apply { total = 1 } // receiver may own 'total'
        println(neverMentioned + handedOff)
    }

    private fun consume(value: Int) = value
}

class Counter {
    var total = 0
}

@Volatile
private var globalFlag = false // annotated: never flagged

class Snapshot : Serializable {
    private var version = 0 // reflective supertype: never flagged

    fun bump() {
        version = 1
    }
}
