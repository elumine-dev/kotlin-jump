package com.example.kj.g1edition

/**
 * KJ-007: smart join lines (Ctrl+Shift+J).
 * Put the cursor on the FIRST line of each scenario, then join.
 */
object SmartJoinLinesDemo {

    // 1. Literal concat. Expected: both halves fuse into a single literal.
    val motto = "Gotta catch " +
        "them all!"

    // 2. Concat in 3 pieces. Expected: two successive joins merge it all.
    val longCry = "Pika " +
        "pika " +
        "chuuu"

    // 3. Consecutive comments. Expected: a single // with both texts.
    // first half of the comment
    // second half of the comment
    fun chainCalls(levels: List<Int>): List<Int> {
        // 4. Call chain. Expected: .filter { it > 0 }.map { it * 2 } on one line.
        return levels
            .filter { it > 0 }
            .map { it * 2 }
    }

    // 5. Simple brace. Expected: fun shout() = println("GO!") stays valid,
    //    or at least a standard join that does not break the syntax.
    fun shout() {
        println("GO!")
    }
}
