/**
 * Shared resource-reference walker for Android XML and Kotlin/Java sources.
 *
 * Extracted from ResourceUsageBadgeProvider (KJ-021) so KJ-029 does not become
 * the eighth hand-rolled copy of these regexes in the repo. The `tools:`
 * handling is the whole point: a `tools:layout="@layout/x"` is design-time
 * scaffolding, not a reference, and mistaking one for the other is the classic
 * false positive of every unused-resource detector.
 */

/**
 * Blanks `//` and block comments, keeping string CONTENTS, offsets and line
 * breaks intact. Used wherever a name mentioned in a literal counts as a real
 * reference (a resource loaded by name, a class named for reflection).
 *
 * The `raw` mode matters: a `"""…"""` literal spans lines, and without it a
 * newline dropped the scanner back to code mode, so a `//` on a later line of
 * the literal blanked live content. That silently deleted references.
 */
export function stripKotlinComments(text: string): string {
  const out: string[] = [];
  let mode: 'code' | 'line' | 'block' | 'string' | 'raw' = 'code';
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const two = text.slice(i, i + 2);
    if (mode === 'code') {
      if (two === '//') { mode = 'line'; out.push('  '); i++; continue; }
      if (two === '/*') { mode = 'block'; out.push('  '); i++; continue; }
      if (text.startsWith('"""', i)) { mode = 'raw'; out.push('"""'); i += 2; continue; }
      if (ch === '"') mode = 'string';
      out.push(ch);
    } else if (mode === 'line') {
      if (ch === '\n') { mode = 'code'; out.push('\n'); } else out.push(' ');
    } else if (mode === 'block') {
      if (two === '*/') { mode = 'code'; out.push('  '); i++; continue; }
      out.push(ch === '\n' ? '\n' : ' ');
    } else if (mode === 'raw') {
      // A raw string closes on the LAST three quotes of the run.
      if (ch === '"') {
        let run = 0;
        while (i + run < text.length && text[i + run] === '"') run++;
        if (run >= 3) { mode = 'code'; out.push('"'.repeat(run)); i += run - 1; continue; }
      }
      out.push(ch);
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

// ── KJ-031: references to a KEY inside values*, not to a resource FILE ───────
//
// The collectors above stop at `[A-Za-z_]\w*`, which is right for file names
// but cuts `Widget.Kj.Button` in half. These accept dots, and cover the three
// reference forms that are not `@kind/name` at all: a bare style parent, a
// `?attr/` theme reference, and `R.styleable.X_y` where the attr name is only
// a SUFFIX of the token.

/** aapt maps `.` to `_`, so `@style/A.B` and `R.style.A_B` are one resource. */
export function normalizeResourceName(name: string): string {
  return name.replace(/\./g, '_');
}

/**
 * Every `@kind/name` (XML) or `R.kind.name` (Kotlin/Java) reference, dotted
 * names included. `path` picks the dialect; `tools:` handling is inherited.
 */
export function collectValueResourceRefs(
  text: string,
  path: string,
  kinds: readonly string[],
): ResourceRef[] {
  const out: ResourceRef[] = [];
  const group = kinds.join('|');
  let m: RegExpExecArray | null;

  if (/\.(kt|kts|java)$/.test(path)) {
    const clean = stripKotlinComments(text);
    const re = new RegExp(`\\bR2?\\.(${group})\\.([A-Za-z_][\\w.]*)\\b`, 'g');
    while ((m = re.exec(clean)) !== null) out.push({ kind: m[1], name: m[2] });
    return out;
  }

  const clean = blankToolsAttributes(stripXmlComments(text));
  // `(?<![\w:])` keeps `@android:color/white` out: the namespace is not ours.
  const re = new RegExp(`@(?<!@\\w*:)(${group})/([A-Za-z_][\\w.]*)`, 'g');
  while ((m = re.exec(clean)) !== null) {
    const before = clean.slice(Math.max(0, m.index - 12), m.index);
    if (/@\w+:$/.test(`${before}@`)) continue;
    if (/[\w:]$/.test(clean.slice(Math.max(0, m.index - 1), m.index))) continue;
    out.push({ kind: m[1], name: m[2] });
  }
  return out;
}

/** `parent="Base"` and `parent="@style/Base"`, platform parents excluded. */
export function collectStyleParentRefs(xml: string): Set<string> {
  const out = new Set<string>();
  const clean = stripXmlComments(xml);
  const re = /\bparent\s*=\s*"(@(?:(\w+):)?style\/)?([A-Za-z_][\w.]*)"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(clean)) !== null) {
    if (m[2]) continue; // @android:style/…
    out.add(m[3]);
  }
  return out;
}

