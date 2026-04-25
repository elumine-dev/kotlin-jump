import * as vscode from 'vscode';
import { SymbolIndex } from '../indexer/SymbolIndex';
import { scanForUsages, isExcluded } from './FindUsagesEngine';
import { Logger } from '../util/logger';
import { resolveLocalScope, findLocalUsages } from './DefinitionProvider';
import { isInsideCommentOrString, isInsideStringInterpolation } from '../util/textUtils';

const WORD_RE = /[A-Za-z_]\w*/;

export class KotlinReferenceProvider implements vscode.ReferenceProvider {
  constructor(private readonly index: SymbolIndex, private readonly log?: Logger) {}

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

    // Plain string / comment guard.
    if (document.languageId === 'kotlin' || document.languageId === 'java') {
      const lineText = document.lineAt(position.line).text;
      const start    = wordRange.start.character;
      if (isInsideCommentOrString(lineText, start)) {
        const isShortInterp = start >= 1 && lineText[start - 1] === '$';
        const isFullInterp  = isInsideStringInterpolation(lineText, start);
        if (!isShortInterp && !isFullInterp) return null;
      }
    }

    // Local-scope: scope references to within the enclosing function.
    // Without this guard, "Find All References" on a parameter `name`
    // returned every workspace symbol named `name` — pollution that
    // hid the actual usages of the local binding.
    const localDecl = resolveLocalScope(document, position, word);
    if (localDecl) {
      const usages = findLocalUsages(document, localDecl.range.start, word);
      const out: vscode.Location[] = [];
      if (context.includeDeclaration) out.push(localDecl);
      out.push(...usages);
      return out.length > 0 ? out : null;
    }

    if (this.index.lookup(word).length === 0) return null;

    // Pre-filter URI list before any I/O (pure CPU — picomatch pre-compiled)
    const uriStrings = this.index.fileUriStrings().filter(u => !isExcluded(u));

    const raw = await scanForUsages(word, document, this.index, uriStrings, token, this.log);
    if (raw.length === 0) return null;

    // Optionally exclude declaration sites
    const decls = this.index.lookup(word);
    const declKeys = new Set(decls.map(e => `${e.uri.toString()}:${e.line}:${e.character}`));

    const locations = raw
      .filter(r => context.includeDeclaration || !declKeys.has(`${r.uriString}:${r.line}:${r.character}`))
      .map(r => new vscode.Location(r.uri, new vscode.Position(r.line, r.character)));

    return locations.length > 0 ? locations : null;
  }
}
