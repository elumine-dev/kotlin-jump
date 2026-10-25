import * as vscode from 'vscode';
import type { DependencyUpgradeProvider } from './DependencyUpgradeProvider';
import { badgeFor, isReported } from './dependencyUpgrades';
import { reportDecorations } from '../util/demoProbe';

/**
 * KJ-082 end of line badges: `↑ 3.0.0` after a version that can move,
 * `pin 4.12.0` after a dynamic one.
 *
 * Decorations, like the dependency usage badges: cheap to paint, and the demo
 * probe can count them and read their text, which an inlay hint cannot offer.
 * They follow the findings the provider holds and repaint when those change.
 */
export class DependencyUpgradeBadgeProvider implements vscode.Disposable {
  static readonly PROBE_ID = 'dependencyUpgrades';

  private readonly badge = vscode.window.createTextEditorDecorationType({
    after: { margin: '0 0 0 2em', color: new vscode.ThemeColor('editorCodeLens.foreground') },
  });
  private readonly subs: vscode.Disposable[];

  constructor(private readonly provider: DependencyUpgradeProvider, private readonly enabled: () => boolean) {
    this.subs = [
      provider.onDidUpdate(files => this.repaint(files)),
      vscode.window.onDidChangeVisibleTextEditors(() => this.repaint()),
      vscode.workspace.onDidChangeConfiguration(e => { if (e.affectsConfiguration('kotlinJump.upgrades')) this.repaint(); }),
    ];
    this.repaint();
  }

  /** Repaints the visible editors of `files`, or every visible editor. */
  repaint(files?: readonly string[]): void {
    const only = files ? new Set(files) : undefined;
    let total = 0;
    const texts: string[] = [];
    for (const editor of vscode.window.visibleTextEditors) {
      const file = editor.document.uri.fsPath;
      if (only && !only.has(file)) continue;
      const entry = this.enabled() ? this.provider.findingsFor(file) : undefined;
      const decorations: vscode.DecorationOptions[] = [];
      if (entry) {
        const text = editor.document.getText();
        const starts = [0];
        for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) === 10) starts.push(i + 1);
        for (const f of entry.findings) {
          if (!isReported(f)) continue;
          const label = badgeFor(f);
          if (!label) continue;
          let line = 0;
          while (line + 1 < starts.length && starts[line + 1] <= f.dependency.range.start) line++;
          const end = editor.document.lineAt(line).text.length;
          decorations.push({ range: new vscode.Range(line, end, line, end), renderOptions: { after: { contentText: label } } });
          texts.push(label);
        }
      }
      editor.setDecorations(this.badge, decorations);
      total += decorations.length;
    }
    reportDecorations(DependencyUpgradeBadgeProvider.PROBE_ID, total, texts);
  }

  dispose(): void {
    for (const s of this.subs) s.dispose();
    this.badge.dispose();
  }
}
