#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# Demo fixture setup — one-time prep the demo workspace before recording.
#
# What this does:
#   1. Pre-downloads the source JARs for third-party dependencies declared in
#      `test/kotlin-jump-demo/build.gradle.kts`:
#        - junit-jupiter-api      (for lib-jar-navigation demo)
#        - kotlinx-coroutines-core (for lib-jar-coroutines + lib-jar-kdoc-hover)
#        - org.jetbrains.compose.* (for lib-jar-compose)
#        - kotlinx-serialization-* (extra surface)
#      All into ~/.gradle/caches/modules-2/files-2.1/ — the standard Gradle
#      cache layout that Kotlin Jump's GradleSourcesScanner already walks.
#   2. Compiles the test fixture so the @Test methods are runnable. The
#      `run-unit-test` demo triggers the gradle test task; if the project
#      hasn't been compiled once, the first run takes 30+ seconds and
#      the demo overruns.
#
# Idempotent — safe to re-run. ~2-5 min the first time (Compose ~80 MB),
# < 5 s on warm cache.
#
# Required: Java 17+ (for ./gradlew). The Kotlin Jump extension itself
# requires NEITHER Java NOR Gradle — only this fixture-prep script does.
# ─────────────────────────────────────────────────────────────────────────────

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
FIXTURE_ROOT="$REPO_ROOT/test/kotlin-jump-demo"

if [[ ! -d "$FIXTURE_ROOT" ]]; then
  echo "✗ fixture not found at $FIXTURE_ROOT" >&2
  exit 1
fi

cd "$FIXTURE_ROOT"

if [[ ! -x "./gradlew" ]]; then
  echo "✗ ./gradlew missing in $FIXTURE_ROOT" >&2
  exit 1
fi

echo "→ Resolving dependencies and downloading source JARs..."
echo "  (first run can take 2-5 min — Compose Multiplatform pulls ~80 MB)"
# `dependencies` resolves only binary jars + poms. The `ideaModule` task
# (provided by the `idea` plugin in build.gradle.kts with
# `isDownloadSources = true`) is the one that actually downloads
# `-sources.jar` files into the local Gradle cache.
./gradlew --quiet dependencies
./gradlew --quiet ideaModule

echo "→ Compiling fixture so test classes are runnable..."
./gradlew --quiet compileTestKotlin

echo ""
echo "✓ Fixture ready. Sources JARs cached in ~/.gradle/caches/modules-2/files-2.1/"
echo "  - junit-jupiter-api"
echo "  - kotlinx-coroutines-core / -test / -android"
echo "  - org.jetbrains.compose.runtime / .foundation / .material"
echo "  - kotlinx-serialization-core / -json"
echo ""
echo "You can now record any demo:"
echo "  npm run demo:record scripts/demo/demos/lib-jar-navigation.demo.ts"
echo "  npm run demo:record scripts/demo/demos/lib-jar-coroutines.demo.ts"
echo "  npm run demo:record scripts/demo/demos/lib-jar-compose.demo.ts"
echo "  npm run demo:record scripts/demo/demos/lib-jar-kdoc-hover.demo.ts"
echo "  npm run demo:record scripts/demo/demos/run-unit-test.demo.ts"
echo ""
echo "If a Cmd+Click into a JAR fails: open VS Code, click the \$(library)"
echo "status bar item → 'Download missing sources' to fetch via HTTP (no JVM)."
