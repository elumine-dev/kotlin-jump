package com.example.app

/**
 * Demo activity used by the Logcat stack-deeplink demo recording.
 *
 * The crash fixture at `scripts/demo/fixtures/crash-mainactivity.log`
 * references `com.example.app.MainActivity.onCreate(MainActivity.kt:42)`.
 * The `greeting!!.length` call below is anchored on line 42 deliberately —
 * when the demo clicks the stack frame in Logcat, the editor opens to that
 * exact line.
 *
 * This file is NOT intended to be runnable Android code; the demo workspace
 * is a pure Kotlin tree without the Android framework on the classpath. It
 * exists only so the symbol index resolves the FQN in the fixture stack.
 */
class MainActivity {

    /** Cached greeting copy, intentionally null at startup so the demo can crash. */
    private var greeting: String? = null

    private var source: String? = null

    private fun loadPreferences(): Map<String, Any> {
        // Stub for parity with a real Activity implementation.
        return emptyMap()
    }

    private fun trackOpen(payload: Map<String, Any>): Unit {
        // Stub — no-op.
        payload.size  // touch the parameter so a future linter doesn't strip it
    }

    /**
     * Simulates the entry point of an Android Activity. Reads the saved-state
     * bundle, logs telemetry, then dereferences `greeting` — the line below is
     * the call that produces the captured NullPointerException.
     */
    fun onCreate(savedInstanceState: Map<String, Any>? = null) {
        source = savedInstanceState?.get("source") as? String
        println("MainActivity onCreate, source = $source")
        trackOpen(loadPreferences())
        val len = greeting!!.length         // ← line 42 — fixture stack lands here
        println("greeting length = $len")
    }

    fun onResume() {
        println("MainActivity resumed")
    }
}
