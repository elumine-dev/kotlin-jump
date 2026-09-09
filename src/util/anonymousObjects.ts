import { SymbolEntry } from '../indexer/SymbolIndex';

/**
 * `$anon$<line>` is the parser's synthetic name for `object : Interface { }`.
 * It exists so the implementation count sees the object; it is not a name a
 * user ever typed, so it must never reach a panel, a breadcrumb or a search
 * result. 275 of them were listed in the Outline of one real project, and a
 * Cmd+T on "anon" returned nothing but those.
 */
export function isAnonymousObject(name: string): boolean {
  return name.startsWith('$anon$');
}

/** The `object` keyword the entry sits on: what a selection should cover. */
export const ANON_KEYWORD_LENGTH = 'object'.length;

/**
 * How the object reads in the source: `object : ViewTreeObserver.OnPreDrawListener`.
 *
 * A dotted supertype was split into its segments at parse time, with the
 * qualifiers recorded apart, so the written form is rebuilt by joining a
 * qualifier run to the name that follows it.
 */
export function anonymousObjectLabel(entry: {
  supertypes?: readonly string[];
  superQualifiers?: readonly string[];
  line: number;
}): string {
  const st = entry.supertypes;
  if (!st || st.length === 0) return `object (line ${entry.line + 1})`;
  const quals = entry.superQualifiers;
  const parts: string[] = [];
  for (let i = 0; i < st.length; i++) {
    let j = i;
    while (j < st.length - 1 && quals?.includes(st[j])) j++;
    parts.push(st.slice(i, j + 1).join('.'));
    i = j;
  }
  return `object : ${parts.join(', ')}`;
}

/** Display name for any entry, synthetic or not. */
export function displayName(entry: SymbolEntry): string {
  return isAnonymousObject(entry.name) ? anonymousObjectLabel(entry) : entry.name;
}
