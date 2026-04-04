import * as vscode from 'vscode';
import { SymbolIndex, SymbolEntry } from '../indexer/SymbolIndex';
import { SymbolKind } from '../indexer/KotlinParser';
import { scanForUsages } from './FindUsagesEngine';

const LENS_KINDS = new Set<SymbolKind>([
  'class', 'interface', 'object', 'enum',
  'dataClass', 'sealedClass', 'annotation',
  'fun', 'composable',
]);

const CLASS_LIKE = new Set<SymbolKind>([
  'class', 'interface', 'object', 'enum',
  'dataClass', 'sealedClass', 'annotation',
]);

interface KotlinCodeLens extends vscode.CodeLens {
  data: { entry: SymbolEntry };
}

export class KotlinCodeLensProvider implements vscode.CodeLensProvider {
  private readonly _onDidChange = new vscode.EventEmitter<void>();
  readonly onDidChangeCodeLenses = this._onDidChange.event;
  private _cache = new Map<string, Promise<number>>();

  constructor(private readonly index: SymbolIndex) {}

  provideCodeLenses(document: vscode.TextDocument): vscode.CodeLens[] {
    const enabled = vscode.workspace.getConfiguration('kotlinJump').get<boolean>('codeLens', true);
    if (!enabled) return [];

    const symbols = this.index.getFileSymbols(document.uri.toString());
    const lenses: KotlinCodeLens[] = [];
    const classStack: { kind: string; depth: number }[] = [];

    for (const entry of symbols) {
      while (classStack.length > 0 && classStack[classStack.length - 1].depth >= entry.depth) {
        classStack.pop();
      }

      // Skip enum entries (enum kind nested inside another enum)
      if (entry.kind === 'enum' && classStack.length > 0 && classStack[classStack.length - 1].kind === 'enum') {
        if (CLASS_LIKE.has(entry.kind)) classStack.push({ kind: entry.kind, depth: entry.depth });
        continue;
      }

      if (!LENS_KINDS.has(entry.kind)) {
        if (CLASS_LIKE.has(entry.kind)) classStack.push({ kind: entry.kind, depth: entry.depth });
        continue;
      }

      const range = new vscode.Range(entry.line, 0, entry.line, 0);
      const lens = new vscode.CodeLens(range) as KotlinCodeLens;
      lens.data = { entry };
      lenses.push(lens);

      if (CLASS_LIKE.has(entry.kind)) {
        classStack.push({ kind: entry.kind, depth: entry.depth });
      }
    }

    return lenses;
  }

  async resolveCodeLens(
    lens: vscode.CodeLens,
    token: vscode.CancellationToken,
  ): Promise<vscode.CodeLens> {
    const { entry } = (lens as KotlinCodeLens).data;

    // Implementation count — O(1) from bySuper map
    let implCount = 0;
    if (CLASS_LIKE.has(entry.kind)) {
      implCount = this.index.lookupImplementations(entry.name).length;
    }

    // Usage count — async file scan (cached per symbol name)
    let usageCount = 0;
    try {
      const cacheKey = entry.fqn; // must be FQN — simple name causes cache collisions for same-named symbols in different classes
      if (!this._cache.has(cacheKey)) {
        this._cache.set(cacheKey, this.countUsages(entry, token));
      }
      usageCount = await this._cache.get(cacheKey)!;
      // Evict cancelled results — scan was aborted early, the count is unreliable.
      // Without this, a cancelled call permanently caches 0 and future valid calls
      // return the wrong count even after the token is no longer cancelled.
      if (token.isCancellationRequested) this._cache.delete(cacheKey);
    } catch {
      usageCount = 0;
    }

    if (token.isCancellationRequested) return lens;

    // Build title
    const parts: string[] = [];
    if (usageCount > 0) {
      parts.push(`${usageCount} ${usageCount === 1 ? 'usage' : 'usages'}`);
    } else {
      parts.push('0 usages');
    }
    if (implCount > 0) {
      parts.push(`${implCount} ${implCount === 1 ? 'implementation' : 'implementations'}`);
    }

    lens.command = {
      title: parts.join(' | '),
      command: 'kotlin-jump.codeLensAction',
      arguments: [entry.uri, entry.line, entry.character, entry.name],
    };

    return lens;
  }

  refresh(): void {
    this._cache.clear();
    this._onDidChange.fire();
  }

  dispose(): void {
    this._onDidChange.dispose();
  }

  private async countUsages(entry: SymbolEntry, token: vscode.CancellationToken): Promise<number> {
    const doc = await vscode.workspace.openTextDocument(entry.uri);
    const results = await scanForUsages(
      entry.name,
      doc,
      this.index,
      this.index.fileUriStrings(),
      token,
    );
    // Subtract 1 for the declaration itself
    return Math.max(0, results.length - 1);
  }
}
