package com.example.feature.battle

import kotlinx.coroutines.delay

/**
 * KJ-017 / KJ-012 fixture — code vivant dans le second module.
 * Les usages de R.color.* pour la demo d'ombrage sont côté app
 * (g2resources/ResourceShadowingDemo.kt) : ce module fournit seulement
 * les DÉFINITIONS concurrentes dans son res/values/.
 */
class BattleEffects {

    suspend fun flashScreen(): Long {
        delay(FLASH_DURATION_MS)
        return FLASH_DURATION_MS
    }

    companion object {
        const val FLASH_DURATION_MS = 300L
    }
}
