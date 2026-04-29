import * as vscode from 'vscode';
import { Logger } from '../util/logger';
import { DependencyResolver } from '../http/DependencyResolver';
import { HttpSourcesDownloader } from '../http/HttpSourcesDownloader';
import { formatCoords } from '../http/MavenCoordinatesParser';
import { SourcesStatusBar } from './SourcesStatusBar';

const FIRST_SCAN_SUPPRESSED = 'kotlinJump.suppressFirstScanPrompt';

/**
 * Wires the user-facing commands behind the SourcesStatusBar:
 *   1. `kotlin-jump.sources.openActions` — quickpick menu (called on
 *      status bar item click).
 *   2. `kotlin-jump.sources.downloadMissing` — bulk download.
 *   3. `kotlin-jump.sources.refresh`        — re-scan everything.
 *
 * Also handles the *first-scan prompt* shown the very first time a
 * cold-cache user opens a Kotlin project.
 */
export class SourcesActionsMenu implements vscode.Disposable {
  private subs: vscode.Disposable[] = [];

  constructor(
    private readonly statusBar:  SourcesStatusBar,
    private readonly log:        Logger,
    private readonly onRefresh:  () => void,
  ) {
    this.subs.push(
      vscode.commands.registerCommand('kotlin-jump.sources.openActions', () => this.openMenu()),
      vscode.commands.registerCommand('kotlin-jump.sources.downloadMissing', () => this.downloadMissing()),
      vscode.commands.registerCommand('kotlin-jump.sources.refresh', () => this.onRefresh()),
    );
  }

  /**
   * Shows the first-scan prompt once if the conditions are met:
   *   - At least one Maven coord parsed from build files
   *   - Cache is empty (no library indexed yet)
   *   - User hasn't dismissed the prompt before
   *
   * Non-modal, single appearance per user lifetime.
   */
  async maybeShowFirstScanPrompt(): Promise<void> {
    const cfg = vscode.workspace.getConfiguration('kotlinJump');
    if (cfg.get<boolean>(FIRST_SCAN_SUPPRESSED.replace('kotlinJump.', ''), false)) return;

    const state = this.statusBar.getState();
    if (state.libsIndexed > 0) return;       // already has libs cached
    if (state.missingCoords === 0) return;   // nothing to download

    const choice = await vscode.window.showInformationMessage(
      `Kotlin Jump: library navigation needs sources. ` +
      `${state.missingCoords} libraries can be downloaded (~${state.missingCoords * 500} KB).`,
      'Download now',
      'Configure',
      "Don't show again",
    );
    if (choice === 'Download now') {
      await this.downloadMissing();
    } else if (choice === 'Configure') {
      await vscode.commands.executeCommand('workbench.action.openSettings', '@ext:elumine.kotlin-jump sources');
    } else if (choice === "Don't show again") {
      await vscode.workspace.getConfiguration('kotlinJump')
        .update('suppressFirstScanPrompt', true, vscode.ConfigurationTarget.Global);
    }
  }

  private async openMenu(): Promise<void> {
    const state = this.statusBar.getState();
    const items: vscode.QuickPickItem[] = [];

    if (state.missingCoords > 0) {
      items.push({
        label: '$(cloud-download) Download missing sources',
        description: `${state.missingCoords} libs · via HTTP (no JVM)`,
      });
    }
    items.push({
      label: '$(refresh) Refresh cache',
      description: 'Re-scan Gradle / Maven / JDK / bundled stdlib',
    });
    items.push({
      label: '$(file-zip) Bundled Kotlin stdlib',
      description: state.bundledStdlib ? 'Active (fallback)' : 'Disabled',
    });
    items.push({
      label: '$(gear) Open settings',
      description: 'Configure indexing',
    });
    items.push({
      label: '$(question) Why are sources needed?',
      description: 'Open documentation',
    });

    const picked = await vscode.window.showQuickPick(items, {
      title: 'Kotlin Jump: Library Sources',
      placeHolder: 'Choose an action',
    });
    if (!picked) return;

    if (picked.label.includes('Download missing')) {
      await this.downloadMissing();
    } else if (picked.label.includes('Refresh cache')) {
      this.onRefresh();
    } else if (picked.label.includes('Bundled Kotlin stdlib')) {
      await vscode.commands.executeCommand('workbench.action.openSettings', 'kotlinJump.useBundledStdlib');
    } else if (picked.label.includes('Open settings')) {
      await vscode.commands.executeCommand('workbench.action.openSettings', '@ext:elumine.kotlin-jump sources');
    } else if (picked.label.includes('Why are sources')) {
      void vscode.env.openExternal(vscode.Uri.parse('https://github.com/elumine-dev/kotlin-jump#library-navigation'));
    }
  }

  /**
   * Resolves all coords from the workspace's build files, then runs
   * `HttpSourcesDownloader.downloadAll` inside a progress notification.
   * Triggers a refresh on completion so the new JARs are indexed.
   */
  private async downloadMissing(): Promise<void> {
    const folders = vscode.workspace.workspaceFolders;
    if (!folders || folders.length === 0) {
      vscode.window.showWarningMessage('Kotlin Jump: no workspace folder open.');
      return;
    }

    const resolver   = new DependencyResolver();
    const downloader = new HttpSourcesDownloader(this.log);

    const coordsAll = await resolver.resolveAll(folders[0].uri.fsPath);
    if (coordsAll.length === 0) {
      vscode.window.showInformationMessage(
        'Kotlin Jump: no Maven coords found in build files. Nothing to download.',
      );
      return;
    }

    await vscode.window.withProgress(
      {
        location:    vscode.ProgressLocation.Notification,
        title:       `Kotlin Jump: downloading ${coordsAll.length} library sources`,
        cancellable: true,
      },
      async (progress, token) => {
        token.onCancellationRequested(() => downloader.cancel());

        const results = await downloader.downloadAll(coordsAll, undefined, (update) => {
          const pct = Math.round((update.current / update.total) * 100);
          progress.report({
            increment: (1 / update.total) * 100,
            message:   `${pct}% · ${formatCoords(update.coords)}`,
          });
        });

        const ok   = results.filter(r => !r.error).length;
        const fail = results.length - ok;
        const totalBytes = results.reduce((s, r) => s + r.bytes, 0);
        this.log.info(`[http-dl] done: ${ok} OK, ${fail} failed, ${(totalBytes / 1024).toFixed(0)} KB`);
        if (fail > 0) {
          this.statusBar.setState({ networkError: true });
        }
      },
    );

    // Re-scan to pick up the freshly downloaded JARs from the cache.
    this.onRefresh();
  }

  dispose(): void {
    for (const s of this.subs) s.dispose();
  }
}
