// Module fixture — KJ-017 resource shadowing / KJ-012 Android project view.
// Pure JVM like the root module (no Android SDK required).
plugins {
    kotlin("jvm")
}

kotlin {
    jvmToolchain(17)
}

dependencies {
    // KJ-022 fixture: dependency with imports in THIS module only.
    implementation(libs.coroutines.core)
}
