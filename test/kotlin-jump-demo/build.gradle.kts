// ─────────────────────────────────────────────────────────────────────────────
// SPRINT 2 — Feature 5 : Version catalog hover
//
// Placer le curseur sur un libs.xxx ci-dessous → tooltip group:name:version
//
// Exemples (hover pour voir la version résolue depuis gradle/libs.versions.toml) :
//
//   libs.core.ktx               → androidx.core:core-ktx:1.12.0
//   libs.appcompat              → androidx.appcompat:appcompat:1.6.1
//   libs.lifecycle.viewmodel    → androidx.lifecycle:lifecycle-viewmodel-ktx:2.7.0
//   libs.lifecycle.runtime      → androidx.lifecycle:lifecycle-runtime-ktx:2.7.0
//   libs.navigation.fragment    → androidx.navigation:navigation-fragment-ktx:2.7.6
//   libs.compose.bom            → androidx.compose:compose-bom:2024.02.00
//   libs.compose.ui             → androidx.compose.ui:ui:1.6.2
//   libs.compose.material3      → androidx.compose.material3:material3:1.2.0
//   libs.compose.foundation     → androidx.compose.foundation:foundation:1.6.2
//   libs.retrofit.core          → com.squareup.retrofit2:retrofit:2.9.0
//   libs.retrofit.gson          → com.squareup.retrofit2:converter-gson:2.9.0
//   libs.okhttp.core            → com.squareup.okhttp3:okhttp:4.12.0
//   libs.okhttp.logging         → com.squareup.okhttp3:logging-interceptor:4.12.0
//   libs.gson                   → com.google.code.gson:gson:2.10.1
//   libs.coroutines.core        → org.jetbrains.kotlinx:kotlinx-coroutines-core:1.7.3
//   libs.coroutines.android     → org.jetbrains.kotlinx:kotlinx-coroutines-android:1.7.3
//   libs.room.runtime           → androidx.room:room-runtime:2.6.1
//   libs.room.ktx               → androidx.room:room-ktx:2.6.1
//   libs.hilt.android           → com.google.dagger:hilt-android:2.50
//   libs.koin.android           → io.insert-koin:koin-android:3.5.3
//   libs.koin.compose           → io.insert-koin:koin-androidx-compose:3.5.3
//   libs.coil.core              → io.coil-kt:coil:2.5.0
//   libs.coil.compose           → io.coil-kt:coil-compose:2.5.0
//   libs.glide.core             → com.github.bumptech.glide:glide:4.16.0
//   libs.junit4                 → junit:junit:4.13.2
//   libs.junit5.api             → org.junit.jupiter:junit-jupiter-api:5.10.1
//   libs.mockk                  → io.mockk:mockk:1.13.9
//   libs.turbine                → app.cash.turbine:turbine:1.0.0
//   libs.espresso.core          → androidx.test.espresso:espresso-core:3.5.1
// ─────────────────────────────────────────────────────────────────────────────

plugins {
    kotlin("jvm") version "1.9.25"
    application
}

group = "com.example"
version = "1.0.0"

kotlin {
    jvmToolchain(17)
}

application {
    mainClass.set("com.example.app.AppKt")
}

repositories {
    mavenCentral()
}

dependencies {
    // ← hover sur libs.xxx pour voir group:name:version depuis gradle/libs.versions.toml
    implementation(libs.coroutines.core)
    testImplementation(libs.coroutines.core)
    testImplementation(libs.junit4)
    testImplementation(libs.junit5.api)
    testRuntimeOnly(libs.junit5.engine)
    testRuntimeOnly("org.junit.platform:junit-platform-launcher")
}

tasks.test {
    useJUnitPlatform()
    testLogging {
        events("failed", "skipped")
    }
}

// Installs the pre-built stub APK on the connected device/emulator.
// Lets the Kotlin Jump "Run" button demo the full install → launch flow
// without requiring a real Android SDK build.
tasks.register("installDebug") {
    group = "install"
    description = "Install the stub APK on the connected device via adb"
    doLast {
        val serial = System.getenv("ANDROID_SERIAL") ?: ""
        val apk    = rootProject.file("stub/stub-app.apk")

        require(apk.exists()) {
            "stub/stub-app.apk not found — run `./gradlew :buildStubApk` to regenerate it"
        }

        val cmd = buildList {
            add("adb")
            if (serial.isNotEmpty()) { add("-s"); add(serial) }
            addAll(listOf("install", "-r", apk.absolutePath))
        }

        val result = ProcessBuilder(cmd)
            .inheritIO()
            .start()
            .waitFor()

        require(result == 0) { "adb install failed (exit $result)" }
    }
}
