/**
 * Plain-English descriptions for the most common suppression IDs in
 * Kotlin + Android + Java toolchains. Used by `SuppressHoverProvider`
 * to turn `@Suppress("UNCHECKED_CAST")` into useful context on hover.
 *
 * Scope:
 *   - Kotlin compiler warnings (UNCHECKED_CAST, NAME_SHADOWING, etc.)
 *   - Android Lint checks (MissingPermission, NewApi, HardcodedText, etc.)
 *   - Java/javac warnings passed through @SuppressWarnings
 *
 * Dictionary is intentionally static — generating it at runtime from the
 * Kotlin compiler or Android lint tooling would require shipping either,
 * which we refuse to do. The trade-off is that new or unusual IDs fall
 * through to no hover. Add them here as needed.
 */

export interface SuppressionDescription {
  /** Category shown first in the hover ("Kotlin warning", "Android Lint", etc.) */
  kind:    string;
  /** Plain-English explanation — one or two short sentences. */
  text:    string;
  /** Optional URL to the canonical documentation for this rule. */
  docUrl?: string;
}

/** Official Kotlin reference for compiler-diagnostic IDs. Per-ID anchors
 *  are not stable across Kotlin versions, so we use the root. */
const KOTLIN_DOCS = 'https://kotlinlang.org/docs/reference/';

/** Android lint docs don't have stable per-check URLs either — `checks/`
 *  listing is the cleanest anchor. */
const LINT_DOCS = 'https://googlesamples.github.io/android-custom-lint-rules/checks/';

