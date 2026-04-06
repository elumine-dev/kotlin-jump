import * as vscode from 'vscode';
import * as path from 'path';

export interface KotlinJumpProjectConfig {
  modules?:     Record<string, string>;
  sourceRoots?: string[];
}

const CONFIG_FILENAME = 'kotlin-jump.json';
const decoder = new TextDecoder();

/**
 * Parses a `kotlin-jump.json` file's text content into a module map and source roots.
 * `folderPath` is the absolute path of the workspace folder (used to resolve relative paths).
 * Returns null when the JSON is invalid.
 */
export function parseProjectConfig(
  text: string,
  folderPath: string,
): { moduleMap: Map<string, string>; sourceRoots: string[] } | null {
  let config: KotlinJumpProjectConfig;
  try {
    const parsed = JSON.parse(text);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      config = {};
    } else {
      config = parsed as KotlinJumpProjectConfig;
    }
  } catch {
    return null;
  }

  const moduleMap = new Map<string, string>();
  for (const [name, rel] of Object.entries(config.modules ?? {})) {
    moduleMap.set(name, path.join(folderPath, rel));
  }

  const sourceRoots = (config.sourceRoots ?? []).map(rel => path.join(folderPath, rel));
  return { moduleMap, sourceRoots };
}

/**
 * Reads `kotlin-jump.json` from every workspace folder and merges the results.
 * Missing or malformed files are silently skipped.
 */
export async function readProjectConfigs(): Promise<{
  moduleMap:   Map<string, string>;
  sourceRoots: string[];
}> {
  const moduleMap   = new Map<string, string>();
  const sourceRoots: string[] = [];
  const folders = vscode.workspace.workspaceFolders ?? [];

  await Promise.all(folders.map(async folder => {
    const cfgUri = vscode.Uri.joinPath(folder.uri, CONFIG_FILENAME);
    try {
      const bytes  = await vscode.workspace.fs.readFile(cfgUri);
      const result = parseProjectConfig(decoder.decode(bytes), folder.uri.fsPath);
      if (!result) return;
      for (const [k, v] of result.moduleMap) moduleMap.set(k, v);
      sourceRoots.push(...result.sourceRoots);
    } catch { /* file not found or invalid JSON — silently skip */ }
  }));

  return { moduleMap, sourceRoots };
}
