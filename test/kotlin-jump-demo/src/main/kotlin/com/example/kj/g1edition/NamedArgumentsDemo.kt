package com.example.kj.g1edition

/**
 * KJ-001: add names to call arguments (Alt+Enter intention).
 * Each call below is a scenario. Expected after the action:
 * the `name =` are inserted, see the line by line comments.
 */

data class Trainer(val name: String, val age: Int, val isChampion: Boolean)

fun createTrainer(name: String, age: Int, isChampion: Boolean): Trainer =
    Trainer(name, age, isChampion)

fun levelUp(base: Int, gain: Int = 1, vararg bonuses: Int): Int =
    base + gain + bonuses.sum()

fun withCallback(label: String, retries: Int, onDone: (String) -> Unit) {
    onDone("$label:$retries")
}

// Overloads: resolution must pick by arity.
fun heal(amount: Int): Int = amount
fun heal(amount: Int, critical: Boolean): Int = if (critical) amount * 2 else amount

object NamedArgumentsDemo {

    fun scenarios() {
        // 1. Nominal case: every argument should end up named.
        createTrainer("Ada", 36, true)

        // 2. Already partly named. Expected: only "Red" and 11 get a name.
        createTrainer("Red", 11, isChampion = false)

        // 3. Nested calls. Expected: BOTH calls are nameable,
        //    the action only touches the call enclosing the cursor.
        heal(levelUp(10, 2), false)

        // 4. Vararg. Expected: base = 5, gain = 1, then the bonuses with
        //    NO name (a spread vararg cannot be named).
        levelUp(5, 1, 3, 4, 5)

        // 5. Trailing lambda. Expected: label and retries named, the
        //    trailing lambda stays outside the parens, never named.
        withCallback("sync", 3) { println(it) }

        // 6. Tricky string: commas and parens inside the literal.
        //    Expected: argument splitting does not break.
        createTrainer("Oak, Prof. (Kanto)", 60, false)

        // 7. One-argument overload. Expected: heal(amount = 20).
        heal(20)
    }
}