/**
 * Implicit dot inheritance: declaring `Widget.Kj.Button.Primary` keeps
 * `Widget.Kj.Button`, `Widget.Kj` and `Widget` alive. This is the only
 * reference form with NO textual occurrence of the referenced name anywhere,
 * so missing it deletes the parent of a live style.
 */
export function styleParentClosure(names: readonly string[]): Set<string> {
  const out = new Set<string>();
  for (const name of names) {
    let cut = name.lastIndexOf('.');
    while (cut > 0) {
      out.add(name.slice(0, cut));
      cut = name.lastIndexOf('.', cut - 1);
    }
  }
  return out;
}

/**
 * `?attr/name` and `?name` theme references. The value must BE the reference:
 * a `<string>` holding `https://x?y=1` must not resurrect an attr named `y`.
 */
export function collectThemeAttrRefs(xml: string): Set<string> {
  const out = new Set<string>();
  const clean = blankToolsAttributes(stripXmlComments(xml));
  const VALUE_RE = /^\?(?:(\w+):)?(?:attr\/)?([A-Za-z_][\w.]*)$/;

  ATTR_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = ATTR_RE.exec(clean)) !== null) {
    const hit = VALUE_RE.exec(m[3].trim());
    if (hit && !hit[1]) out.add(hit[2]);
  }
  const TEXT_RE = />\s*(\?[^<\s]*)\s*</g;
  while ((m = TEXT_RE.exec(clean)) !== null) {
    const hit = VALUE_RE.exec(m[1]);
    if (hit && !hit[1]) out.add(hit[2]);
  }
  return out;
}

/**
 * Whole `R.styleable.Xxx_yyy` tokens. Never split them: both halves can
 * contain `_`, so the split is ambiguous. Test membership by suffix instead.
 */
export function collectStyleableTokens(code: string): Set<string> {
  const out = new Set<string>();
  const re = /\bR2?\.styleable\.(\w+)\b/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(stripKotlinComments(code))) !== null) out.add(m[1]);
  return out;
}

/** True when some styleable token names this attr. */
export function styleableCovers(tokens: ReadonlySet<string>, attr: string): boolean {
  const suffix = `_${normalizeResourceName(attr)}`;
  for (const token of tokens) if (token.endsWith(suffix)) return true;
  return false;
}

/** `<item name="x">` inside a `<style>` names the attr the style sets. */
export function collectStyleItemAttrNames(xml: string): Set<string> {
  const out = new Set<string>();
  const clean = stripXmlComments(xml);
  const STYLE_RE = /<style\b[^>]*>([\s\S]*?)<\/style>/g;
  let block: RegExpExecArray | null;
  while ((block = STYLE_RE.exec(clean)) !== null) {
    const ITEM_RE = /<item\b[^>]*\bname\s*=\s*"([^"]+)"/g;
    let item: RegExpExecArray | null;
    while ((item = ITEM_RE.exec(block[1])) !== null) {
      if (item[1].includes(':')) continue; // android:textColor is the platform's
      out.add(item[1]);
    }
  }
  return out;
}

/**
 * Blanks the VALUE of `name="…"` so a declaration cannot resurrect itself.
 *
 * This is the highest-severity trap in KJ-031: `collectStringLiterals` matches
 * `name="kj_dead"` like any other literal, so harvesting literals from a values
 * file would mark every key in the workspace as used. Length-preserving.
 */
export function blankValueDeclarationNames(xml: string): string {
  const chars = [...xml];
  const re = /\bname\s*=\s*"([^"]*)"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) {
    const valueStart = m.index + m[0].length - 1 - m[1].length;
    for (let i = valueStart; i < valueStart + m[1].length; i++) {
      if (chars[i] !== '\n') chars[i] = ' ';
    }
  }
  return chars.join('');
}
