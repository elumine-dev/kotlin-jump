package com.example.util

// ─────────────────────────────────────────────────────────────────────────────
// DÉMO : Regex capture group coloring
//
// Chaque groupe de capture (…) doit recevoir une couleur distincte.
// Groupes imbriqués → couleurs différentes par profondeur.
// Groupes nommés (?P<name>…) → même comportement.
// Les cas (✗) sans groupe ne doivent pas être colorés.
// ─────────────────────────────────────────────────────────────────────────────

object Parsers {

    // ── Groupes simples ───────────────────────────────────────────────────────

    val DATE_RE     = Regex("(\\d{4})-(\\d{2})-(\\d{2})")
    //                       ^^^^^^^^  ^^^^^^^^  ^^^^^^^^
    //                       group 1   group 2   group 3

    val TIME_RE     = Regex("(\\d{1,2}):(\\d{2})(?::(\\d{2}))?")
    //                       ^^^^^^^^^  ^^^^^^^^     ^^^^^^^^
    //                       hours      minutes  non-capturing  seconds(opt)

    val EMAIL_RE    = Regex("([\\w.+]+)@([\\w.-]+)\\.([a-z]{2,})")
    //                       ^^^^^^^^^  ^^^^^^^^^^  ^^^^^^^^^^^
    //                       local      domain       TLD

    val VERSION_RE  = Regex("(\\d+)\\.(\\d+)\\.(\\d+)(?:-([\\w.]+))?(?:\\+([\\w.]+))?")
    //                       ^^^^^^   ^^^^^^   ^^^^^^       ^^^^^^^         ^^^^^^^
    //                       major    minor    patch        pre-release     build

    val URL_RE      = Regex("(https?)://([\\w.-]+)(?::(\\d+))?(/[^?#]*)?(?:\\?([^#]*))?(?:#(.*))?")
    //                       ^^^^^^^    ^^^^^^^^^^    ^^^^^^   ^^^^^^^^        ^^^^^^^      ^^^
    //                       scheme     host          port     path            query        fragment

    val PHONE_RE    = Regex("(?:\\+?(\\d{1,3}))?[-.\\s]?(\\d{3})[-.\\s]?(\\d{3})[-.\\s]?(\\d{4})")
    //                                ^^^^^^^^           ^^^^^^^^        ^^^^^^^^        ^^^^^^^^
    //                                country            area            exchange        subscriber

    val HEX_COLOR_RE = Regex("#([0-9A-Fa-f]{3,4}|[0-9A-Fa-f]{6}|[0-9A-Fa-f]{8})")
    //                         ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
    //                         group 1 — hex digits

    // ── Groupes imbriqués ─────────────────────────────────────────────────────

    val NESTED_RE   = Regex("(a(b(c)d)e)")
    //                       ^^^^^^^^^^^  group 1 (outer)
    //                         ^^^^^^^    group 2 (middle)
    //                           ^^^      group 3 (inner)

    val ISO_DATETIME_RE = Regex("((\\d{4})-(\\d{2})-(\\d{2}))T((\\d{2}):(\\d{2})(?::(\\d{2}))?)")
    //                           ^^^^^^^^^^^^^^^^^^^^^^^^^^^   ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
    //                           group 1 = date               group 5 = time

    // ── Groupes nommés ────────────────────────────────────────────────────────

    val NAMED_DATE_RE   = Regex("(?<year>\\d{4})-(?<month>\\d{2})-(?<day>\\d{2})")
    val NAMED_EMAIL_RE  = Regex("(?<local>[\\w.+]+)@(?<domain>[\\w.-]+)\\.(?<tld>[a-z]{2,})")
    val NAMED_LOG_RE    = Regex("(?<level>DEBUG|INFO|WARN|ERROR)\\s+(?<tag>[\\w.]+):\\s+(?<msg>.+)")
    val NAMED_SEMVER_RE = Regex("(?<major>\\d+)\\.(?<minor>\\d+)\\.(?<patch>\\d+)(?:-(?<pre>[\\w.]+))?")

    // ── Cas (✗) — pas de groupe de capture → pas de coloration ───────────────

    val NO_GROUP_DATE   = Regex("\\d{4}-\\d{2}-\\d{2}")            // (✗)
    val NO_GROUP_EMAIL  = Regex("[\\w.]+@[\\w.]+\\.[a-z]{2,}")      // (✗)
    val NO_GROUP_DIGITS = Regex("\\d+")                              // (✗)
    val PLAIN_LITERAL   = Regex("hello world")                       // (✗)

    // ── Non-capturing groups (?:…) → pas de coloration de groupe ─────────────

    val NON_CAPTURE_RE  = Regex("(?:https?|ftp)://([\\w.-]+)")
    //                           ^^^^^^^^^^^^^^  — non-capturing, pas coloré
    //                                            ^^^^^^^^^^^  — group 1, coloré

    // ── Alternation dans un groupe ────────────────────────────────────────────

    val PROTOCOL_RE     = Regex("(https?|ftp|ftps)://([\\w.-]+)(?::(\\d+))?")
    val COLOR_FORMAT_RE = Regex("(#[0-9A-Fa-f]{6}|rgb\\((\\d+),\\s*(\\d+),\\s*(\\d+)\\)|hsl\\((\\d+),\\s*(\\d+)%,\\s*(\\d+)%\\))")
}

// ── Utilisation dans des fonctions ───────────────────────────────────────────

fun parseDate(input: String): Triple<String, String, String>? {
    val match = Parsers.DATE_RE.matchEntire(input) ?: return null
    return Triple(match.groupValues[1], match.groupValues[2], match.groupValues[3])
}

fun parseEmail(input: String): Triple<String, String, String>? {
    val match = Parsers.EMAIL_RE.matchEntire(input) ?: return null
    return Triple(match.groupValues[1], match.groupValues[2], match.groupValues[3])
}

fun parseVersion(input: String): Map<String, String> {
    val match = Parsers.NAMED_SEMVER_RE.matchEntire(input) ?: return emptyMap()
    return mapOf(
        "major" to match.groups["major"]!!.value,
        "minor" to match.groups["minor"]!!.value,
        "patch" to match.groups["patch"]!!.value,
    )
}

// ── Utilisation inline dans des expressions ───────────────────────────────────

val CSV_RE      = Regex("\"([^\"]*)\"|([^,]+)")          // groupe 1 et 2
val WORD_BOUND  = Regex("\\b(\\w+)\\b")                  // groupe 1
val CAPTURE_ALL = Regex("^(\\s*)(\\S.*?)(\\s*)$")        // groupes 1, 2, 3

fun extractWords(text: String): List<String> =
    Regex("(\\w+)").findAll(text).map { it.groupValues[1] }.toList()

fun splitPath(path: String): Pair<String, String>? {
    val match = Regex("^(.*)/([^/]+)$").matchEntire(path) ?: return null
    return Pair(match.groupValues[1], match.groupValues[2])
}
