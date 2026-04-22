# Kotlin Jump — Demo Fixture

Synthetic Kotlin/Java workspace used by the **demo recorder**
(`scripts/demo/`) to exercise every Kotlin Jump feature in a controlled,
reproducible setting.

> **NOT shipped to end-users.** This directory is excluded from the
> published VSIX via `.vscodeignore`. The recorder reads it to record
> the WebPs that go into the README and the walkthrough.

## What's inside

| Path | Purpose |
|---|---|
| `src/main/kotlin/com/example/` | Reference Kotlin files exercising every inline feature, navigation pattern, and lib JAR import |
| `src/test/kotlin/com/example/` | JUnit 5 test suites (used by the `run-unit-test` demo) |
| `src/main/res/` | Android resource files (strings.xml, colors.xml, with `values-en/` for the i18n locale grid demo) |
| `gradle/libs.versions.toml` | Version catalog — single source of truth for all third-party deps |
| `build.gradle.kts` | `kotlin("jvm")` + Compose Multiplatform + serialization + testing |
| `settings.gradle.kts` | Maven Central + Google + JetBrains Compose dev repo |

## Pre-requisites

- **Java 17+** (for `./gradlew`) — used to download dependencies and
  compile the fixture. The Kotlin Jump extension itself does NOT need
  Java.
- **~150 MB** disk space for the cached source JARs in
  `~/.gradle/caches/modules-2/files-2.1/`.

## One-time setup

From the repo root:

```bash
./scripts/demo/setup-fixture.sh
```

This:

1. Runs `./gradlew dependencies` to materialise binary + sources JARs
   into your local Gradle cache (so the `lib-jar-*` demos can
   Cmd+Click into them).
2. Runs `./gradlew compileTestKotlin` to pre-warm the test compilation
   (so the `run-unit-test` demo doesn't overrun).

First run: 2-5 minutes (Compose Multiplatform alone is ~80 MB of
deps). Subsequent runs: < 5 s on warm cache.

## Adding a new third-party library

To make a new lib navigable via Cmd+Click in the demos:

1. **Declare the version** in `gradle/libs.versions.toml`:
   ```toml
   [versions]
   retrofit = "2.9.0"

   [libraries]
   retrofit-core = { group = "com.squareup.retrofit2", name = "retrofit", version.ref = "retrofit" }
   ```

2. **Add the implementation** in `build.gradle.kts`:
   ```kotlin
   dependencies {
       implementation(libs.retrofit.core)
   }
   ```

3. **Use the import** in a Kotlin file under `src/main/kotlin/`:
   ```kotlin
   import retrofit2.Retrofit
   class MyApi { val r = Retrofit.Builder().build() }
   ```

4. **Re-run setup**:
   ```bash
   ./scripts/demo/setup-fixture.sh
   ```

5. **Optional**: write a new `*.demo.ts` under `scripts/demo/demos/`
   using `stage.click('Retrofit', { modifier: 'Cmd', label: 'Go to Definition' })`.

## Limitations

- **Compose Multiplatform**, not Android Compose. APIs are 95% identical
  but a few Android-specific bits (e.g. `pointerInput` modifiers, BOM
  resolution) differ. Use only `runtime`, `material`, `foundation` APIs
  in fixture files to stay portable.
- **No Android SDK** — adding `androidx.compose.*` (the Android variants)
  would require the full Android Gradle Plugin setup. Out of scope.
- **No KSP / kapt** — annotation processors aren't relevant for a
  navigation/parsing fixture.

## Why this fixture exists

Kotlin Jump's pipeline records demos by spawning a clean-profile VS
Code instance pointed at this folder. Having a synthetic, opinionated
workspace (instead of a "real" Android app) keeps:

- **Demo timings stable** (deterministic file structure)
- **Recording reproducible** (same input → same output)
- **End-user installs lean** (the fixture never ships in the VSIX)
- **Library nav demos meaningful** (declared deps → cached sources →
  Cmd+Click works)
