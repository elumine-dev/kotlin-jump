import * as vscode from 'vscode';
import { SymbolIndex, SymbolEntry } from '../indexer/SymbolIndex';
import { scanForUsages, scanImports, UsageResult, isExcluded } from './FindUsagesEngine';

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

function computeFileRename(
  entry: SymbolEntry,
  newName: string,
  index: SymbolIndex,
): vscode.Uri | null {
  if (entry.depth !== 0) return null;
  if (!FILE_RENAME_KINDS.has(entry.kind)) return null;

  const uriStr   = entry.uri.toString();
  const slashIdx = uriStr.lastIndexOf('/');
  const filename  = uriStr.slice(slashIdx + 1);
  if (!filename.endsWith('.kt')) return null;
  if (filename.slice(0, -3) !== entry.name) return null;

  const newUriStr = uriStr.slice(0, slashIdx + 1) + newName + '.kt';
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

    const decls = this.index.lookup(word);
    if (decls.length === 0) return null;

    const uriStrings = this.index.fileUriStrings().filter(u => !isExcluded(u));

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

    // Optional file rename — only for class-like top-level declarations
    const fileEntry = decls.find(d => d.depth === 0 && FILE_RENAME_KINDS.has(d.kind));
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
