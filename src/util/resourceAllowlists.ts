/**
 * Names and paths the unused-resource detectors must never reason about.
 *
 * Shared by KJ-029 (dead resource files) and KJ-031 (dead values keys) so the
 * two cannot drift apart. Every entry here exists because a real project
 * produced a false positive without it.
 */

/**
 * Resources that ship inside AAR dependencies and land in the merged R.
 * Nothing in the project references them by name, and nothing should delete
 * them either. This is how we contain the AAR blind spot without reading
 * every dependency's R.txt.
 */
export const LIBRARY_PREFIXES = [
  'abc_', 'mtrl_', 'm3_', 'design_', 'notification_', 'preference_', 'browser_',
  'common_google_', 'googleg_', 'exo_', 'ime_', 'tooltip_', 'select_dialog_',
  'support_', 'expand_activities_', 'material_', 'androidx_',
];

/**
 * Configuration keys a third-party SDK reads BY NAME, at runtime, with zero
 * mention anywhere in project code. An audit of one 3444-file project found
 * 14 of these, every one of which would have been a confident false positive.
 */
export const SDK_OWNED_PREFIXES = [
  'com_braze_', 'com_appboy_', 'braze_', 'appboy_',
  'fb_', 'facebook_', 'com_facebook_',
  'google_api_key', 'google_app_id', 'google_crash_reporting_api_key',
  'google_storage_bucket', 'gcm_', 'default_web_client_id', 'project_id',
  'firebase_database_url', 'com_crashlytics_', 'io_fabric_',
  'onesignal_', 'branch_', 'io_branch_',
  'applovin_', 'admob_', 'com_google_android_gms_',
  'adjust_', 'amplitude_', 'mixpanel_', 'segment_',
  'appsflyer_', 'af_', 'intercom_', 'zendesk_',
  'airship_', 'urbanairship_', 'mparticle_', 'newrelic_',
  'sentry_', 'io_sentry_', 'datadog_', 'instabug_',
];

/**
 * The generic form of the rule above: a key whose name starts with a reversed
 * domain is owned by whoever owns that domain, not by this project. Catches
 * the SDKs nobody has added to the explicit list yet.
 */
export const VENDOR_NAMESPACED_RE = /^(com|io|org|net|de|fr|co|me|dev)_[a-z0-9]+_/;

/**
 * R8 and ProGuard write every resource name in the build into these files.
 * Reading one as evidence of a reference marks the whole project as alive:
 * 80 keys hinged on this in the audit. `ResourceCorpus.SOURCE_GLOB` happens
 * not to include `.txt` today, but the guard must not depend on that.
 */
const R8_ARTIFACT_RE = /[\\/](seeds|usage|mapping|resources|configuration)\.txt$/i;
const BUILD_DIR_RE = /[\\/](build|out|\.gradle|\.cxx|intermediates|outputs)[\\/]/;

/**
 * Static-analysis baselines: detekt, Android Lint, Spotbugs. Same failure mode
 * as the R8 artifacts above, different tool.
 *
 * A baseline is a DUMP OF NAMES recording which warnings to stay silent about.
 * It names a class without using it. One 904-line detekt baseline in a real
 * project listed 376 distinct class names, every one of which would read as a
 * live reference and hide genuinely dead code.
 */
const TOOL_BASELINE_RE = /[\\/][^\\/]*baseline[^\\/]*\.xml$/i;

export function isBuildArtifactPath(path: string): boolean {
  return R8_ARTIFACT_RE.test(path) || BUILD_DIR_RE.test(path) || TOOL_BASELINE_RE.test(path);
}

/** True when no detector in the family may ever flag this key name. */
export function isVendorOwnedName(name: string, extraPrefixes: readonly string[] = []): boolean {
  return (
    VENDOR_NAMESPACED_RE.test(name) ||
    SDK_OWNED_PREFIXES.some(p => name.startsWith(p)) ||
    LIBRARY_PREFIXES.some(p => name.startsWith(p)) ||
    extraPrefixes.some(p => p.length > 0 && name.startsWith(p))
  );
}