export const SUPPRESS_DESCRIPTIONS: Record<string, SuppressionDescription> = {
  // ── Kotlin compiler warnings ─────────────────────────────────────────

  'UNCHECKED_CAST': {
    kind: 'Kotlin warning',
    text: 'Cast to a generic type whose type arguments cannot be verified at runtime. Safe only when you know the runtime shape matches.',
    docUrl: KOTLIN_DOCS,
  },
  'UNUSED_PARAMETER': {
    kind: 'Kotlin warning',
    text: 'A function parameter is never read in the body. Often suppressed when a parameter is required by an interface contract but unused in the override.',
    docUrl: KOTLIN_DOCS,
  },
  'UNUSED_VARIABLE': {
    kind: 'Kotlin warning',
    text: 'A local variable is declared but never read. Consider removing it unless it captures a side effect (e.g. property delegate).',
    docUrl: KOTLIN_DOCS,
  },
  'UNUSED_EXPRESSION': {
    kind: 'Kotlin warning',
    text: 'An expression whose result is computed but discarded. Usually indicates a missing `=` or a misplaced side effect.',
    docUrl: KOTLIN_DOCS,
  },
  'UNUSED': {
    kind: 'Kotlin warning',
    text: 'Declared symbol (class, property, function) has no references anywhere in the project. Suppress only when it is part of a public API.',
    docUrl: KOTLIN_DOCS,
  },
  'NAME_SHADOWING': {
    kind: 'Kotlin warning',
    text: 'A local name hides an enclosing parameter or variable with the same name. Readable code avoids this; suppress only when renaming is harder.',
    docUrl: KOTLIN_DOCS,
  },
  'DEPRECATION': {
    kind: 'Kotlin warning',
    text: 'The symbol is annotated `@Deprecated`. Prefer migrating to the replacement before suppressing.',
    docUrl: KOTLIN_DOCS,
  },
  'OVERRIDE_DEPRECATION': {
    kind: 'Kotlin warning',
    text: 'Overriding a deprecated function. Usually forced when implementing a platform interface whose method you cannot remove.',
    docUrl: KOTLIN_DOCS,
  },
  'NOTHING_TO_INLINE': {
    kind: 'Kotlin warning',
    text: 'An `inline fun` contains no lambda parameters, so inlining offers no benefit. Either remove `inline` or accept that this is intentional.',
    docUrl: KOTLIN_DOCS,
  },
  'OPT_IN_USAGE': {
    kind: 'Kotlin warning',
    text: 'Using an API marked `@RequiresOptIn`. Either annotate the caller with `@OptIn(...)` or suppress at the suppression site after reviewing the API contract.',
    docUrl: KOTLIN_DOCS,
  },
  'OPT_IN_USAGE_ERROR': {
    kind: 'Kotlin error',
    text: 'Using an API marked `@RequiresOptIn(level = ERROR)` without the corresponding `@OptIn`. Suppressing is almost never right — migrate instead.',
    docUrl: KOTLIN_DOCS,
  },
  'EXPERIMENTAL_API_USAGE': {
    kind: 'Kotlin warning (legacy)',
    text: 'Pre-1.7 name for `OPT_IN_USAGE`. Still seen in older code; consider migrating the annotation to `@OptIn` or the newer ID.',
    docUrl: KOTLIN_DOCS,
  },
  'INAPPLICABLE_JVM_NAME': {
    kind: 'Kotlin warning',
    text: '`@JvmName` is ignored in this context (e.g. an inline function or an extension property getter that cannot be renamed for the JVM).',
    docUrl: KOTLIN_DOCS,
  },
  'REDUNDANT_OVERRIDE': {
    kind: 'Kotlin warning',
    text: 'The overriding function calls `super()` with no change in behavior — delete it.',
    docUrl: KOTLIN_DOCS,
  },
  'REDUNDANT_VISIBILITY_MODIFIER': {
    kind: 'Kotlin warning',
    text: '`public` is the default; specifying it explicitly is redundant.',
    docUrl: KOTLIN_DOCS,
  },
  'UNCHECKED_CAST_TO_EXTERNAL_INTERFACE': {
    kind: 'Kotlin/JS warning',
    text: 'Cast to an `external` (JS) interface cannot be verified. Only seen in Kotlin/JS code.',
    docUrl: KOTLIN_DOCS,
  },
  'RedundantSuppression': {
    kind: 'IDE warning',
    text: 'A `@Suppress` annotation suppresses a warning that was never going to fire here. Delete it.',
  },
  'LongLogTag': {
    kind: 'Android Log warning',
    text: 'The TAG string passed to `Log.*` exceeds 23 characters — older Android releases truncate it silently.',
  },

  // ── Android Lint ─────────────────────────────────────────────────────

  'MissingPermission': {
    kind: 'Android Lint',
    text: 'Calling a protected API without having declared the matching permission in the manifest. Add `<uses-permission>` or a runtime check.',
    docUrl: LINT_DOCS + 'MissingPermission.md.html',
  },
  'NewApi': {
    kind: 'Android Lint',
    text: 'Using an API that is not available on your `minSdkVersion`. Guard with `Build.VERSION.SDK_INT >= ...` or annotate the caller with `@RequiresApi`.',
    docUrl: LINT_DOCS + 'NewApi.md.html',
  },
  'UnusedResources': {
    kind: 'Android Lint',
    text: 'A resource (string, drawable, layout…) declared but never referenced. Safe to delete unless referenced by name at runtime.',
    docUrl: LINT_DOCS + 'UnusedResources.md.html',
  },
  'HardcodedText': {
    kind: 'Android Lint',
    text: 'A literal string in a layout cannot be translated. Move it to `strings.xml` and reference with `@string/…`.',
    docUrl: LINT_DOCS + 'HardcodedText.md.html',
  },
  'ViewConstructor': {
    kind: 'Android Lint',
    text: 'Custom View is missing the `(Context, AttributeSet)` constructor the XML inflater requires.',
    docUrl: LINT_DOCS + 'ViewConstructor.md.html',
  },
  'CustomViewStyleable': {
    kind: 'Android Lint',
    text: 'Custom View with `declare-styleable` whose name does not match the View class name — IDE integration (layout preview, attribute completion) will misbehave.',
    docUrl: LINT_DOCS + 'CustomViewStyleable.md.html',
  },
  'SetTextI18n': {
    kind: 'Android Lint',
    text: 'Building display text with string concatenation bypasses localisation. Use `getString(R.string.x, …)` with format args instead.',
    docUrl: LINT_DOCS + 'SetTextI18n.md.html',
  },
  'InflateParams': {
    kind: 'Android Lint',
    text: 'Passing `null` as the parent to `LayoutInflater.inflate` drops `layout_*` attributes. Pass the real parent (and `attachToRoot = false`).',
    docUrl: LINT_DOCS + 'InflateParams.md.html',
  },
  'ClickableViewAccessibility': {
    kind: 'Android Lint',
    text: '`View.onTouchEvent` overridden without `performClick()` — screen readers cannot announce the interaction.',
    docUrl: LINT_DOCS + 'ClickableViewAccessibility.md.html',
  },
  'RtlHardcoded': {
    kind: 'Android Lint',
    text: 'Layout uses `left`/`right` which do not mirror for RTL locales. Use `start`/`end`.',
    docUrl: LINT_DOCS + 'RtlHardcoded.md.html',
  },
  'DefaultLocale': {
    kind: 'Android Lint',
    text: 'String formatting without an explicit `Locale` depends on the device locale — prod bugs happen when a developer on en-US does not think about tr-TR.',
    docUrl: LINT_DOCS + 'DefaultLocale.md.html',
  },
  'SimpleDateFormat': {
    kind: 'Android Lint',
    text: 'Constructing `SimpleDateFormat` without a locale parameter. Same locale hazard as `DefaultLocale`.',
    docUrl: LINT_DOCS + 'SimpleDateFormat.md.html',
  },
  'ResourceAsColor': {
    kind: 'Android Lint',
    text: 'Passing a resource ID (int) where a color int is expected. Call `ContextCompat.getColor(...)` first.',
    docUrl: LINT_DOCS + 'ResourceAsColor.md.html',
  },
  'BatteryLife': {
    kind: 'Android Lint',
    text: 'Using an API that can drain the battery significantly. Review whether the functionality is worth the cost or if a lighter alternative exists.',
    docUrl: LINT_DOCS + 'BatteryLife.md.html',
  },
  'WakelockTimeout': {
    kind: 'Android Lint',
    text: '`PowerManager.WakeLock.acquire()` without a timeout — a leak keeps the CPU awake forever. Pass the shortest timeout that makes sense.',
    docUrl: LINT_DOCS + 'WakelockTimeout.md.html',
  },
  'GradleDependency': {
    kind: 'Android Lint',
    text: 'A newer version of this dependency is available. Upgrade, or pin explicitly and justify in a comment.',
    docUrl: LINT_DOCS + 'GradleDependency.md.html',
  },
  'ObsoleteLintCustomCheck': {
    kind: 'Android Lint',
    text: 'The custom lint rule was compiled against an older lint API and may not work on newer versions.',
    docUrl: LINT_DOCS + 'ObsoleteLintCustomCheck.md.html',
  },
  'InvalidPackage': {
    kind: 'Android Lint',
    text: 'A dependency references classes from a package not available on Android (e.g. `java.awt`).',
    docUrl: LINT_DOCS + 'InvalidPackage.md.html',
  },

  // ── javac / @SuppressWarnings ────────────────────────────────────────

  'unchecked': {
    kind: 'javac warning',
    text: 'Unchecked operation on a parameterised type — the compiler cannot verify the cast at compile time. Common in pre-generics Java interop.',
  },
  'rawtypes': {
    kind: 'javac warning',
    text: 'Using a generic type without its type parameters (e.g. `List` instead of `List<String>`). Type safety is lost.',
  },
  'unused': {
    kind: 'javac warning',
    text: 'A declared element (parameter, local, method) has no references. Delete, or suppress only when required by a framework contract.',
  },
  'deprecation': {
    kind: 'javac warning',
    text: 'Using a symbol annotated `@Deprecated`.',
  },
  'serial': {
    kind: 'javac warning',
    text: '`Serializable` class without a `serialVersionUID` field. Declare one to stabilise the serialised form across versions.',
  },
  'cast': {
    kind: 'javac warning',
    text: 'Cast that the compiler considers redundant (already known to succeed at compile time).',
  },
};

/** Case-aware lookup. Kotlin uses UPPER_SNAKE_CASE; javac lowercase;
 *  Android Lint PascalCase. All three map directly — no normalisation. */
export function lookupSuppression(id: string): SuppressionDescription | undefined {
  return SUPPRESS_DESCRIPTIONS[id];
}
