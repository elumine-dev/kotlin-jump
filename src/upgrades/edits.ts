import type { Dependency, EditSpan } from './model';

/**
 * The edits a bump produces.
 *
 * One span per version site, the bare literal only: quotes, spacing and the
 * trailing comment stay as they were. A batch applies back to front so that
 * no span shifts another.
 */

export function bumpEdit(dependency: Dependency, to: string): EditSpan | undefined {
  const site = dependency.versionSite;
  if (!site || to === site.text || to === '') return undefined;
  return { file: site.file, start: site.start, end: site.end, newText: to };
}

/** Descending by start within a file, files in their first appearance order. */
export function orderForApplying(edits: readonly EditSpan[]): EditSpan[] {
  const files = [...new Set(edits.map(e => e.file))];
  return files.flatMap(f => edits.filter(e => e.file === f).sort((a, b) => b.start - a.start));
}

/** Applies the spans of ONE file to its text. */
export function applyEdits(text: string, edits: readonly EditSpan[]): string {
  let out = text;
  for (const e of orderForApplying(edits)) out = out.slice(0, e.start) + e.newText + out.slice(e.end);
  return out;
}
