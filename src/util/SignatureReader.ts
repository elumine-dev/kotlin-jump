import * as vscode from 'vscode';
import { SymbolEntry } from '../indexer/SymbolIndex';

const MAX_SIG_LINES     = 12;
const MAX_DISPLAY_LINES = 8;

// ── Signature extraction ──────────────────────────────────────────────────────
// Reads the actual source lines from the declaration file.
// Stops at `{` (body start) or `=` for functions/composables only.
// Handles multi-line parameter lists by tracking paren depth.

export function readSignature(doc: vscode.TextDocument, entry: SymbolEntry): string | null {
  const cutAtEquals = entry.kind === 'fun' || entry.kind === 'composable';

  const lines: string[] = [];
  let parenDepth = 0;

  for (
    let i = entry.line;
    i < Math.min(entry.line + MAX_SIG_LINES, doc.lineCount);
    i++
  ) {
    const text = doc.lineAt(i).text;
    let cutAt = -1;

    for (let j = 0; j < text.length; j++) {
      const ch = text[j];
      if      (ch === '(') parenDepth++;
      else if (ch === ')') parenDepth--;
      else if (ch === '{' && parenDepth === 0) { cutAt = j; break; }
      else if (ch === '=' && parenDepth === 0 && cutAtEquals) { cutAt = j; break; }
    }

    if (cutAt !== -1) {
      const part = text.slice(0, cutAt).trimEnd();
      if (part.trim()) lines.push(part);
      break;
    }

    lines.push(text.trimEnd());

    if (parenDepth === 0) break;
  }

  if (lines.length === 0) return null;

  const minIndent = lines
    .filter(l => l.trim().length > 0)
    .reduce((min, l) => Math.min(min, l.length - l.trimStart().length), Infinity);
  const normalized = lines.map(l => l.slice(isFinite(minIndent) ? minIndent : 0));

  if (normalized.length === 1) {
    normalized[0] = normalized[0].replace(/[,;]\s*$/, '');
  }

  if (normalized.length > MAX_DISPLAY_LINES) {
    return [
      ...normalized.slice(0, MAX_DISPLAY_LINES),
      '    // ...',
    ].join('\n');
  }

  return normalized.join('\n') || null;
}

// ── KDoc extraction ───────────────────────────────────────────────────────────
// Walks backward from the declaration line, skipping annotations and blank
// lines, then extracts and formats a /** ... */ or // comment block.

export function extractKDocFromLines(lines: string[], declarationLine: number): string | null {
  let line = Math.min(declarationLine, lines.length) - 1;
  while (line >= 0) {
    const t = lines[line].trim();
    if (t === '' || t.startsWith('@')) { line--; continue; }
    break;
  }
  if (line < 0) return null;

  const lastLine = lines[line].trim();

  if (lastLine.endsWith('*/')) {
    const single = /\/\*\*\s*(.*?)\s*\*\//.exec(lastLine);
    if (single) return formatKDoc([single[1]]);

    const rawLines: string[] = [];
    for (let i = line; i >= Math.max(0, line - 60); i--) {
      rawLines.unshift(lines[i]);
      if (lines[i].trim().startsWith('/**')) break;
    }
    if (!rawLines[0].trim().startsWith('/**')) return null;

    const content = rawLines.map((l, idx) => {
      const t = l.trim();
      if (idx === 0) return t.replace(/^\/\*\*\s?/, '');
      if (t === '*/') return null;
      return t.replace(/^\*\s?/, '');
    }).filter((l): l is string => l !== null);

    return formatKDoc(content);
  }

  if (lastLine.startsWith('//')) {
    const rawLines: string[] = [];
    for (let i = line; i >= Math.max(0, line - 19); i--) {
      const t = lines[i].trim();
      if (!t.startsWith('//')) break;
      rawLines.unshift(t.replace(/^\/\/\s?/, ''));
    }
    return rawLines.length > 0 ? rawLines.join('\n') : null;
  }

  return null;
}

export function extractKDoc(doc: vscode.TextDocument, declarationLine: number): string | null {
  const lines = Array.from({ length: doc.lineCount }, (_, i) => doc.lineAt(i).text);
  return extractKDocFromLines(lines, declarationLine);
}

