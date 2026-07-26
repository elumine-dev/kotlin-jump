package com.example.kj.g2resources

import androidx.compose.material.Text
import androidx.compose.runtime.Composable
import com.example.kj.stubs.Log
import com.example.kj.stubs.ViewBinding

/**
 * KJ-004 (Hardcoded string lint) + KJ-005 (Extract string resource).
 * Every literal marked ⚠ must raise the lint, and the Extract action must
 * produce the strings.xml entry described in the comment.
 */
class ExtractStringResourceDemo(private val binding: ViewBinding) {

    @Composable
    fun BattleHeader(turns: Int) {
        // ⚠ lint expected: the literal moves to strings.xml under a
        // generated snake_case name, the call site swaps to a resource.
        Text("Battle ready!")

        // ⚠ template. Expected: the value lands in XML as "Turn %1$s of 10",
        // the call site keeps `turns` as an argument, never copied raw.
        Text("Turn $turns of 10")

        // ⚠ XML escaping. Expected: Ash &amp; Misty… with the quote escaped \'
        Text("Ash & Misty's team <3")

        // ⚠ name collision. "battle" already exists in strings.xml (seed at
        // the end of the file). Expected: battle_2 is proposed.
        Text("Battle")
    }

    fun bindViews() {
        // ⚠ NON-composable context. Expected: setText(R.string.trainer_greeting),
        // NOT stringResource(...).
        binding.title.setText("Welcome, trainer!")
        binding.subtitle.setHint("Enter your name")
    }

    fun notUiStrings(id: Int) {
        // False positives. NO lint expected on these lines:
        println("Loading pokemon $id...")
        Log.d("Extract", "cache miss for $id")
        require(id > 0) { "id must be positive" }
        val url = "https://pokeapi.co/api/v2/pokemon/$id"
        println(url)
    }
}
