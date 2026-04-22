package com.example.libjartests

import kotlinx.coroutines.flow.MutableStateFlow
import androidx.compose.runtime.Composable
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember

val counter = MutableStateFlow(0)

@Composable
fun DemoComposable() {
    val state = remember { mutableStateOf(0) }
}

val numbers = listOf(1, 2, 3)
