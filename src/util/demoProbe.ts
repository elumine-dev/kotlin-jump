/**
 * Probe registry for demos and tests.
 *
 * VS Code exposes no API to read another extension's decorations: from the
 * outside there is no way to tell whether a badge or a graying is actually
 * on screen. Every decoration provider therefore publishes its current
 * count here, and the `kotlin-jump._probe` command returns the snapshot.
 * Demo scripts use it to refuse recording a GIF that would announce a
 * feature the viewer cannot see.
 */

const counts = new Map<string, number>();
const samples = new Map<string, string[]>();

/** Called by a provider right after each `setDecorations`. The optional
 *  `renderedTexts` lets a demo assert WHAT is painted (e.g. the folded
 *  string value after an edit), not just how many. */
export function reportDecorations(
  providerId: string,
  count: number,
  renderedTexts?: string[],
): void {
  counts.set(providerId, count);
  if (renderedTexts) samples.set(providerId, renderedTexts.slice(0, 50));
}

/** Snapshot of { providerId: number of decorations applied }. */
export function probeSnapshot(): Record<string, number> {
  return Object.fromEntries(counts);
}

/** Rendered texts last reported by a provider (empty if none). */
export function probeTexts(providerId: string): string[] {
  return samples.get(providerId) ?? [];
}
