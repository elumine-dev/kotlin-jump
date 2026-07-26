package com.example.kj.g1edition

import com.example.data.Pokemon

/**
 * KJ-002: postfix completion.
 * Each function is a test bed: put the cursor at the end of an
 * expression, type the given postfix, check the transformation.
 */
object PostfixCompletionDemo {

    private fun find(id: Int): Pokemon? = null

    fun playground(list: List<Pokemon>, ready: Boolean) {
        val pikachu = find(25)
        

        // Type `pikachu.null`   → expected: if (pikachu == null) { }
        // Type `pikachu.notnull`→ expected: if (pikachu != null) { }
        // Type `pikachu.let`    → expected: pikachu.let { }

        // Chained receiver: type `.let` after c.
        // Expected: the receiver is the WHOLE chain find(25)?.name?.length.
        val c = find(25)?.name?.length

        // Type `list.for`  → expected: for (item in list) { }
        // Type `ready.if`  → expected: if (ready) { }
        // Type `ready.not` → expected: !ready

        // Multi-line receiver: type `.let` after the closing paren.
        // Expected: the whole filter call is the receiver.
        val strong = list.filter {
            it.level > 50
        }

        // Traps: NO postfix suggestion expected here.
        // in a string: "pikachu.null is not code"
        // in a comment: pikachu.if (see this very line)
        // on a numeric literal: 42.if makes no sense (excluded for if)
        
        println("$pikachu $c $strong")
    }
}
