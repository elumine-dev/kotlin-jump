/**
 * Shared resource-reference walker for Android XML and Kotlin/Java sources.
 *
 * Extracted from ResourceUsageBadgeProvider (KJ-021) so KJ-029 does not become
 * the eighth hand-rolled copy of these regexes in the repo. The `tools:`
 * handling is the whole point: a `tools:layout="@layout/x"` is design-time
 * scaffolding, not a reference, and mistaking one for the other is the classic
 * false positive of every unused-resource detector.
 */

/** Blanks `//` and block comments, keeping offsets and line breaks intact. */
export function stripKotlinComments(text: string): string {
  const out: string[] = [];
  let mode: 'code' | 'line' | 'block' | 'string' = 'code';
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const two = text.slice(i, i + 2);
    if (mode === 'code') {
      if (two === '//') { mode = 'line'; out.push('  '); i++; continue; }
      if (two === '/*') { mode = 'block'; out.push('  '); i++; continue; }
      if (ch === '"') mode = 'string';
      out.push(ch);
    } else if (mode === 'line') {
      if (ch === '\n') { mode = 'code'; out.push('\n'); } else out.push(' ');
    } else if (mode === 'block') {
      if (two === '*/') { mode = 'code'; out.push('  '); i++; continue; }
      out.push(ch === '\n' ? '\n' : ' ');
    } else {
      if (ch === '\\') { out.push(two); i++; continue; }
      if (ch === '"' || ch === '\n') mode = 'code';
      out.push(ch);
    }
  }
  return out.join('');
}

/** Blanks `<!-- … -->`, keeping offsets and line breaks intact. */
export function stripXmlComments(text: string): string {
  return text.replace(/<!--[\s\S]*?-->/g, m => m.replace(/[^\n]/g, ' '));
}

/** Namespace-aware attribute walker: `prefix:name="value"`. */
export const ATTR_RE = /([A-Za-z_][\w]*)(?::([A-Za-z_][\w.]*))?\s*=\s*"([^"]*)"/g;

/**
 * Blanks the VALUE of every `tools:` attribute, with one exception:
 * `tools:keep` is the shrinker keep-list, so its contents are real references.
 * Length-preserving, so offsets computed on the result stay valid.
 */
export function blankToolsAttributes(xml: string): string {
  const chars = [...xml];
  ATTR_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = ATTR_RE.exec(xml)) !== null) {
    const prefix = m[2] !== undefined ? m[1] : undefined;
    const attr = m[2] ?? m[1];
    if (prefix !== 'tools' || attr === 'keep') continue;
    // blank the value only, quotes included stay put
    const valueStart = m.index + m[0].lastIndexOf('"', m[0].length - 2) + 1;
    const valueEnd = m.index + m[0].length - 1;
    for (let i = valueStart; i < valueEnd; i++) {
      if (chars[i] !== '\n') chars[i] = ' ';
    }
  }
  return chars.join('');
}

export interface ResourceRef {
  kind: string;
  name: string;
}

/**
 * Every `@kind/name` in an XML document, attributes and element text alike,
 * after comments and `tools:` values are blanked. One pass replaces the
 * attribute-walk plus element-text scan the older code did separately.
 *
 * `@android:drawable/x` never matches: the regex requires the kind right
 * after `@`, and `android:` is not a kind.
 */
export function collectXmlResourceRefs(xml: string, kinds: readonly string[]): ResourceRef[] {
  const clean = blankToolsAttributes(stripXmlComments(xml));
  const re = new RegExp(`@(${kinds.join('|')})/([A-Za-z_]\\w*)`, 'g');
  const out: ResourceRef[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(clean)) !== null) out.push({ kind: m[1], name: m[2] });
  return out;
}

/** Every `R.kind.name` (and `R2.`) in Kotlin/Java, comments excluded. */
export function collectCodeResourceRefs(code: string, kinds: readonly string[]): ResourceRef[] {
  const clean = stripKotlinComments(code);
  const re = new RegExp(`\\bR2?\\.(${kinds.join('|')})\\.([A-Za-z_]\\w*)\\b`, 'g');
  const out: ResourceRef[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(clean)) !== null) out.push({ kind: m[1], name: m[2] });
  return out;
}

/**
 * Bare string literals. A resource loaded dynamically is usually named by a
 * literal somewhere; counting those trades recall for safety.
 */
export function collectStringLiterals(text: string): Set<string> {
  const out = new Set<string>();
  const re = /"([A-Za-z_][\w]*)"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) out.add(m[1]);
  return out;
}

/**
 * ViewBinding / DataBinding class tokens (`ActivityMainBinding`). For a modern
 * layout this is often the ONLY reference, so missing it would flag live
 * layouts as dead.
 */
export function bindingClassTokens(code: string): Set<string> {
  const out = new Set<string>();
  const re = /\b([A-Z]\w*)Binding(?:Impl)?\b/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(code)) !== null) out.add(m[1]);
  return out;
}

/** `activity_main` → `ActivityMain`, the binding class stem. */
export function bindingStemOf(resourceName: string): string {
  return resourceName
    .split('_')
    .filter(part => part.length > 0)
    .map(part => part[0].toUpperCase() + part.slice(1))
    .join('');
}
