import { parse } from '../indexer/KotlinParser';

/**
 * The new name of a Kotlin file whose namesake class a cut just took.
 *
 * `DueSection.kt` held `DueSection` and `LegacyDueSection`. The first went,
 * the second stayed alone in a file named after a class that no longer
 * exists, and detekt reported it twice (MatchingDeclarationName, Filename).
 * Seen on three open source apps. The fix is the rename a developer would
 * make: the file takes the name of the class left in it.
 *
 * Only a mismatch the cut created is fixed. The file must have been named
 * after a class of its own before the cut, so a file the project named
 * otherwise on purpose stays as it is.
 *
 * Kept where a rename could break something:
 * - `Foo.android.kt`, which multiplatform reads: no class bears that name;
 * - a file whose `FooKt` facade is spelled somewhere (Java, ProGuard), unless
 *   `@file:JvmName` fixes the facade name;
 * - a file whose name is spelled somewhere (a Gradle exclude, a baseline);
 * - a target that exists already, case-insensitively, since the disk may be.
 */
export function fileRenameAfterCut(
  path: string,
  before: string,
  after: string,
  others: readonly { path: string; text: string }[],
  taken: (path: string) => boolean,
): string | undefined {
  const m = /^(.*[\\/])?([^\\/]+)\.kt$/.exec(path);
  if (!m) return undefined;
  const dir = m[1] ?? '';
  const base = m[2];
  // Before any parse: almost every cut leaves the namesake where it was.
  const namesake = new RegExp(`\\b(?:class|object|interface)\\s+${base.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`);
  if (!namesake.test(before) || namesake.test(after)) return undefined;
  if (!topLevel(path, before).some(s => CLASS_KINDS.has(s.kind) && s.name === base)) return undefined;

  const decls = topLevel(path, after);
  const classes = decls.filter(s => CLASS_KINDS.has(s.kind) && !s.isPrivate);
  if (classes.length !== 1) return undefined;
  const cls = classes[0];
  // detekt's default `mustBeFirst`: a class below top-level functions is not reported.
  if (cls.name === base || decls[0] !== cls) return undefined;
  if (decls.some(s => s.kind === 'typealias' && s.name === base)) return undefined;

  const to = `${dir}${cls.name}.kt`;
  if (taken(to)) return undefined;
  const facade = /@file\s*:\s*JvmName\b/.test(after) ? undefined : new RegExp(`\\b${base}Kt\\b`);
  // `LegacyDueSection.kt` spells `DueSection.kt` too: the name must start there.
  const fileName = new RegExp(`(?<![\\w$])${base}\\.kt\\b`);
  for (const o of others) {
    // The `includes` only spares a regex on the thousands of files that cannot match.
    if (o.path === path || !o.text.includes(base)) continue;
    if (fileName.test(o.text) || (facade && facade.test(o.text))) return undefined;
  }
  return to;
}

const CLASS_KINDS = new Set(['class', 'dataClass', 'sealedClass', 'enum', 'interface', 'object', 'annotation']);

type Symbol = { name: string; kind: string; line: number; character: number; depth: number; isPrivate?: boolean; isLocal?: boolean };

/** Top-level declarations, in source order. */
function topLevel(path: string, text: string): Symbol[] {
  const { symbols } = parse(`file://${path}`, text) as { symbols: Symbol[] };
  return symbols
    .filter(s => s.depth === 0 && !s.isLocal)
    .sort((a, b) => a.line - b.line || a.character - b.character);
}
