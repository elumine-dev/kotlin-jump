package com.example.kj.g5deadweight

import java.util.Locale

/**
 * KJ-032: this file holds nothing but one dead declaration, so the fix
 * deletes the FILE rather than leaving an empty shell behind.
 */
class GhostOrphan {
    fun shout(text: String): String = text.uppercase(Locale.ROOT)
}
