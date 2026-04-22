package com.example.compose

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.padding
import androidx.compose.material.Button
import androidx.compose.material.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp

// Cmd+Click on @Composable, Text, Button, Modifier, remember, padding,
// dp, etc. → jumps into the Compose Material / Runtime / Foundation /
// UI source JARs that Kotlin Jump indexes from
// ~/.gradle/caches/modules-2/files-2.1/org.jetbrains.compose.*/.

@Composable
fun PokemonCard(name: String, level: Int) {
    var clicks by remember { mutableStateOf(0) }
    Column(modifier = Modifier.padding(16.dp)) {
        Text(text = name)
        Text(text = "Level $level")
        Row(modifier = Modifier.padding(top = 8.dp)) {
            Button(onClick = { clicks++ }) {
                Text(text = "Tapped $clicks times")
            }
        }
    }
}

@Composable
fun PokemonList(names: List<String>) {
    Column {
        for (name in names) {
            PokemonCard(name = name, level = 50)
        }
    }
}
