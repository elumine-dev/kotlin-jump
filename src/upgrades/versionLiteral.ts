import type { LiteralKind } from './model';

/**
 * What kind of version text a build wrote.
 *
 * Only an `exact` version can be compared with a repository and bumped. A
 * `dynamic` version (`4.+`, `latest.release`) moves on its own and deserves a
 * pin, not a bump. A `range` or a `rich` version (`strictly`, `prefer`,
 * `reject`) encodes a decision the tool cannot read and is left alone, as
 * Renovate and version-catalog-update leave it alone. A `templated` value
 * (`$kotlinVersion`, `libs.versions.x.get()`, a bare identifier) is not a
 * literal at all.
 */
export function classifyVersionLiteral(text: string): LiteralKind {
  const t = text.trim();
  if (t === '') return 'none';
  if (/\b(?:strictly|require|prefer|reject|rejectAll)\b/.test(t)) return 'rich';
  if (/^[[\](]/.test(t)) return 'range';
  if (t === '+' || t.endsWith('+') || t.startsWith('latest.')) return 'dynamic';
  // A version has a digit somewhere; a bare word is a variable.
  if (/^[0-9A-Za-z][A-Za-z0-9.\-+_]*$/.test(t) && /\d/.test(t)) return 'exact';
  return 'templated';
}
