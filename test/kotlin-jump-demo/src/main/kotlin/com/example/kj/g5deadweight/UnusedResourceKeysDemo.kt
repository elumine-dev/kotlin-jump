package com.example.kj.g5deadweight

import com.example.app.R

/**
 * KJ-031: which values entries this file keeps alive.
 *
 * Everything referenced here is proven used. Everything declared in
 * misc_kj.xml, themes_kj.xml and attrs_kj.xml but absent from here is dead,
 * and the sweep says so.
 */
class UnusedResourceKeysDemo {

    fun retryBudget(): Int = R.integer.kj_retry_count

    fun isFeatureOn(): Int = R.bool.kj_feature_on

    // Keeps the dotted style alive: aapt maps dots to underscores, so
    // R.style.Widget_Kj_Button_Primary is @style/Widget.Kj.Button.Primary.
    fun primaryButtonStyle(): Int = R.style.Widget_Kj_Button_Primary

    // Keeps the styleable member alive. The attribute name is only a SUFFIX of
    // this token, which is why the scanner never splits it.
    fun badgeColorAttr(): Int = R.styleable.KjBadge_kjBadgeColor
}
