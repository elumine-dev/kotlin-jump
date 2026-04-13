import * as vscode from 'vscode';
import { clearPendingDeclNav } from './DefinitionProvider';
import { UsageResult } from './FindUsagesEngine';

export interface CodeLensActionPanel {
  populateFromResults(
    word: string,
    rawResults: UsageResult[],
    exclude?: { excludeUri?: string; excludeLine?: number },
  ): Promise<void>;
}

export async function runCodeLensAction(
  uri: vscode.Uri,
  line: number,
  character: number,
  name: string,
  fqn: string,
  deps: {
    getCachedResults: (fqn: string) => Promise<UsageResult[]> | undefined;
    usagesPanel: CodeLensActionPanel;
  },
): Promise<void> {
  // CodeLens clicks are command-driven selections, not declaration navigation.
  clearPendingDeclNav();

  const doc = await vscode.workspace.openTextDocument(uri);
  const editor = await vscode.window.showTextDocument(doc, { preview: false });
  const pos = new vscode.Position(line, character);
  editor.selection = new vscode.Selection(pos, pos);

  const smartNav = vscode.workspace.getConfiguration('kotlinJump').get<boolean>('smartNavigation', false);
  const exclude = { excludeUri: uri.toString(), excludeLine: line };

  if (!smartNav) {
    await vscode.commands.executeCommand('kotlin-jump.findUsages', exclude);
    return;
  }

  const cached = fqn ? deps.getCachedResults(fqn) : undefined;
  if (cached) {
    try {
      const results = await cached;
      await vscode.commands.executeCommand('kotlinJump.findUsages.focus');
      await deps.usagesPanel.populateFromResults(name, results, exclude);
      return;
    } catch {
      // cache error → fallback to full scan
    }
  }

  await vscode.commands.executeCommand('kotlin-jump.findUsages', exclude);
}
