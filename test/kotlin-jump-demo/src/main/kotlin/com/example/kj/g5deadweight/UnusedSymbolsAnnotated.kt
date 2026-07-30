package com.example.kj.g5deadweight

/**
 * KJ-032: annotations are an ALLOWLIST. Anything carrying an annotation
 * outside a short benign set is reachable through a framework we cannot see,
 * so it is never reported.
 */

// Alive: the consumer reads it, and @Serializable would keep it anyway.
@Serializable
data class KeptSerializable(val id: String)

// Alive despite nothing referencing it: a JSON library instantiates it.
@Serializable
data class GhostPayload(val body: String)

// Alive despite nothing referencing it: the preview renderer calls it, which
// is why @Preview is NOT in the benign list.
@Preview
fun GhostPreview() {
    // rendered by the IDE, never called from code
}

// Dead: @Composable alone is benign, so this one is still reported.
@Composable
fun GhostComposable() {
}
