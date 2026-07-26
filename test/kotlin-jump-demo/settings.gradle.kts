// Settings for the Kotlin Jump demo fixture project.
//
// Maven Central + Google + JetBrains Compose dev repo are required so
// the build resolves Compose Multiplatform (org.jetbrains.compose.*)
// alongside the standard Kotlin/JUnit/Coroutines deps. Compose
// Multiplatform JVM is used (rather than androidx.compose.* Android
// variants) so the fixture stays `kotlin("jvm")` — no Android SDK
// required to compile.

pluginManagement {
    repositories {
        gradlePluginPortal()
        mavenCentral()
        google()
        maven("https://maven.pkg.jetbrains.space/public/p/compose/dev")
    }
}

dependencyResolutionManagement {
    repositories {
        mavenCentral()
        google()
        maven("https://maven.pkg.jetbrains.space/public/p/compose/dev")
    }
}

rootProject.name = "kotlin-jump-demo"

// Second module — fixture for KJ-017 (resource shadowing), KJ-012 (Android
// project view multi-module) and KJ-022 (per-module dependency badges).
include(":feature-battle")
