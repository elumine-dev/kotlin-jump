import * as vscode from 'vscode';
import * as path from 'path';
import StreamZip from 'node-stream-zip';

export const KOTLIN_JAR_SCHEME = 'kotlin-jar';

const MAX_CACHED = 20;
const cache = new Map<string, StreamZip.StreamZipAsync>();

// ── URI helpers ───────────────────────────────────────────────────────────────

/**
 * Builds a `kotlin-jar://` URI that encodes both the JAR path and the entry path.
 * Normalises path separators so the URI is valid on all platforms (including Windows).
 */
export function buildKotlinJarUri(absJarPath: string, entryName: string): vscode.Uri {
  // Normalise to forward slashes for URI spec compliance
  const fwd = absJarPath.replace(/\\/g, '/');
  // Windows: C:/path → /C:/path so the authority stays empty and the path is correct
  const uriPath = /^[A-Za-z]:/.test(fwd) ? '/' + fwd : fwd;
  return vscode.Uri.parse(`${KOTLIN_JAR_SCHEME}://${uriPath}!${entryName}`);
}

/**
 * Splits a `kotlin-jar://` URI back into `{ jarPath, entryName }`.
 * Returns empty strings when the URI is malformed (no `!` separator).
 * `jarPath` uses OS-native separators so it can be passed directly to StreamZip.
 */
