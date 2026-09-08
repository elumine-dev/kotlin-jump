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


/** Extensions the index understands. Saving a README used to inject ghost symbols. */
export const INDEXABLE_RE = /\.(kt|kts|java)$/;

/**
 * The roots to index, from the initialize params. `workspaceFolders` wins
 * (LSP 3.6+ clients send it with `rootUri: null`), then `rootUri`, then the
 * deprecated `rootPath`. NEVER `process.cwd()`: on an editor started from
 * the home directory that scanned everything the user owns, and served
 * symbols from unrelated projects.
 */
export function resolveWorkspaceRoots(params: {
  rootUri?: string | null;
  rootPath?: string | null;
  workspaceFolders?: { uri: string }[] | null;
}): string[] {
  const folders = params.workspaceFolders ?? [];
  if (folders.length > 0) return folders.map(f => uriToPath(f.uri));
  if (params.rootUri) return [uriToPath(params.rootUri)];
  if (params.rootPath) return [params.rootPath];
  return [];
}

/**
 * Narrows same named declarations with what the file actually imports.
 * A project with a domain `User`, a network `User` and a database `User`
 * offered all three on every Cmd+Click; an explicit import settles it, and a
 * declaration of the file's own package wins over a foreign one.
 */
export function preferByImports<T extends { fqn?: string; packageName?: string }>(
  text: string,
  decls: readonly T[],
): T[] {
  if (decls.length < 2) return [...decls];
  const imported = new Set<string>();
  let ownPackage = '';
  for (const raw of text.split('\n', 400)) {
    const line = raw.trim();
    if (line.startsWith('package ')) { ownPackage = line.slice(8).trim().replace(/;$/, ''); continue; }
    if (!line.startsWith('import ')) continue;
    const path = line.slice(7).trim().replace(/;$/, '').split(/\s+as\s+/)[0];
    if (path) imported.add(path);
  }
  const exact = decls.filter(d => d.fqn !== undefined && imported.has(d.fqn));
  if (exact.length > 0) return exact;
  const wildcard = decls.filter(d => d.packageName && imported.has(`${d.packageName}.*`));
  if (wildcard.length > 0) return wildcard;
  const samePackage = ownPackage ? decls.filter(d => d.packageName === ownPackage) : [];
  if (samePackage.length > 0) return samePackage;
  return [...decls];
}


/**
 * The same file, written the way this server writes it. A client encodes a
 * URI per RFC 3986, we encode each segment with encodeURIComponent, and the
 * two disagree on `,`, `&`, `+` and `$`: comparing the raw strings made a
 * deletion miss the index and an open buffer fall back to the disk copy,
 * both in silence. Going through the path first settles it.
 */
export function canonicalUri(uri: string): string {
  return pathToUri(uriToPath(uri));
}

/** Open buffers by file path, so a lookup never depends on the client's encoding. */
export function openTextByPath(
  docs: readonly { uri: string; getText(): string }[],
): Map<string, string> {
  const out = new Map<string, string>();
  for (const doc of docs) out.set(uriToPath(doc.uri), doc.getText());
  return out;
}
