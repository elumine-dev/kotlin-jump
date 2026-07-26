# Index des fixtures KJ — où regarder pour chaque ticket

Fichiers d'exemple ajoutés le 2026-07-24 pour visualiser les 23 features
(registre : `doc/todo-2026-annexe2.md` du repo kotlin-nav). Chaque fichier
contient des commentaires « attendu : … » ligne par ligne.

| Ticket | Feature | Fixture principale |
|---|---|---|
| KJ-001 | Add names to call arguments | `src/main/kotlin/com/example/kj/g1edition/NamedArgumentsDemo.kt` |
| KJ-002 | Postfix completion | `g1edition/PostfixCompletionDemo.kt` |
| KJ-003 | Live templates | `g1edition/LiveTemplatesDemo.kt` |
| KJ-004 | Hardcoded string lint | `g2resources/ExtractStringResourceDemo.kt` (+ `demo/HardcodedStringDemo.kt` historique) |
| KJ-005 | Extract string resource | `g2resources/ExtractStringResourceDemo.kt` |
| KJ-006 | Surround with… | `g1edition/SurroundWithDemo.kt` |
| KJ-007 | Smart join lines | `g1edition/SmartJoinLinesDemo.kt` |
| KJ-008 | Recent locations | aucun fichier requis (naviguer 4+ fichiers puis Cmd+Shift+E) |
| KJ-009 | Unused import graying | `g5deadweight/UnusedImportsDemo.kt` |
| KJ-010 | SQL highlight @Query | `g6editor/SqlQueryDao.kt` |
| KJ-011 | Method separator | `g6editor/MethodSeparatorDemo.kt` |
| KJ-012 | Android project view | racine + module `feature-battle/` + `values-fr`/`values-en` |
| KJ-013 | Screen Flow Map | `g3navigation/NavGraphDemo.kt` + `Routes.kt` + `ScreensDemo.kt` |
| KJ-014 | UDF X-Ray | `g4runtime/UdfXrayViewModel.kt` |
| KJ-015 | Compose Outline Tree | `g3navigation/OutlineTreeDemo.kt` |
| KJ-016 | Lifecycle Pairing | `g4runtime/LifecyclePairingDemo.kt` |
| KJ-017 | Resource Shadowing | `g2resources/ResourceShadowingDemo.kt` + `feature-battle/src/main/res/values/` |
| KJ-018 | Reverse String Map | `g2resources/ReverseStringMapDemo.kt` + `g3navigation/ScreensDemo.kt` |
| KJ-019 | Dispatcher Lens | `g4runtime/DispatcherLensDemo.kt` |
| KJ-020 | Room Migration Drift | `g4runtime/RoomMigrationDemo.kt` |
| KJ-021 | Badges usage res XML | `res/values/strings.xml` + `colors.xml` (blocs KJ) + `res/layout/view_kj_banner.xml` |
| KJ-022 | Badges usage dépendances | `build.gradle.kts` (bloc KJ-022) + `g5deadweight/DependencyUsageDemo.kt` |
| KJ-023 | Badges nécessité Manifest | `src/main/AndroidManifest.xml` (blocs KJ-023) |

Stubs Android partagés (le projet est JVM pur) : `src/main/kotlin/com/example/kj/stubs/AndroidStubs.kt`.
