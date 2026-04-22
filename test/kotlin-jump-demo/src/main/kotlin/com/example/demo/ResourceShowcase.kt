package com.example.demo

import com.example.app.R

// ─────────────────────────────────────────────────────────────────────────────
// DÉMO : Every Android resource, one Cmd+Click away.
// Tight showcase — one line per resource type. Each line is a
// navigable target from Kotlin → XML (or drawable file).
// ─────────────────────────────────────────────────────────────────────────────

object ResourceShowcase {
    val screenTitle = R.string.title_pokedex       // → values/strings.xml
    val brandColor  = R.color.primary              // → values/colors.xml
    val pokemonIcon = R.drawable.ic_pokeball       // → drawable/ic_pokeball.xml
    val paddingMd   = R.dimen.spacing_md           // → values/dimens.xml
}
