package com.example.kj.g2resources

import com.example.app.R

/**
 * KJ-017: resource shadowing.
 * `primary` is defined in TWO modules:
 *   - app:             src/main/res/values/colors.xml       (wins, app > library)
 *   - feature-battle:  feature-battle/src/main/res/values/colors.xml (loses, struck)
 * Same story for `battle_start` on the strings side.
 * `battle_glow` exists ONLY in feature-battle: plain hover, no list.
 * Trap: values-fr/strings.xml is NOT shadowing (locale is not priority).
 */
object ResourceShadowingDemo {

    // Hover here → expected: 2 definitions, app first, feature-battle struck.
    val winnerColor = R.color.primary

    // Hover here → expected: plain hover (single definition, no shadowing).
    val uniqueColor = R.color.battle_glow

    // Hover here → expected: 2 string definitions, app wins.
    val startLabel = R.string.battle_start

    // Hover here → expected: NO shadowing mention despite values-fr
    // (a translation is a locale overlay, not a redefinition).
    val translated = R.string.app_name
}
