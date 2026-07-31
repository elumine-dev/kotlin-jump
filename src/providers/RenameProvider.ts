import * as vscode from 'vscode';
import { SymbolIndex, SymbolEntry } from '../indexer/SymbolIndex';
import { scanForUsages, scanImports, UsageResult, isExcluded, resolveSearchTarget } from './FindUsagesEngine';
import { resolveLocalScope, findLocalUsages } from './DefinitionProvider';
import { isInsideCommentOrString, isInsideStringInterpolation } from '../util/textUtils';

const WORD_RE = /[A-Za-z_]\w*/;

// ── Metadata constants ────────────────────────────────────────────────────────

const META_OCCURRENCES: vscode.WorkspaceEditEntryMetadata = {
  needsConfirmation: false,
  label: 'Rename occurrences',
};

const META_IMPORTS: vscode.WorkspaceEditEntryMetadata = {
  needsConfirmation: false,
  label: 'Update imports',
};

function metaFile(oldName: string, newName: string): vscode.WorkspaceEditEntryMetadata {
  return {
    needsConfirmation: true,
    label: 'Rename file',
    description: `${oldName}.kt → ${newName}.kt`,
  };
}

// ── File-rename eligibility ───────────────────────────────────────────────────

const FILE_RENAME_KINDS = new Set<string>([
  'class', 'interface', 'object', 'enum',
  'dataClass', 'sealedClass', 'annotation',
]);

export function computeFileRename(
  entry: SymbolEntry,
  newName: string,
  index: SymbolIndex,
): vscode.Uri | null {
  if (entry.depth !== 0) return null;
  if (!FILE_RENAME_KINDS.has(entry.kind)) return null;

  const uriStr   = entry.uri.toString();
  const slashIdx = uriStr.lastIndexOf('/');
  const filename  = uriStr.slice(slashIdx + 1);
  // Java has the same one-public-type-per-file rule as Kotlin, so the
  // companion rename generalises: keep whichever extension the file carries.
  const ext = filename.endsWith('.kt') ? '.kt' : filename.endsWith('.java') ? '.java' : null;
  if (ext === null) return null;
  if (filename.slice(0, -ext.length) !== entry.name) return null;

  const newUriStr = uriStr.slice(0, slashIdx + 1) + newName + ext;
  if (index.fileUriStrings().includes(newUriStr)) return null; // clash guard

  return vscode.Uri.parse(newUriStr);
}

// ── Provider ──────────────────────────────────────────────────────────────────

export class KotlinRenameProvider implements vscode.RenameProvider {
  constructor(private readonly index: SymbolIndex) {}

  prepareRename(
    document: vscode.TextDocument,
    position: vscode.Position,
  ): { range: vscode.Range; placeholder: string } | null {
    const wordRange = document.getWordRangeAtPosition(position, WORD_RE);
    if (!wordRange) return null;
    const word = document.getText(wordRange);
    if (word.length < 2) return null;

    // Refuse rename on plain string / comment text — these are not
    // symbols. Allow short ($word) and full ${word} interpolation.
    if (document.languageId === 'kotlin' || document.languageId === 'java') {
      const lineText = document.lineAt(position.line).text;
      const start    = wordRange.start.character;
      if (isInsideCommentOrString(lineText, start)) {
        const isShortInterp = start >= 1 && lineText[start - 1] === '$';
        const isFullInterp  = isInsideStringInterpolation(lineText, start);
        if (!isShortInterp && !isFullInterp) return null;
      }
    }

    // A local symbol (parameter, val/var, for/lambda binding) is
    // renameable even if the workspace index has no entry for the
    // word. Also: when a local exists, we MUST allow rename and
    // scope it locally — otherwise provideRenameEdits would scan the
    // workspace and rewrite every same-named symbol. That was the
    // data-loss bug Kevin is guarding against.
    if (resolveLocalScope(document, position, word)) {
      return { range: wordRange, placeholder: word };
    }
    if (this.index.lookup(word).length === 0) return null;
    return { range: wordRange, placeholder: word };
  }

