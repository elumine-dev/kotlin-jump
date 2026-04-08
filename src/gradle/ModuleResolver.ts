import * as vscode from 'vscode';

const decoder = new TextDecoder();

// Matches the "include" keyword followed by an optional open paren and one or more
// quoted strings — handles both Kotlin DSL and Groovy syntax:
//   include(":feature:home")          Kotlin DSL, single
//   include(":m1", ":m2")             Kotlin DSL, multi
//   include ':m1'                     Groovy, single
//   include ':m1', ':m2', ':m3'       Groovy, multi
const RE_INCLUDE_STMT = /\binclude\b\s*\(?\s*((?:["'][^"']+["']\s*,?\s*)+)/g;
const RE_QUOTED       = /["']([^"']+)["']/g;

export async function resolveAll(): Promise<Map<string, string>> {
  const map     = new Map<string, string>();
  const folders = vscode.workspace.workspaceFolders;
  if (!folders) return map;

  await Promise.all(folders.map(f => resolveRoot(f, map)));
  return map;
}

async function resolveRoot(
  folder: vscode.WorkspaceFolder,
  map: Map<string, string>,
): Promise<void> {
  const root = folder.uri.fsPath;

  for (const name of ['settings.gradle', 'settings.gradle.kts']) {
    try {
      const bytes = await vscode.workspace.fs.readFile(vscode.Uri.joinPath(folder.uri, name));
      const text  = decoder.decode(bytes);

      RE_INCLUDE_STMT.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = RE_INCLUDE_STMT.exec(text)) !== null) {
        const segment = m[1];
        RE_QUOTED.lastIndex = 0;
        let q: RegExpExecArray | null;
        while ((q = RE_QUOTED.exec(segment)) !== null) {
          const moduleName = q[1];
          if (!moduleName.startsWith(':')) continue; // skip non-Gradle paths
          const rel = moduleName.slice(1).replace(/:/g, '/');
          map.set(moduleName, `${root}/${rel}`);
        }
      }
      return;
    } catch { /* file not found */ }
  }
}
