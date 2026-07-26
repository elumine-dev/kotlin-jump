package com.example.kj.g3navigation

import com.example.kj.stubs.NavHost
import com.example.kj.stubs.navDeepLink
import com.example.kj.stubs.rememberNavController

/**
 * KJ-013: Screen Flow Map. Graph expected in the webview:
 *
 *   [deeplink pokedemo://battle/{id}] ─┐
 *   pokedex ──> battle/{pokemonId} <───┘
 *   pokedex ──> team
 *   team ──> battle/{pokemonId}
 *   settings_graph { settings/home ──> settings/about }   (nested graph)
 *   pokedex ──> settings/home
 *   OrphanScreen: orphan node (no incoming edge)
 *   dynamicRoute: "dynamic route" node (concatenation, not resolvable)
 */
fun AppNavGraph() {
    val navController = rememberNavController()

    NavHost(navController = navController, startDestination = Routes.POKEDEX) {

        composable(Routes.POKEDEX) {
            PokedexRouteScreen(
                onOpenBattle = { id -> navController.navigate("battle/$id") },
                onOpenTeam = { navController.navigate(Routes.TEAM) },
                onOpenSettings = { navController.navigate(Routes.SETTINGS_HOME) },
            )
        }

        composable(route = Routes.TEAM) {
            TeamRouteScreen(onFight = { navController.navigate("battle/25") })
        }

        composable(
            route = Routes.BATTLE,
            deepLinks = listOf(
                navDeepLink { uriPattern = "pokedemo://battle/{pokemonId}" },
            ),
        ) {
            BattleRouteScreen()
        }

        // Nested graph. Expected: a "settings_graph" cluster in the map.
        navigation(
            startDestination = Routes.SETTINGS_HOME,
            route = Routes.SETTINGS_GRAPH,
        ) {
            composable(Routes.SETTINGS_HOME) {
                SettingsHomeScreen(
                    onAbout = { navController.navigate(Routes.SETTINGS_ABOUT) },
                )
            }
            composable(Routes.SETTINGS_ABOUT) { SettingsAboutScreen() }
        }

        // Orphan screen, declared but never navigated to. Expected: outlined.
        composable("orphan") { OrphanScreen() }

        // Dynamic route, a concatenation that cannot be resolved statically.
        // Expected: a "dynamic route" node with no bogus edge.
        val debugSuffix = System.getenv("DEBUG_ROUTE") ?: "off"
        composable("debug_" + debugSuffix) { OrphanScreen() }
    }
}
