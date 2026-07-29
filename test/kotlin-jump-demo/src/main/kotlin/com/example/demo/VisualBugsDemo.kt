package com.example.demo

import com.example.app.R

// ─────────────────────────────────────────────────────────────────────────────
// FICHIER DE TEST VISUEL
//
// Ouvre ce fichier dans VS Code (avec Kotlin Jump rechargé) et observe chaque
// section. Les commentaires marqués "👀 LOOK HERE" décrivent ce que tu DEVRAIS
// voir vs ce que tu vois actuellement (= le bug).
//
// Chaque section est numérotée pour matcher la liste de bugs.
// ─────────────────────────────────────────────────────────────────────────────


// ── BUG #2 — R.plurals folding affiche un literal cassé ───────────────────────
// 👀 LOOK HERE: ligne ci-dessous.
// VS Code va REMPLACER `R.plurals.pokemon_count` par `"%d Pokémon"` (la valeur
// "other" du plurals dans strings.xml). Résultat affiché à l'utilisateur :
//
//     getQuantityString("%d Pokémon", 3, 3)
//
// Ça ressemble à un bug du code utilisateur (le literal apparaît deux fois).
// Comportement souhaité : ne PAS folder, ou marquer "plurals:%d Pokémon" pour
// indiquer la nature de la chose.
@Suppress("unused")
private fun showCount(count: Int): String =
    getQuantityString(R.plurals.pokemon_count, count, count)


// ── BUG #2bis — R.array folding ───────────────────────────────────────────────
// 👀 LOOK HERE: ligne ci-dessous.
// `R.array.pokemon_types` va être remplacé par `"[Fire, Water, Grass]"` —
// l'utilisateur croit voir un string literal au lieu d'un Array<String>.
@Suppress("unused")
private fun typesLabel(): String = R.array.pokemon_types.toString()


// ── BUG #5 — Const val foldé dans un block comment ────────────────────────────
// Le commentaire `/* ... ${TIMEOUT_MS} ... */` ne devrait PAS voir
// `TIMEOUT_MS` foldé. Mais ConstValFoldingProvider rentre dedans car
// isInsideStringInterpolation ignore les block comments.
//
// 👀 LOOK HERE: la ligne `/* … */` ci-dessous.
// Tu devrais voir `${TIMEOUT_MS}` LITTÉRALEMENT, pas `${5000}` ou `5000`.
private const val TIMEOUT_MS = 5000

@Suppress("unused")
/* old retry config: timeout was "${TIMEOUT_MS}ms with 3 retries" — to remove */
private fun deprecatedComment() = TIMEOUT_MS  // ← cette ligne, le fold est OK


// ── BUG #6 — SuspendMarker ⚡ sur un local shadowing un workspace suspend ─────
// `launch` est un workspace `suspend fun` dans Kotlin Jump's index (Compose,
// Coroutines). Si on définit un local var `launch`, ça ne devrait PAS recevoir
// un ⚡ — c'est juste une lambda locale.
//
// 👀 LOOK HERE: appel `launch()` ligne 56.
// Tu devrais voir AUCUN ⚡. Si tu en vois un → bug confirmé.
@Suppress("unused")
private fun localShadowsSuspend() {
    val launch: () -> Unit = { println("not a coroutine") }
    launch()
}


// ── BUG #8 — FindUsages tree-view title pluralization ────────────────────────
// Cette fonction n'est appelée qu'UNE fois (depuis showCount ci-dessus).
// 👀 LOOK HERE:
//   1. Place le curseur sur `getQuantityString` ligne 30
//   2. Cmd+Click ou Find All References
//   3. Le tree view en bas affiche "1 usages of "getQuantityString""
//   ↑ devrait être "1 usage" (singulier).
private fun getQuantityString(id: Int, q: Int, vararg args: Any): String = "$id-$q"


// ── BUG #1 — Plurals hover quantity=other lie ─────────────────────────────────
// 👀 LOOK HERE: hover sur `tickets_only_one` ci-dessous.
// Le popup affichera "**plural** (quantity=other)" + bloc vide.
// MAIS strings_plurals.xml ne déclare PAS d'item `quantity="other"` pour
// `tickets_only_one` — seulement `one` et `few`. Le hover ment.
@Suppress("unused")
private fun ticketsLeft(n: Int): String =
    getQuantityString(R.plurals.tickets_only_one, n, n)


// ── BUG #3 — Color folding rend gris #808080 pour les @color/X references ────
// 👀 LOOK HERE: lignes ci-dessous.
// `R.color.brand` pointe vers `@color/primary` (= #FF0000 rouge vif) dans
// colors_refs.xml. Tu devrais voir un swatch ROUGE à côté.
// Tu vois actuellement : un swatch GRIS (le fallback #808080).
@Suppress("unused")
private val brandColor    = R.color.brand        // points at @color/primary  → should be RED
@Suppress("unused")
private val highlightColor = R.color.highlight   // points at @color/accent   → should be GREEN
@Suppress("unused")
private val orphanColor   = R.color.orphan_ref   // points at non-existent     → no swatch ideally


// ── BUG #7 — Drawable hover squash sur vector non-carré ──────────────────────
// 👀 LOOK HERE: hover sur `ic_banner` ci-dessous.
// `ic_banner` est défini dans res/drawable/ic_banner.xml avec viewport 240×80
// (ratio 3:1 — banner). Le popup hover force `width=128 height=128` :
// l'image apparaît SQUASHÉE en carré, distordue.
// Tu devrais voir : banner large (3:1) preserving aspect ratio.
@Suppress("unused")
private val banner = R.drawable.ic_pokeball


// ─────────────────────────────────────────────────────────────────────────────
// Voir aussi :
//   - VisualBugsJavaDemo.java         pour BUG #4 (!! en Java)
//   - res/values/strings_plurals.xml  fixture pour BUGS #1, #2, #2bis
//   - res/values/colors_refs.xml      fixture pour BUG #3
//   - res/drawable/ic_banner.xml      fixture pour BUG #7
// ─────────────────────────────────────────────────────────────────────────────