// Converts raw KDoc lines to a Markdown string, formatting @tags.
export function formatKDoc(lines: string[]): string | null {
  if (lines.length === 0) return null;

  const result: string[] = [];
  let inParam = false;

  for (const line of lines) {
    if (!line.trim()) {
      result.push('');
      inParam = false;
      continue;
    }

    const param = /^@param\s+(\w+)\s*(.*)/.exec(line);
    if (param) {
      if (!inParam) { result.push(''); inParam = true; }
      result.push(`- \`${param[1]}\`: ${param[2]}`);
      continue;
    }

    const ret = /^@returns?\s+(.+)/.exec(line);
    if (ret) { result.push(`\n**Returns:** ${ret[1]}`); inParam = false; continue; }

    const thr = /^@(?:throws|exception)\s+(\w+)\s*(.*)/.exec(line);
    if (thr) { result.push(`\n**Throws** \`${thr[1]}\`${thr[2] ? ': ' + thr[2] : ''}`); inParam = false; continue; }

    const see = /^@see\s+(.+)/.exec(line);
    if (see) { result.push(`\n**See:** ${see[1]}`); inParam = false; continue; }

    const dep = /^@deprecated\s*(.*)/.exec(line);
    if (dep) { result.push(`\n> ⚠️ **Deprecated.** ${dep[1]}`); inParam = false; continue; }

    const since = /^@since\s+(.+)/.exec(line);
    if (since) { result.push(`\n**Since:** ${since[1]}`); inParam = false; continue; }

    if (line.startsWith('@')) { result.push(line); inParam = false; continue; }

    result.push(line);
    inParam = false;
  }

  const formatted = result.join('\n').trim();
  return formatted || null;
}

// ── Parameter parsing ─────────────────────────────────────────────────────────
// Parses a Kotlin function signature string (output of readSignature) into
// an array of { name, type } pairs.  Handles generics, lambdas, vararg,
// default values, and extension receivers.

export interface KtParam { name: string; type: string }

export function parseParams(signature: string): KtParam[] {
  // Collapse multi-line signature to a single line for easier scanning
  const flat = signature.replace(/\n\s*/g, ' ');

  // Find the opening `(` of the parameter list.
  // Skip generic type params `<T>` before `fun` name by tracking angle depth.
  const openParen = findParamListStart(flat);
  if (openParen === -1) return [];

  // Find matching closing `)`. If not found (truncated signature), fall back to
  // end of string so we can still parse the visible parameters.
  const closeParen = findMatchingParen(flat, openParen);
  const paramStr = flat.slice(openParen + 1, closeParen === -1 ? flat.length : closeParen).trim();
  if (!paramStr) return [];

  // Split by `,` at depth 0 (ignoring commas inside `<>`, `()`, `{}`)
  const tokens = splitAtDepthZero(paramStr);

  const result: KtParam[] = [];
  for (const token of tokens) {
    const param = parseOneParam(token.trim());
    if (param) result.push(param);
  }
  return result;
}

// Finds the index of the `(` that starts the parameter list.
// Handles: `fun foo(`, `fun <T> foo(`, `class Foo(`, `fun String.foo(`
// Also handles context receivers: `context(Logger) fun foo(` — skips context(...)
function findParamListStart(flat: string): number {
  let angleDepth = 0;
  let i = 0;
  while (i < flat.length) {
    const ch = flat[i];
    if (ch === '<') { angleDepth++; i++; continue; }
    if (ch === '>') { angleDepth--; i++; continue; }
    if (ch === '(' && angleDepth === 0) {
      // If this `(` is part of a `context(...)` receiver, skip over it.
      // Guard: if `fun` appears before `context`, this `(` is the function's param list.
      const before = flat.slice(0, i).trimEnd();
      if (/\bcontext$/.test(before) && !/\bfun\b/.test(before)) {
        // Skip to the matching `)`
        let depth = 1;
        i++;
        while (i < flat.length && depth > 0) {
          if (flat[i] === '(') depth++;
          else if (flat[i] === ')') depth--;
          i++;
        }
        continue;
      }
      return i;
    }
    i++;
  }
  return -1;
}

// Finds the index of the `)` that closes the `(` at `openIdx`.
// Skips string literals (both single and double quoted) to avoid false matches.
function findMatchingParen(s: string, openIdx: number): number {
  let depth = 0;
  let i = openIdx;
  while (i < s.length) {
    const ch = s[i];
    // Skip string literals to avoid `)` inside them
    if (ch === '"' || ch === "'") {
      const quote = ch;
      i++;
      while (i < s.length) {
        if (s[i] === '\\') { i += 2; continue; }
        if (s[i] === quote) { i++; break; }
        i++;
      }
      continue;
    }
    if (ch === '(') depth++;
    else if (ch === ')') {
      depth--;
      if (depth === 0) return i;
    }
    i++;
  }
  return -1;
}

