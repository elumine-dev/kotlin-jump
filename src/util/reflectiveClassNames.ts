/**
 * G68: the package-qualified prefixes a reflective class lookup can reach.
 *
 * `Class.forName("com.x.plugins.Plugin" + n)` names no class whole, so the
 * literal harvest never sees `Plugin0`, `Plugin1`... and they were cut while
 * loaded at runtime. Same pattern as G54 for `getIdentifier`: the literal
 * start of the name says what can be reached, and nothing more.
 *
 * A prefix without a package (`"Plugin" + n`) would only resolve against the
 * default package, so it protects nothing. A name computed whole
 * (`Class.forName(className)`) stays out of reach, as deadIslands states.
 */
const LOOKUP_RE = /\b(?:Class\.forName|loadClass)\s*\(/g;

/** Read on code with comments stripped and strings kept. */
export function reflectiveClassPrefixes(code: string): string[] {
  const out: string[] = [];
  LOOKUP_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = LOOKUP_RE.exec(code)) !== null) {
    const arg = firstArgument(code, m.index + m[0].length);
    const prefix = /^(?:String\.format\s*\(\s*)?"([\w.]*)(?:"\s*\+|\$|%)/.exec(arg)?.[1] ?? '';
    if (prefix.includes('.')) out.push(prefix);
  }
  return out;
}

/** The first top level argument of a call whose `(` ends just before `from`. */
function firstArgument(code: string, from: number): string {
  let depth = 0;
  let inString = false;
  for (let i = from; i < code.length; i++) {
    const c = code[i];
    if (inString) {
      if (c === '\\') i++;
      else if (c === '"') inString = false;
      continue;
    }
    if (c === '"') inString = true;
    else if (c === '(' || c === '[' || c === '{') depth++;
    else if ((c === ')' || c === ']' || c === '}') && depth-- === 0) return code.slice(from, i).trim();
    else if (c === ',' && depth === 0) return code.slice(from, i).trim();
  }
  return code.slice(from).trim();
}