export function parseKotlinJarUri(uri: vscode.Uri): { jarPath: string; entryName: string } {
  const bang = uri.path.indexOf('!');
  if (bang === -1) return { jarPath: '', entryName: '' };

  let jarPath = uri.path.slice(0, bang);
  // Windows: /C:/path → C:/path (strip the extra leading slash added by buildKotlinJarUri)
  if (/^\/[A-Za-z]:/.test(jarPath)) jarPath = jarPath.slice(1);
  // Convert to OS-native separators for filesystem access (noop on Unix)
  return { jarPath: jarPath.replace(/\//g, path.sep), entryName: uri.path.slice(bang + 1) };
}

// ── Cleanup ───────────────────────────────────────────────────────────────────

/** Close all cached StreamZip instances. Call from extension deactivate(). */
export function closeAllCachedZips(): void {
  for (const zip of cache.values()) zip.close().catch(() => {});
  cache.clear();
}

// ── FileSystemProvider ────────────────────────────────────────────────────────

/**
 * Read-only `vscode.FileSystemProvider` for the `kotlin-jar://` scheme.
 *
 * This replaces the old `TextDocumentContentProvider` and gives VS Code proper
 * file metadata (tabs with correct titles, breadcrumbs, diff viewer support, and
 * the ability to browse JAR contents as a virtual directory tree).
 *
 * Registration (extension.ts):
 *   context.subscriptions.push(
 *     vscode.workspace.registerFileSystemProvider(
 *       KOTLIN_JAR_SCHEME, new KotlinJarContentProvider(),
 *       { isReadonly: true, isCaseSensitive: true },
 *     )
 *   );
 */
export class KotlinJarContentProvider implements vscode.FileSystemProvider {
  // FileSystemProvider requires this even for read-only providers
  private readonly _onDidChangeFile = new vscode.EventEmitter<vscode.FileChangeEvent[]>();
  readonly onDidChangeFile: vscode.Event<vscode.FileChangeEvent[]> = this._onDidChangeFile.event;

  /** Build a URI for a specific entry inside a JAR. */
  static buildUri(absJarPath: string, entryName: string): vscode.Uri {
    return buildKotlinJarUri(absJarPath, entryName);
  }

  // ── Required no-ops for read-only FS ───────────────────────────────────────

  watch(_uri: vscode.Uri, _options: { readonly recursive: boolean; readonly excludes: readonly string[] }): vscode.Disposable {
    return { dispose: () => {} };
  }

  // ── Read operations ────────────────────────────────────────────────────────

  async stat(uri: vscode.Uri): Promise<vscode.FileStat> {
    const { jarPath, entryName } = parseKotlinJarUri(uri);
    if (!jarPath) throw vscode.FileSystemError.FileNotFound(uri);

    if (!entryName) {
      // The URI points to the JAR root — treat as a directory
      return { type: vscode.FileType.Directory, ctime: 0, mtime: 0, size: 0 };
    }

    try {
      const zip     = await getOrOpenZip(jarPath);
      const entries = await zip.entries();
      const entry   = entries[entryName];
      if (!entry) throw vscode.FileSystemError.FileNotFound(uri);
      return { type: vscode.FileType.File, ctime: 0, mtime: 0, size: entry.size };
    } catch (err) {
      if (err instanceof vscode.FileSystemError) throw err;
      throw vscode.FileSystemError.FileNotFound(uri);
    }
  }

  async readFile(uri: vscode.Uri): Promise<Uint8Array> {
    const { jarPath, entryName } = parseKotlinJarUri(uri);
    if (!jarPath || !entryName) throw vscode.FileSystemError.FileNotFound(uri);
    try {
      const zip  = await getOrOpenZip(jarPath);
      const data = await zip.entryData(entryName);
      return data;
    } catch (err) {
      if (err instanceof vscode.FileSystemError) throw err;
      throw vscode.FileSystemError.FileNotFound(uri);
    }
  }

  async readDirectory(uri: vscode.Uri): Promise<[string, vscode.FileType][]> {
    const { jarPath, entryName } = parseKotlinJarUri(uri);
    if (!jarPath) throw vscode.FileSystemError.FileNotFound(uri);

    const zip     = await getOrOpenZip(jarPath);
    const entries = await zip.entries();
    // Prefix is the virtual directory path within the JAR (empty = root)
    const prefix  = entryName ? entryName + '/' : '';
    const children = new Map<string, vscode.FileType>();

    for (const name of Object.keys(entries)) {
      if (!name.startsWith(prefix)) continue;
      const rest  = name.slice(prefix.length);
      if (!rest) continue;
      const slash = rest.indexOf('/');
      if (slash === -1) {
        children.set(rest, vscode.FileType.File);
      } else {
        children.set(rest.slice(0, slash), vscode.FileType.Directory);
      }
    }
    return [...children.entries()];
  }

  // ── Write operations — all forbidden ──────────────────────────────────────

  createDirectory(_uri: vscode.Uri): never {
    throw vscode.FileSystemError.NoPermissions('kotlin-jar filesystem is read-only');
  }
  writeFile(_uri: vscode.Uri, _content: Uint8Array, _options: { readonly create: boolean; readonly overwrite: boolean }): never {
    throw vscode.FileSystemError.NoPermissions('kotlin-jar filesystem is read-only');
  }
  delete(_uri: vscode.Uri, _options: { readonly recursive: boolean }): never {
    throw vscode.FileSystemError.NoPermissions('kotlin-jar filesystem is read-only');
  }
  rename(_oldUri: vscode.Uri, _newUri: vscode.Uri, _options: { readonly overwrite: boolean }): never {
    throw vscode.FileSystemError.NoPermissions('kotlin-jar filesystem is read-only');
  }
}

// ── Internal ZIP cache (LRU, cap 20) ─────────────────────────────────────────

async function getOrOpenZip(jarPath: string): Promise<StreamZip.StreamZipAsync> {
  const hit = cache.get(jarPath);
  if (hit) {
    // Move to end (most-recently-used)
    cache.delete(jarPath);
    cache.set(jarPath, hit);
    return hit;
  }
  if (cache.size >= MAX_CACHED) {
    const oldest = cache.keys().next().value!;
    await cache.get(oldest)?.close().catch(() => {});
    cache.delete(oldest);
  }
  const zip = new StreamZip.async({ file: jarPath });
  cache.set(jarPath, zip);
  return zip;
}
