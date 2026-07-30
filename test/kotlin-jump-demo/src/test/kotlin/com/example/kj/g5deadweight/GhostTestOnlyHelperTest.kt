package com.example.kj.g5deadweight

/**
 * The only consumer of GhostTestOnlyHelper, and it lives in a test source set.
 */
class GhostTestOnlyHelperTest {
    fun checkName(): Boolean = GhostTestOnlyHelper().fixtureName() == "sample"
}
