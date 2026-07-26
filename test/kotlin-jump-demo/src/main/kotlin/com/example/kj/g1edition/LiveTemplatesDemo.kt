package com.example.kj.g1edition

import com.example.kj.stubs.Log

/**
 * KJ-003: live templates (Android Studio snippets).
 * File kept sparse on purpose: each zone is where you type the
 * abbreviation + Tab, then compare with the expected result in the comment.
 */
class LiveTemplatesDemo {

    // Zone 1: type `logt` + Tab here.
    // Expected: companion object { private const val TAG = "LiveTemplatesDemo" }
    companion object {
        private const val TAG = "LiveTemplatesDemo"
    }
    fun onBattleTurn(damage: Int) {
        // Zone 2: type `logd` + Tab.
        // Expected: Log.d(TAG, "onBattleTurn: ") with the cursor in the string.
        Log.d("manual", "written by hand, compare with the snippet: $damage")
        logd(TAG, "onBattleTurn: ")
        // Zone 3: type `ifn` + Tab on a nullable variable.
        // Expected: if (x == null) { }
        // Zone 4: type `inn` + Tab.
        // Expected: if (x != null) { }
    }

    // Zone 5: type `comp` + Tab at file level.
    // Expected:
    //   @Composable
    //   fun Name() {
    //   }
    //
    // Zone 6: type `prev` + Tab.
    // Expected: the full @Preview + @Composable block, cursor on the name.
    //
    // Zone 7: type `vm` + Tab.
    // Expected: class NameViewModel : ViewModel() { }
    //
    // Zone 8: type `lazyv` + Tab.
    // Expected: val name by lazy { }
}

// Zone 9, file level: the demo types `prev` + Tab on the line below.

