import * as vscode from 'vscode';
import * as path from 'path';
import { SymbolIndex } from '../indexer/SymbolIndex';
import { decodeUtf8 } from '../util/encoding';

// Matches `import com.example.Foo` with optional alias and trailing comment
const RE_IMPORT_LINE =
  /^(\s*import\s+)([\w.]+)((?:\s+as\s+\w+)?)((?:\s*\/\/.*)?)\s*$/;

const CONCURRENCY = 20;

// ── Pure helpers (exported for tests) ────────────────────────────────────────

/**
 * Infers the new Kotlin package name for a file being moved to `destDir`.
 *
 * Tries to find the source root by matching `oldPackage` against `oldFilePath`,
 * then falls back to the provided `sourceRoots` list.
 * Returns `null` when the source root cannot be determined.
 */
export function inferPackage(
  oldFilePath:  string,
  destDir:      string,
  oldPackage:   string,
  sourceRoots:  string[] = [],
): string | null {
  const sourceRoot = findSourceRoot(oldFilePath, oldPackage, sourceRoots);
  if (sourceRoot === null) return null;

  const normalDest = path.normalize(destDir);
  const normalRoot = path.normalize(sourceRoot);

  const isAtRoot   = normalDest === normalRoot;
  const isUnderRoot = normalDest.startsWith(normalRoot + path.sep);
  if (!isAtRoot && !isUnderRoot) return null;

  const rel = isUnderRoot ? normalDest.slice(normalRoot.length + 1) : '';
  return rel ? rel.replace(/[/\\]/g, '.') : '';
}

/**
 * Returns line rewrites needed to update imports in a file when symbols move
 * from `oldPackage` to `newPackage`.
 * Only rewrites explicit imports whose top-level simple name is in `symbolNames`.
 */
export function rewriteImports(
  text:        string,
  oldPackage:  string,
  newPackage:  string,
  symbolNames: Set<string>,
): Array<{ line: number; newText: string }> {
  if (!oldPackage || symbolNames.size === 0) return [];

  const results: Array<{ line: number; newText: string }> = [];
  const lines = text.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    if (!raw.trimStart().startsWith('import ')) continue;

    const m = RE_IMPORT_LINE.exec(raw);
    if (!m) continue;

    const importedFqn = m[2]; // e.g. "com.example.ui.Button"
    const prefix = oldPackage + '.';
    if (!importedFqn.startsWith(prefix)) continue;

    const afterPkg   = importedFqn.slice(prefix.length); // "Button" or "Button.Companion"
    const simpleName = afterPkg.split('.')[0];
    if (!symbolNames.has(simpleName)) continue;

    const newFqn  = newPackage ? `${newPackage}.${afterPkg}` : afterPkg;
    results.push({ line: i, newText: `${m[1]}${newFqn}${m[3]}${m[4]}` });
  }

  return results;
}

// ── VS Code edit builder ──────────────────────────────────────────────────────

/**
 * Builds a WorkspaceEdit that:
 *  1. Updates the `package` declaration in the moved file.
 *  2. Renames the file on disk.
 *  3. Updates all explicit `import` statements in every workspace file.
 */
export async function buildMoveEdit(
  document:   vscode.TextDocument,
  newUri:     vscode.Uri,
  newPackage: string,
  index:      SymbolIndex,
): Promise<vscode.WorkspaceEdit> {
  const edit      = new vscode.WorkspaceEdit();
  const oldUri    = document.uri;
  const oldUriStr = oldUri.toString();
  const text      = document.getText();

  const pkgMatch   = /^(\s*package\s+)([\w.]+)/m.exec(text);
  const oldPackage = pkgMatch?.[2] ?? '';

  // 1. Update package declaration (targets old URI — VS Code applies text edits before rename)
  if (pkgMatch && oldPackage !== newPackage) {
    const linesBefore = text.slice(0, pkgMatch.index).split('\n').length - 1;
    const pkgLine     = document.lineAt(linesBefore).text;
    const pkgStart    = pkgLine.indexOf(oldPackage);
    if (pkgStart !== -1) {
      edit.replace(
        oldUri,
        new vscode.Range(linesBefore, pkgStart, linesBefore, pkgStart + oldPackage.length),
        newPackage,
      );
    }
  }

  // 2. Rename file
  edit.renameFile(oldUri, newUri, { overwrite: false });

  // 3. Update imports in all other workspace files
  if (oldPackage && newPackage !== oldPackage) {
    const fileSymbols = index.getFileSymbols(oldUriStr);
    const symbolNames = new Set(
      fileSymbols.filter(s => s.depth === 0).map(s => s.name),
    );
    if (symbolNames.size > 0) {
      await scanAndRewriteImports(edit, oldUriStr, oldPackage, newPackage, symbolNames, index);
    }
  }

  return edit;
}

async function scanAndRewriteImports(
  edit:        vscode.WorkspaceEdit,
  excludedUri: string,
  oldPackage:  string,
  newPackage:  string,
  symbolNames: Set<string>,
  index:       SymbolIndex,
): Promise<void> {
  const uriStrings = index.fileUriStrings();
  let cursor = 0;

  const worker = async () => {
    while (cursor < uriStrings.length) {
      const uriStr = uriStrings[cursor++];
      if (uriStr === excludedUri) continue;
      const uri = vscode.Uri.parse(uriStr);
      try {
        const bytes  = await vscode.workspace.fs.readFile(uri);
        const text   = decodeUtf8(bytes);
        if (!text.includes(oldPackage)) continue;

        const rewrites = rewriteImports(text, oldPackage, newPackage, symbolNames);
        if (rewrites.length === 0) continue;

        const fileLines = text.split('\n');
        for (const { line, newText } of rewrites) {
          edit.replace(uri, new vscode.Range(line, 0, line, fileLines[line].length), newText);
        }
      } catch { /* skip unreadable files */ }
    }
  };

  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
}

// ── Internal ──────────────────────────────────────────────────────────────────

function findSourceRoot(
  filePath:    string,
  packageName: string,
  sourceRoots: string[],
): string | null {
  if (packageName) {
    const pkgDir  = packageName.replace(/\./g, path.sep);
    const fileDir = path.normalize(path.dirname(filePath));
    if (fileDir.endsWith(path.sep + pkgDir)) {
      return fileDir.slice(0, -(pkgDir.length + 1));
    }
    if (fileDir === pkgDir) {
      return '';
    }
  }

  const normalFile = path.normalize(filePath);
  for (const root of sourceRoots) {
    const normalRoot = path.normalize(root);
    if (normalFile.startsWith(normalRoot + path.sep)) return normalRoot;
  }

  return null;
}
