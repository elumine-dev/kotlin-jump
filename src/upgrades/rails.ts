import type { Dependency, RailFinding } from './model';
import { compareVersions, sortVersions } from './gradleVersion';
import { bumpEdit } from './edits';

/**
 * Compatibility rails: a newer version is not always a safe one.
 *
 * KSP carries the Kotlin version it was built for in its own number
 * (`2.2.21-2.0.5`), so a KSP bump may silently demand a Kotlin bump; KSP 2.3
 * and later are versioned on their own. The Android Gradle plugin needs a
 * minimum Gradle, read from its release notes into `agp-gradle-matrix.json`
 * by `scripts/refresh-agp-gradle-matrix.ts`; a line the table does not know
 * produces nothing, never a guess. The Kotlin companion plugins ship with
 * Kotlin and must carry its version.
 */

export interface AgpGradleMatrix { asOf: string; source: string; minGradle: Record<string, string> }

export interface RailContext {
  kotlinVersion?: string;
  wrapperVersion?: string;
  agpVersion?: string;
  matrix?: AgpGradleMatrix;
}

export const KSP_GROUP = 'com.google.devtools.ksp';
const KSP_TWO_PART = /^(\d+\.\d+\.\d+(?:-(?:Beta|RC|M)\d*)?)-(\d+\.\d+\.\d+(?:-\w+)?)$/;
const KOTLIN_CORE_PLUGINS = new Set(['org.jetbrains.kotlin.jvm', 'org.jetbrains.kotlin.android', 'org.jetbrains.kotlin.multiplatform', 'org.jetbrains.kotlin.js']);

export function kspKotlinPrefix(version: string): string | undefined {
  return KSP_TWO_PART.exec(version)?.[1];
}

/** The newest KSP built for `kotlinVersion`, or undefined. */
export function kspFor(kotlinVersion: string, kspVersions: readonly string[]): string | undefined {
  const matching = kspVersions.filter(v => kspKotlinPrefix(v) === kotlinVersion);
  return matching.length === 0 ? undefined : sortVersions(matching)[matching.length - 1 - (matching.length - sortVersions(matching).length)];
}

export function isKsp(dependency: Dependency): boolean {
  return dependency.members.some(m => m.group === KSP_GROUP);
}

export function kspRail(dependency: Dependency, kspVersions: readonly string[] | undefined, ctx: RailContext): RailFinding | undefined {
  if (!isKsp(dependency) || !dependency.currentVersion || !ctx.kotlinVersion) return undefined;
  const prefix = kspKotlinPrefix(dependency.currentVersion);
  if (!prefix || prefix === ctx.kotlinVersion) return undefined;
  const compatiblePick = kspVersions ? kspFor(ctx.kotlinVersion, kspVersions) : undefined;
  const tail = compatiblePick
    ? `Latest for Kotlin ${ctx.kotlinVersion} is ${compatiblePick}`
    : `No KSP release for Kotlin ${ctx.kotlinVersion} is published`;
  const edit = compatiblePick ? bumpEdit(dependency, compatiblePick) : undefined;
  return {
    rail: 'ksp-kotlin', dependency, expected: ctx.kotlinVersion, actual: prefix,
    message: `ksp ${dependency.currentVersion}: built for Kotlin ${prefix}, this build uses Kotlin ${ctx.kotlinVersion}. ${tail}`,
    ...(compatiblePick ? { compatiblePick } : {}),
    ...(edit ? { edits: [edit] } : {}),
  };
}

/** `9.4.0-rc01` reads the `9.4` line of the table. */
export function agpMinimumGradle(agpVersion: string, matrix: AgpGradleMatrix | undefined): string | undefined {
  const line = /^(\d+\.\d+)/.exec(agpVersion)?.[1];
  return line && matrix ? matrix.minGradle[line] : undefined;
}

export function agpGradleRail(dependency: Dependency, ctx: RailContext): RailFinding | undefined {
  if (dependency.kind !== 'agp' || !dependency.currentVersion || !ctx.wrapperVersion) return undefined;
  const min = agpMinimumGradle(dependency.currentVersion, ctx.matrix);
  if (!min || compareVersions(ctx.wrapperVersion, min) >= 0) return undefined;
  return {
    rail: 'agp-gradle', dependency, expected: min, actual: ctx.wrapperVersion,
    message: `agp ${dependency.currentVersion} needs Gradle ${min}, the wrapper is ${ctx.wrapperVersion}`,
  };
}

function isKotlinCompanion(id: string): boolean {
  return id.startsWith('org.jetbrains.kotlin.') && !KOTLIN_CORE_PLUGINS.has(id);
}

export function kotlinFamilyRail(dependency: Dependency, ctx: RailContext): RailFinding | undefined {
  if (dependency.kind !== 'plugin' || !dependency.currentVersion || !ctx.kotlinVersion) return undefined;
  const id = dependency.members[0]?.group ?? '';
  if (!isKotlinCompanion(id) || dependency.currentVersion === ctx.kotlinVersion) return undefined;
  const edit = bumpEdit(dependency, ctx.kotlinVersion);
  return {
    rail: 'kotlin-family', dependency, expected: ctx.kotlinVersion, actual: dependency.currentVersion,
    message: `${id} ${dependency.currentVersion} does not match Kotlin ${ctx.kotlinVersion}`,
    compatiblePick: ctx.kotlinVersion,
    ...(edit ? { edits: [edit] } : {}),
  };
}

/**
 * The versions the rails compare against, read from the dependencies
 * themselves. Two Kotlin core plugins declared with different versions mean
 * nobody can say which Kotlin the build uses: no rail then.
 */
export function readRailContext(dependencies: readonly Dependency[], matrix: AgpGradleMatrix | undefined): RailContext {
  const kotlin = new Set<string>();
  let agpVersion: string | undefined;
  let wrapperVersion: string | undefined;
  for (const d of dependencies) {
    if (!d.currentVersion) continue;
    if (d.kind === 'wrapper') wrapperVersion = d.currentVersion;
    if (d.kind === 'agp') agpVersion = d.currentVersion;
    if (d.members.some(m => KOTLIN_CORE_PLUGINS.has(m.group))) kotlin.add(d.currentVersion);
  }
  return {
    ...(kotlin.size === 1 ? { kotlinVersion: [...kotlin][0] } : {}),
    ...(agpVersion ? { agpVersion } : {}),
    ...(wrapperVersion ? { wrapperVersion } : {}),
    ...(matrix ? { matrix } : {}),
  };
}
