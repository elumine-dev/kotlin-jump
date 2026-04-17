import * as vscode from 'vscode';
import { SymbolIndex } from '../indexer/SymbolIndex';
import { buildAllowFilter } from '../util/testFilter';

const METHOD_KINDS = new Set(['fun', 'composable', 'val', 'var'] as const);
const CLASS_LIKE   = new Set(['class', 'dataClass', 'sealedClass', 'enum', 'object', 'interface', 'annotation']);

export class OverrideGutterProvider implements vscode.CodeLensProvider {
  private readonly _onChange = new vscode.EventEmitter<void>();
  readonly onDidChangeCodeLenses = this._onChange.event;

  constructor(private readonly index: SymbolIndex) {}

  fireChange(): void { this._onChange.fire(); }

  provideCodeLenses(document: vscode.TextDocument): vscode.CodeLens[] {
    const cfg = vscode.workspace.getConfiguration('kotlinJump');
    if (!cfg.get<boolean>('overrideGutterIcons', true)) return [];
    const lang = document.languageId;
    if (lang !== 'kotlin' && lang !== 'java') return [];

    const allow = buildAllowFilter(document.uri.fsPath);
    const symbols = this.index.getFileSymbols(document.uri.toString());
    const lenses: vscode.CodeLens[] = [];
    const classStack: { kind: string; depth: number }[] = [];

    for (const entry of symbols) {
      while (classStack.length > 0 && classStack[classStack.length - 1].depth >= entry.depth) {
        classStack.pop();
      }

      if (entry.name.startsWith('$')) {
        if (CLASS_LIKE.has(entry.kind)) classStack.push({ kind: entry.kind, depth: entry.depth });
        continue;
      }

      if (!METHOD_KINDS.has(entry.kind as any)) {
        if (CLASS_LIKE.has(entry.kind)) {
          classStack.push({ kind: entry.kind, depth: entry.depth });
          // ⬇ for interface / abstract class / sealed class — show implementation count
          const isAbstractType = entry.kind === 'interface' || entry.kind === 'sealedClass'
            || (entry.kind === 'class' && entry.isAbstract);
          if (isAbstractType) {
            const rawImpls = this.index.lookupImplementations(entry.name).filter((e: any) => allow(e.uri.path));
            const allParents = this.index.lookup(entry.name).filter((e: any) => CLASS_LIKE.has(e.kind) && allow(e.uri.path));
            const impls = allParents.length <= 1 ? rawImpls : rawImpls.filter((impl: any) =>
              impl.packageName === entry.packageName ||
              !allParents.some((p: any) => p.packageName === impl.packageName)
            );
            if (impls.length > 0) {
              const range = new vscode.Range(entry.line, 0, entry.line, 0);
              lenses.push(new vscode.CodeLens(range, {
                title: `⬇ ${impls.length} implementation${impls.length !== 1 ? 's' : ''}`,
                command: 'kotlin-jump.goToClassImpl',
                arguments: [entry.name, entry.packageName],
                tooltip: 'Navigate to implementations',
              }));
            }
          }
        }
        continue;
      }

      const range = new vscode.Range(entry.line, 0, entry.line, 0);
      const enclosingKind = classStack.at(-1)?.kind;

      // ⬆ override indicator — uses built-in Go to Definition
      if (entry.isOverride) {
        lenses.push(new vscode.CodeLens(range, {
          title: '⬆ overrides',
          command: 'kotlin-jump.revealDefinitionAt',
          arguments: [document.uri, new vscode.Position(entry.line, entry.character)],
          tooltip: 'Go to overridden declaration',
        }));
        continue;
      }

      // ⬇ implementation indicator — explicit abstract OR interface member (implicitly abstract)
      if (entry.isAbstract || enclosingKind === 'interface') {
        const impls = this.index.lookupMethodImplementations(
          entry.name, document.uri.toString(), entry.line,
        ).filter((e: any) => allow(e.uri.path));
        if (impls.length > 0) {
          lenses.push(new vscode.CodeLens(range, {
            title: `⬇ ${impls.length} implementation${impls.length !== 1 ? 's' : ''}`,
            command: 'kotlin-jump.goToMethodImpl',
            arguments: [document.uri, entry.line, entry.name, impls.map(i => i.uri.toString())],
            tooltip: 'Navigate to implementations',
          }));
        }
      }
    }
    return lenses;
  }
}