  async provideRenameEdits(
    document: vscode.TextDocument,
    position: vscode.Position,
    newName: string,
    token: vscode.CancellationToken,
  ): Promise<vscode.WorkspaceEdit | null> {
    const wordRange = document.getWordRangeAtPosition(position, WORD_RE);
    if (!wordRange) return null;
    const word = document.getText(wordRange);
    if (word.length < 2) return null;

    // Local-scoped rename: cursor is on a parameter / local val/var /
    // for/lambda binding. Edit ONLY the declaration + its in-function
    // usages. NEVER fan out to the workspace — that was the original
    // data-loss bug (renaming a local `name` would rewrite every
    // workspace `name` symbol).
    const localDecl = resolveLocalScope(document, position, word);
    if (localDecl) {
      // Place the cursor at the declaration to drive findLocalUsages
      // forward-scan from there.
      const declPos    = localDecl.range.start;
      const declUsages = findLocalUsages(document, declPos, word);
      const edit = new vscode.WorkspaceEdit();
      // Declaration itself.
      edit.replace(document.uri, localDecl.range, newName, META_OCCURRENCES);
      // Each usage.
      for (const usage of declUsages) {
        edit.replace(document.uri, usage.range, newName, META_OCCURRENCES);
      }
      return edit;
    }

    const decls = this.index.lookup(word);
    if (decls.length === 0) return null;

    // `private` symbols have no cross-file callers in valid code — rename
    // only needs to touch the declaring file. `scanImports` would never
    // find an import of a private symbol anyway. Skip the workspace
    // URI parse + picomatch entirely.
    const target = resolveSearchTarget(word, document, this.index);
    const uriStrings = target?.isPrivate
      ? [target.uri.toString()]
      : this.index.fileUriStrings().filter(u => !isExcluded(u));

    // Both scans run in parallel
    const [codeResults, importResults] = await Promise.all([
      scanForUsages(word, document, this.index, uriStrings, token),
      scanImports(word, this.index, uriStrings, token),
    ]);

    if (token.isCancellationRequested) return null;
    if (codeResults.length === 0 && importResults.length === 0) return null;

    // Build per-URI edit tuple arrays — one set() call per file,
    // with per-edit metadata so VS Code groups them in the preview panel.
    const editsByUri = new Map<
      string,
      [vscode.TextEdit, vscode.WorkspaceEditEntryMetadata | undefined][]
    >();

    const push = (r: UsageResult, meta: vscode.WorkspaceEditEntryMetadata) => {
      let arr = editsByUri.get(r.uriString);
      if (!arr) { arr = []; editsByUri.set(r.uriString, arr); }
      arr.push([
        vscode.TextEdit.replace(
          new vscode.Range(r.line, r.character, r.line, r.character + word.length),
          newName,
        ),
        meta,
      ]);
    };

    for (const r of codeResults)   push(r, META_OCCURRENCES);
    for (const r of importResults) push(r, META_IMPORTS);

    const edit = new vscode.WorkspaceEdit();
    for (const [uriStr, tuples] of editsByUri) {
      edit.set(vscode.Uri.parse(uriStr), tuples);
    }

    // Optional file rename — only for class-like top-level declarations.
    // Use resolveSearchTarget to pick the specific declaration referenced by the
    // document context, preventing the wrong file from being renamed when multiple
    // classes share the same simple name across packages.
    const resolved = resolveSearchTarget(word, document, this.index);
    const fileEntry = (() => {
      if (resolved && resolved.depth === 0 && FILE_RENAME_KINDS.has(resolved.kind)) {
        return resolved; // unambiguous target from import/package resolution
      }
      // Fallback: only when there is exactly one class-like declaration globally
      const candidates = decls.filter(d => d.depth === 0 && FILE_RENAME_KINDS.has(d.kind));
      return candidates.length === 1 ? candidates[0] : null;
    })();
    if (fileEntry) {
      const newUri = computeFileRename(fileEntry, newName, this.index);
      if (newUri) {
        edit.renameFile(
          fileEntry.uri,
          newUri,
          { overwrite: false },
          metaFile(fileEntry.name, newName),
        );
      }
    }

    return edit;
  }
}
