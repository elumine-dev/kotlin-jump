package com.example.kj.g5deadweight

import com.example.kj.g5deadweight.GhostMapper

/**
 * KJ-032: this file imports a dead class and never uses it. Removing the
 * declaration without removing this import stops the project compiling, so
 * the import is part of the fix.
 */
class UnusedSymbolsStaleImporter {
    fun unrelated(): Int = 1
}
