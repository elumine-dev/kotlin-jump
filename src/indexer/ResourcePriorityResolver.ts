/**
 * KJ-017 — Resource Shadowing : encodes the Gradle priority rules used to
 * arbitrate between several definitions of the same resource name.
 *   app > library ; flavor/source set > main ; qualified folders
 *   (values-fr, values-night…) are configuration overlays, NOT competitors:
 *   the selection happens at runtime, not at merge time.
 */

export interface ResourceDefinition {
  module: string;
  moduleType: 'app' | 'library';
  /** 'main' or a flavor/source set name. */
  sourceSet: string;
  /** res folder: 'values', 'values-fr', 'values-night'… */
  folder: string;
  value: string;
}

export interface ResolvedPriority {
  /** Index of the winning definition in the input array. */
  winner: number;
  /** Indexes of the shadowed definitions (losers of the Gradle merge). */
  shadowed: number[];
  /** Indexes of the configuration/locale overlays (out of competition). */
  localeOverlays: number[];
}

function isOverlay(def: ResourceDefinition): boolean {
  return def.folder !== 'values' && def.folder.includes('-');
}

function score(def: ResourceDefinition): number {
  let s = def.moduleType === 'app' ? 100 : 10;
  if (def.sourceSet !== 'main') s += 50;
  return s;
}

export function resolveWinner(defs: ResourceDefinition[]): ResolvedPriority {
  const localeOverlays: number[] = [];
  const competitors: number[] = [];

  defs.forEach((d, i) => {
    if (isOverlay(d)) localeOverlays.push(i);
    else competitors.push(i);
  });

  if (competitors.length === 0) {
    return { winner: 0, shadowed: [], localeOverlays };
  }

  let winner = competitors[0];
  for (const i of competitors) {
    if (score(defs[i]) > score(defs[winner])) winner = i;
  }

  return {
    winner,
    shadowed: competitors.filter(i => i !== winner),
    localeOverlays,
  };
}
