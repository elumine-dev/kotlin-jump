/**
 * G43: the user's exclusions for the unused code families, read in one place.
 *
 * Find Everything Unused read them and Remove Everything Unused did not: a
 * name the user had excluded from the report was still deleted, and so was
 * code under `buildSrc/`, which `unusedSymbolsIgnorePaths` excludes by
 * default. Remove reads them here; a guard test holds every key Find reads
 * against `UNUSED_SETTING_KEYS`.
 */
export interface UnusedSettings {
  symbolsIgnoreNames: readonly string[];
  symbolsIgnorePaths: readonly string[];
  frameworkNameSuffixes: boolean;
  includeTestOnly: boolean;
  membersIgnoreNames: readonly string[];
  enumEntriesIgnoreNames: readonly string[];
  enumEntriesIncludeTestOnly: boolean;
  islandsIgnoreNames: readonly string[];
  islandsMaxSize: number;
  eventsIgnoreNames: readonly string[];
  eventsAssumeSubscribed: readonly string[];
  resourceKeysIgnorePrefixes: readonly string[];
  remoteConfigIgnoreNames: readonly string[];
  gradleIgnoreNames: readonly string[];
}

/** Each field, its `kotlinJump.*` key and the default Find Everything Unused uses. */
const KEYS: { [K in keyof UnusedSettings]: [string, UnusedSettings[K]] } = {
  symbolsIgnoreNames: ['unusedSymbolsIgnoreNames', []],
  symbolsIgnorePaths: ['unusedSymbolsIgnorePaths', ['**/buildSrc/**', '**/build-logic/**']],
  frameworkNameSuffixes: ['unusedSymbolsFrameworkNameSuffixes', false],
  includeTestOnly: ['unusedSymbolsIncludeTestOnly', true],
  membersIgnoreNames: ['unusedMembersIgnoreNames', []],
  enumEntriesIgnoreNames: ['unusedEnumEntriesIgnoreNames', []],
  enumEntriesIncludeTestOnly: ['unusedEnumEntriesIncludeTestOnly', true],
  islandsIgnoreNames: ['deadIslandsIgnoreNames', []],
  islandsMaxSize: ['deadIslandsMaxSize', 8],
  eventsIgnoreNames: ['unheardEventsIgnoreNames', []],
  eventsAssumeSubscribed: ['unheardEventsAssumeSubscribed', []],
  resourceKeysIgnorePrefixes: ['unusedResourceKeysIgnorePrefixes', []],
  remoteConfigIgnoreNames: ['unusedRemoteConfigKeysIgnoreNames', []],
  gradleIgnoreNames: ['unusedGradleDependenciesIgnoreNames', []],
};

export const UNUSED_SETTING_KEYS: readonly string[] = Object.values(KEYS).map(([key]) => key);

/** `get` is `vscode.workspace.getConfiguration('kotlinJump').get`, kept out so this runs anywhere. */
export function readUnusedSettings(get: <T>(key: string, fallback: T) => T): UnusedSettings {
  const out: Record<string, unknown> = {};
  for (const [field, [key, fallback]] of Object.entries(KEYS)) out[field] = get(key, fallback);
  return out as unknown as UnusedSettings;
}
