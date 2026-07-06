import * as vscode from 'vscode';

export const KOTLIN_STDLIB_JAR_SCHEME = 'kotlin-stdlib-jar';

// Entry name (e.g. "kotlin/collections/Collections.kt") → raw .kt text.
// Populated once by BundledStdlibProvider.load() from the prebuilt JSON
// index: no zip library, no disk access, works identically on desktop
// and web.
const sources = new Map<string, string>();
const encoder = new TextEncoder();

export function registerBundledStdlibSources(entries: Record<string, string>): void {
  sources.clear();
  for (const [name, text] of Object.entries(entries)) sources.set(name, text);
}

export function buildBundledStdlibUri(entryName: string): vscode.Uri {
  return vscode.Uri.parse(`${KOTLIN_STDLIB_JAR_SCHEME}:/${entryName}`);
}

function entryNameOf(uri: vscode.Uri): string {
  return uri.path.replace(/^\/+/, '');
}

/**
 * Read-only, fully in-memory `vscode.FileSystemProvider` for the
 * `kotlin-stdlib-jar://` scheme. Serves the bundled Kotlin stdlib sources
 * for "Go to Definition"/hover without ever touching a real filesystem or
 * zip library. Only covers the bundled stdlib (a single prebuilt asset);
 * real project dependency JARs still go through KotlinJarContentProvider
 * (desktop only, node-stream-zip against the user's actual Gradle/Maven
 * cache).
 */
export class BundledStdlibFsProvider implements vscode.FileSystemProvider {
  private readonly _onDidChangeFile = new vscode.EventEmitter<vscode.FileChangeEvent[]>();
  readonly onDidChangeFile: vscode.Event<vscode.FileChangeEvent[]> = this._onDidChangeFile.event;

  watch(_uri: vscode.Uri, _options: { readonly recursive: boolean; readonly excludes: readonly string[] }): vscode.Disposable {
    return { dispose: () => {} };
  }

  stat(uri: vscode.Uri): vscode.FileStat {
    const text = sources.get(entryNameOf(uri));
    if (text === undefined) throw vscode.FileSystemError.FileNotFound(uri);
    return { type: vscode.FileType.File, ctime: 0, mtime: 0, size: encoder.encode(text).length };
  }

  readFile(uri: vscode.Uri): Uint8Array {
    const text = sources.get(entryNameOf(uri));
    if (text === undefined) throw vscode.FileSystemError.FileNotFound(uri);
    return encoder.encode(text);
  }

  readDirectory(_uri: vscode.Uri): [string, vscode.FileType][] {
    // Not needed today: entries are only ever opened directly via a URI
    // ("Go to Definition"), never browsed as a tree. Implemented as "empty
    // directory" rather than throwing, so a stray call degrades quietly.
    return [];
  }

  createDirectory(_uri: vscode.Uri): never {
    throw vscode.FileSystemError.NoPermissions('kotlin-stdlib-jar filesystem is read-only');
  }
  writeFile(_uri: vscode.Uri, _content: Uint8Array, _options: { readonly create: boolean; readonly overwrite: boolean }): never {
    throw vscode.FileSystemError.NoPermissions('kotlin-stdlib-jar filesystem is read-only');
  }
  delete(_uri: vscode.Uri, _options: { readonly recursive: boolean }): never {
    throw vscode.FileSystemError.NoPermissions('kotlin-stdlib-jar filesystem is read-only');
  }
  rename(_oldUri: vscode.Uri, _newUri: vscode.Uri, _options: { readonly overwrite: boolean }): never {
    throw vscode.FileSystemError.NoPermissions('kotlin-stdlib-jar filesystem is read-only');
  }
}
