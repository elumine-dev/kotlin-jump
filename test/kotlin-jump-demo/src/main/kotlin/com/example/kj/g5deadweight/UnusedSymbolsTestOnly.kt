package com.example.kj.g5deadweight

/**
 * KJ-032: production code that only the tests exercise. Reported as its own
 * category, never with a removal fix: deleting it breaks the test that keeps
 * it alive, and that call belongs to a human.
 */
class GhostTestOnlyHelper {
    fun fixtureName(): String = "sample"
}
