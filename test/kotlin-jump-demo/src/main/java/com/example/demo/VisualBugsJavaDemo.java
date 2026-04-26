package com.example.demo;

// ─────────────────────────────────────────────────────────────────────────────
// FICHIER DE TEST VISUEL — Java
//
// BUG #4 — Null assertion `!!` highlight in Java (where it doesn't exist)
//
// 👀 LOOK HERE: lignes ci-dessous.
// En Kotlin, `!!` est un null-assert et Kotlin Jump le surligne en ambre/orange
// pour signaler un risque NPE. C'est correct en Kotlin.
//
// MAIS ce provider est aussi enregistré pour `java`. En Java, `!!` est juste
// une double négation booléenne — pas un null-assert. Le surlignage est donc
// menteur : il fait croire à un risque NPE qui n'existe pas.
//
// Tu devrais voir : `!!` en Java → AUCUN highlight (texte normal).
// Tu vois actuellement : `!!` en ambre comme si c'était un null-assert Kotlin.
// ─────────────────────────────────────────────────────────────────────────────

public class VisualBugsJavaDemo {
    public static boolean isReady(boolean flag) {
        // The `!!` below is double-negation in Java — converts to canonical
        // boolean. Kotlin Jump should NOT highlight it.
        if (!!flag) {
            return true;
        }
        return false;
    }

    public static int forceTruthy(int value) {
        // `!!` on a non-zero int → true → 1. Java idiom.
        return !!(value != 0) ? 1 : 0;
    }
}