// Splits `s` by `,` at bracket depth 0 (parens + angles + braces).
// Skips string literals so that `)` or `,` inside strings don't affect depth.
function splitAtDepthZero(s: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  let i = 0;
  while (i < s.length) {
    const ch = s[i];
    // Skip string literals
    if (ch === '"' || ch === "'") {
      const quote = ch;
      i++;
      while (i < s.length) {
        if (s[i] === '\\') { i += 2; continue; }
        if (s[i] === quote) { i++; break; }
        i++;
      }
      continue;
    }
    // Skip `->` operator so `>` doesn't decrement depth
    if (ch === '-' && s[i + 1] === '>') { i += 2; continue; }
    if (ch === '(' || ch === '<' || ch === '{') depth++;
    else if (ch === ')' || ch === '>' || ch === '}') { if (depth > 0) depth--; }
    else if (ch === ',' && depth === 0) {
      parts.push(s.slice(start, i));
      start = i + 1;
    }
    i++;
  }
  parts.push(s.slice(start));
  return parts;
}

// Strips leading parameter modifiers: vararg, crossinline, noinline, val, var, @Annotation
function stripModifiers(token: string): string {
  let t = token;
  // Iteratively strip annotations (with optional paren args) and keyword modifiers
  // until nothing more can be removed. Handles: `vararg @Suppress("X") items`
  let prev: string;
  do {
    prev = t;
    // Strip annotations like `@Composable`, `@receiver:`, `@Suppress("msg")`, etc.
    t = t.replace(/^(?:@\w+[\w.]*(?:\([^)]*\))?\s+)+/, '').trim();
    // Strip keyword modifiers (including val/var for primary constructors)
    t = t.replace(/^(vararg|crossinline|noinline|val|var)\s+/, '').trim();
  } while (t !== prev);
  return t;
}

// Parses a single parameter token like `modifier: Modifier = Modifier` or `vararg items: Item`
function parseOneParam(token: string): KtParam | null {
  const stripped = stripModifiers(token);

  // Must contain `:` to be a valid typed parameter
  const colonIdx = stripped.indexOf(':');
  if (colonIdx === -1) return null;

  const name = stripped.slice(0, colonIdx).trim();
  const isValidName = /^[A-Za-z_]\w*$/.test(name) || /^`[^`]+`$/.test(name);
  if (!name || !isValidName) return null;

  // Everything after `:` is the type, but cut at ` =` at depth 0 (default value)
  const afterColon = stripped.slice(colonIdx + 1).trim();
  const type = stripDefaultValue(afterColon).trim();
  if (!type) return null;

  return { name, type };
}

// ── Return type extraction ────────────────────────────────────────────────────
// Extracts the return type from a parsed function signature string.
// Returns null for Unit, Nothing, non-fun signatures, or unparseable sigs.
export function extractReturnType(signature: string): string | null {
  const flat = signature.replace(/\n\s*/g, ' ');
  if (!/\bfun\b/.test(flat)) return null;

  const openParen = findParamListStart(flat);
  if (openParen === -1) return null;

  const closeParen = findMatchingParen(flat, openParen);
  if (closeParen === -1) return null;

  const afterClose = flat.slice(closeParen + 1).trim();
  if (!afterClose.startsWith(':')) return null;

  let returnType = afterClose.slice(1).trim();
  // Strip generic `where T : Bound` constraint clause at the end
  returnType = returnType.replace(/\s+where\b.*$/, '').trim();
  // Strip trailing `{` or `=` that signals the body (depth-aware: skip `=`/`{` inside parens)
  returnType = stripBodySuffix(returnType).trim();

  if (!returnType || returnType === 'Unit' || returnType === 'Nothing') return null;

  return returnType;
}

// Strips the function body (`{` or `=`) from the end of a return type string.
// Only strips at paren depth 0 so `=` inside annotation args (e.g. `@Ann(k = v)`) is kept.
function stripBodySuffix(s: string): string {
  let depth = 0;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === '(') { depth++; continue; }
    if (ch === ')') { depth--; continue; }
    if (depth !== 0) continue;
    if (ch === '{') return s.slice(0, i);
    if (ch === '=' && s[i + 1] !== '=') return s.slice(0, i);
  }
  return s;
}

// Strips ` = defaultValue` at bracket depth 0
function stripDefaultValue(typeStr: string): string {
  let depth = 0;
  for (let i = 0; i < typeStr.length; i++) {
    const ch = typeStr[i];
    // Skip `->` operator so `>` doesn't decrement depth
    if (ch === '-' && typeStr[i + 1] === '>') { i++; continue; }
    if (ch === '(' || ch === '<' || ch === '{') depth++;
    else if (ch === ')' || ch === '>' || ch === '}') depth--;
    else if (ch === '=' && depth === 0) {
      // Ensure it's not `==` (comparison)
      if (typeStr[i + 1] === '=') continue;
      return typeStr.slice(0, i);
    }
  }
  return typeStr;
}
