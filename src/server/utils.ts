/**
 * Pure utility functions for the LSP server.
 * No VS Code or LSP dependencies — fully unit-testable.
 */
import { SymbolKind } from 'vscode-languageserver/node';

// ── Symbol kind mapping ───────────────────────────────────────────────────────

export const KIND_MAP: Record<string, SymbolKind> = {
  class:       SymbolKind.Class,
  dataClass:   SymbolKind.Class,
  sealedClass: SymbolKind.Class,
  interface:   SymbolKind.Interface,
  object:      SymbolKind.Object,
  enum:        SymbolKind.Enum,
  annotation:  SymbolKind.Class,
  fun:         SymbolKind.Function,
  composable:  SymbolKind.Function,
  val:         SymbolKind.Constant,
  var:         SymbolKind.Variable,
  typealias:   SymbolKind.TypeParameter,
};

// ── Word extraction ───────────────────────────────────────────────────────────

/**
 * Returns the identifier word that covers `char` on `line` of `text`,
 * or null if the cursor is on whitespace/punctuation.
 *
 * A fresh RegExp is created per call — no shared mutable state.
 */
export function wordAt(
  text: string,
  line: number,
  char: number,
): { word: string; start: number } | null {
  const lines = text.split('\n');
  const lineText = lines[line] ?? '';
  const wordRe = /[A-Za-z_]\w*/g;
  let m: RegExpExecArray | null;
  while ((m = wordRe.exec(lineText)) !== null) {
    // Range: [m.index, m.index + m[0].length)  — cursor must be inside it
    if (m.index <= char && char < m.index + m[0].length) {
      return { word: m[0], start: m.index };
    }
  }
  return null;
}

// ── URI utilities ─────────────────────────────────────────────────────────────

/**
 * Converts a `file://` URI to an absolute filesystem path.
 * Handles percent-encoded characters (e.g. spaces as %20).
 */
export function uriToPath(uri: string): string {
  if (!uri.startsWith('file://')) return uri;
  // Strip "file://" (and optional host — always empty on localhost)
  const withoutScheme = uri.slice('file://'.length);
  // withoutScheme is either "/absolute/path" or "host/path" (rare)
  try {
    return decodeURIComponent(withoutScheme);
  } catch {
    // Malformed percent-encoding (e.g. %ZZ, bare %) — return raw rather than crash
    return withoutScheme;
  }
}

/**
 * Converts an absolute filesystem path to a `file://` URI.
 * Percent-encodes characters that are not valid in a URI path.
 */
export function pathToUri(fsPath: string): string {
  // Encode each path segment but leave '/' separators intact
  const encoded = fsPath
    .split('/')
    .map(seg => encodeURIComponent(seg))
    .join('/');
  return 'file://' + encoded;
}

// ── Hover formatting ──────────────────────────────────────────────────────────

const KIND_LABEL: Record<string, string> = {
  dataClass:   'data class',
  sealedClass: 'sealed class',
};

/**
 * Builds the Markdown hover string for a list of declarations.
 * Shows at most `limit` entries.
 */
export function buildHoverMarkdown(
  decls: ReadonlyArray<{
    kind: string;
    fqn: string;
    packageName?: string;
    moduleName?: string;
    uri: { toString(): string };
  }>,
  limit = 5,
): string {
  const lines: string[] = [];
  for (const d of decls.slice(0, limit)) {
    const kindLabel = KIND_LABEL[d.kind] ?? d.kind;
    lines.push(`\`\`\`kotlin\n${kindLabel} ${d.fqn}\n\`\`\``);
    if (d.packageName) lines.push(`*Package:* \`${d.packageName}\``);
    const file = d.uri.toString().split('/').pop() ?? '';
    lines.push(`*File:* \`${file}\``);
    if (d.moduleName) lines.push(`*Module:* \`${d.moduleName}\``);
    lines.push('');
  }
  return lines.join('\n').trimEnd();
}
