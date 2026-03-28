import * as vscode from 'vscode';
import { SymbolIndex } from '../indexer/SymbolIndex';

const WORD_RE = /[A-Za-z_]\w*/;
const CONCURRENCY = 20;

export class KotlinReferenceProvider implements vscode.ReferenceProvider {
  constructor(private readonly index: SymbolIndex) {}

  async provideReferences(
    document: vscode.TextDocument,
    position: vscode.Position,
    context: vscode.ReferenceContext,
    token: vscode.CancellationToken,
  ): Promise<vscode.Location[] | null> {
    const wordRange = document.getWordRangeAtPosition(position, WORD_RE);
    if (!wordRange) return null;

    const word = document.getText(wordRange);
    if (word.length < 2) return null;

    // Only proceed if this symbol is in the index
    const decls = this.index.lookup(word);
    if (decls.length === 0) return null;

    // Declaration positions — used to optionally exclude them from results
    const declKeys = new Set(decls.map(e => `${e.uri.toString()}:${e.line}:${e.character}`));

    const results: vscode.Location[] = [];
    const wordRe = new RegExp(`\\b${escapeRegex(word)}\\b`, 'g');
    const uriStrings = this.index.fileUriStrings();

    let cursor = 0;
    const worker = async () => {
      while (cursor < uriStrings.length) {
        if (token.isCancellationRequested) return;
        const uriStr = uriStrings[cursor++];
        const uri = vscode.Uri.parse(uriStr);
        try {
          const bytes = await vscode.workspace.fs.readFile(uri);
          const lines = Buffer.from(bytes).toString('utf8').split('\n');
          let inBlockComment = false;
          for (let i = 0; i < lines.length; i++) {
            const trimmed = lines[i].trimStart();

            // Track block comment boundaries
            if (inBlockComment) {
              if (trimmed.includes('*/')) inBlockComment = false;
              continue;
            }
            if (trimmed.startsWith('/*') || trimmed.startsWith('/**')) {
              if (!trimmed.includes('*/')) inBlockComment = true;
              continue;
            }

            // Skip single-line comments and import statements
            if (trimmed.startsWith('//') || trimmed.startsWith('import ')) continue;

            wordRe.lastIndex = 0;
            let m: RegExpExecArray | null;
            while ((m = wordRe.exec(lines[i])) !== null) {
              if (!context.includeDeclaration && declKeys.has(`${uriStr}:${i}:${m.index}`)) continue;
              results.push(new vscode.Location(uri, new vscode.Position(i, m.index)));
            }
          }
        } catch { /* skip unreadable files */ }
      }
    };

    await Promise.all(Array.from({ length: CONCURRENCY }, worker));

    return results.length > 0 ? results : null;
  }
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
