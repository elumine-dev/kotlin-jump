import * as vscode from 'vscode';

export interface SourcesState {
  /** Total libraries indexed (Gradle + Maven + bundled). */
  libsIndexed: number;
  /** JDK indexed? `'ok'` if src.zip parsed, `'missing'` if JDK detected
   *  but src.zip absent, `'absent'` if no JDK at all. */
  jdk: 'ok' | 'missing' | 'absent';
  /** Bundled Kotlin stdlib loaded successfully. */
  bundledStdlib: boolean;
  /** Coords parsed from build files but not yet indexed. */
  missingCoords: number;
  /** True while a scan or download is in flight. */
  scanning: boolean;
  /** True after the most recent download attempt failed. */
  networkError: boolean;
}

const COMMAND_OPEN_ACTIONS = 'kotlin-jump.sources.openActions';

/**
 * Dedicated status bar item for library sources state — distinct from
 * the existing symbol-count item. Sits at priority 99 (just left of
 * the symbol count at 100).
 *
 * 5 visual states (see plan §UX) with click-to-open the actions menu.
 *
 * Hidden when `kotlinJump.indexSourcesJars` is `false` or when
 * `companionMode` resolves to JetBrains LSP active (KJ delegates
 * everything to JB, so the badge is noise).
 */
export class SourcesStatusBar implements vscode.Disposable {
  private readonly item: vscode.StatusBarItem;
  private state: SourcesState = {
    libsIndexed:   0,
    jdk:           'absent',
    bundledStdlib: false,
    missingCoords: 0,
    scanning:      false,
    networkError:  false,
  };

  constructor() {
    this.item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 99);
    this.item.command = COMMAND_OPEN_ACTIONS;
    this.refresh();
    this.applyVisibility();
  }

  /** Replace the entire state. Triggers a UI refresh. */
  setState(next: Partial<SourcesState>): void {
    this.state = { ...this.state, ...next };
    this.refresh();
    this.applyVisibility();
  }

  /** Get a snapshot of the current state (read-only). */
  getState(): Readonly<SourcesState> {
    return this.state;
  }

  private refresh(): void {
    const s = this.state;
    if (s.networkError) {
      this.item.text    = '$(error) KJ libs: download failed';
      this.item.tooltip = this.buildTooltip('Network error during last download. Click for actions.');
      this.item.backgroundColor = new vscode.ThemeColor('statusBarItem.errorBackground');
      return;
    }
    if (s.scanning) {
      this.item.text    = '$(sync~spin) KJ libs: scanning…';
      this.item.tooltip = 'Indexing library sources (Gradle / Maven / JDK / bundled stdlib)';
      this.item.backgroundColor = undefined;
      return;
    }
    if (s.missingCoords > 0) {
      const total = s.libsIndexed + s.missingCoords;
      this.item.text    = `$(cloud-download) KJ: ${s.libsIndexed}/${total} libs missing`;
      this.item.tooltip = this.buildTooltip(`${s.missingCoords} sources can be downloaded. Click to fetch.`);
      this.item.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
      return;
    }
    // All-good state
    const jdkBadge = s.jdk === 'ok' ? ' · JDK' : '';
    const stdlibBadge = s.bundledStdlib ? ' · stdlib ✓' : '';
    this.item.text    = `$(library) KJ: ${s.libsIndexed} libs${jdkBadge}${stdlibBadge}`;
    this.item.tooltip = this.buildTooltip('All known library sources indexed. Click for actions.');
    this.item.backgroundColor = undefined;
  }

  private buildTooltip(suffix: string): string {
    const s = this.state;
    const lines = [
      `Kotlin Jump — Library Sources`,
      ``,
      `Indexed:        ${s.libsIndexed} library/-ies`,
      `JDK:            ${s.jdk === 'ok' ? '✓ src.zip indexed' : s.jdk === 'missing' ? '⚠ detected but no src.zip' : '✗ no JDK detected'}`,
      `Bundled stdlib: ${s.bundledStdlib ? '✓ loaded (fallback)' : '✗ not loaded'}`,
      `Missing:        ${s.missingCoords} library/-ies (downloadable via HTTP)`,
      ``,
      suffix,
    ];
    return lines.join('\n');
  }

  private applyVisibility(): void {
    const cfg = vscode.workspace.getConfiguration('kotlinJump');
    if (!cfg.get<boolean>('indexSourcesJars', true)) {
      this.item.hide();
      return;
    }
    // If companion mode says JB LSP is active, hide — JB owns navigation.
    // (Heuristic: companionMode === 'always', or 'auto' + JB LSP detected.
    // For now, just check the setting; full JB-LSP detection lives elsewhere.)
    const companion = cfg.get<string>('companionMode', 'auto');
    if (companion === 'always') {
      this.item.hide();
      return;
    }
    this.item.show();
  }

  dispose(): void {
    this.item.dispose();
  }
}
