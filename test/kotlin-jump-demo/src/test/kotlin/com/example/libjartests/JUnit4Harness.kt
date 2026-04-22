package com.example.libjartests

import org.junit.Assert
import org.junit.Test

class JUnit4Harness {
    @Test
    fun sanity() {
        Assert.assertEquals(1, 1)
    }
}
