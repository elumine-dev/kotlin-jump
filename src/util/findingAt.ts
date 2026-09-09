/**
 * The finding a code action should act on, among those a scan produced for one
 * file.
 *
 * Matching on the line alone is not enough: a Kotlin `data class` declares its
 * fields on one line and an `enum class` its entries the same way, so the
 * lightbulb on the second one acted on the first, and the deletion removed the
 * wrong field. Every finding carries the column of its name, so the token under
 * the cursor decides. A scan can lag an edit, hence the fallback to the nearest
 * finding on that line rather than none at all.
 */
export function findingAt<T extends { line: number; character: number; name: string }>(
  findings: readonly T[] | undefined,
  position: { line: number; character: number },
): T | undefined {
  if (!findings?.length) return undefined;
  const onLine = findings.filter(f => f.line === position.line);
  if (onLine.length <= 1) return onLine[0];

  const covering = onLine.find(f =>
    position.character >= f.character && position.character <= f.character + f.name.length);
  if (covering) return covering;

  return onLine.reduce((best, f) =>
    Math.abs(f.character - position.character) < Math.abs(best.character - position.character) ? f : best);
}
