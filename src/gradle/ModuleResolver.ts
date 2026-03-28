import * as vscode from 'vscode';

const RE_INCLUDE = /include\s*\(\s*["']([^"']+)["']\s*\)/g;
const decoder    = new TextDecoder();

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

      RE_INCLUDE.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = RE_INCLUDE.exec(text)) !== null) {
        const moduleName = m[1];
        // ":feature:home" → "feature/home"  (single pass, no double allocation)
        const rel = moduleName.slice(1).replace(/:/g, '/');
        map.set(moduleName, `${root}/${rel}`);
      }
      return;
    } catch { /* file not found */ }
  }
}
