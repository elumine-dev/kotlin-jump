import * as vscode from 'vscode';

const MAX_HISTORY          = 100;
const MOUSE_JUMP_THRESHOLD = 10;

interface NavEntry {
  uri:       string;
  line:      number;
  character: number;
  /** Epoch ms de la visite — KJ-008 (recent locations). */
  timestamp?: number;
}

export class NavigationHistoryProvider implements vscode.Disposable {
  private readonly _history: NavEntry[] = [];
  private          _cursor              = -1;

  private readonly _lastKnownPositions = new Map<string, { line: number; character: number }>();
  private          _lastActiveUri: string | undefined;
  // When a file switch occurs, showTextDocument fires onDidChangeActiveTextEditor BEFORE
  // its `selection` option is applied. We push a L0 placeholder and update it on every
  // selection event for that file within the next 500ms (last wins).
  private          _pendingToUri: string | undefined;
  private          _pendingClearTimer: ReturnType<typeof setTimeout> | undefined;
  private          _isNavigating       = false;
  // URI we just navigated to — absorbs the late-arriving onDidChangeActiveTextEditor
  // that VS Code fires after _isNavigating has been cleared by setTimeout(0).
  private          _navigatingToUri: string | undefined;

  private readonly _subs: vscode.Disposable[];

  constructor() {
    const active = vscode.window.activeTextEditor;
    if (active) {
      const uri = active.document.uri.toString();
      const pos = active.selection.active;
      this._lastActiveUri = uri;
      this._lastKnownPositions.set(uri, { line: pos.line, character: pos.character });
      this._push({ uri, line: pos.line, character: pos.character });
      this._updateContext();
    }

    this._subs = [
      vscode.window.onDidChangeActiveTextEditor(e  => this._onEditorChanged(e)),
      vscode.window.onDidChangeTextEditorSelection(e => this._onSelectionChanged(e)),
      vscode.commands.registerCommand('kotlinJump.navigateBack',    () => this._back()),
      vscode.commands.registerCommand('kotlinJump.navigateForward', () => this._forward()),
      vscode.commands.registerCommand('kotlinJump.clearNavigationHistory', () => this._clear()),
    ];
  }

  dispose(): void {
    for (const s of this._subs) s.dispose();
  }

  // ── Public state accessors (for tests) ──────────────────────────────────────

  get historyLength(): number { return this._history.length; }
  get cursor():        number { return this._cursor; }

  /** KJ-008 — instantané de l'historique pour le popup Recent Locations. */
  recentLocations(): { file: string; line: number; character: number; timestamp: number }[] {
    return this._history.map(e => ({
      file: e.uri,
      line: e.line,
      character: e.character,
      timestamp: e.timestamp ?? 0,
    }));
  }

  // ── Private helpers ──────────────────────────────────────────────────────────

  private _currentEntry(): NavEntry | undefined {
    return this._cursor >= 0 ? this._history[this._cursor] : undefined;
  }

  private _push(entry: NavEntry): void {
    const cur = this._currentEntry();
    if (cur && cur.uri === entry.uri && cur.line === entry.line) return;

    if (this._cursor < this._history.length - 1) {
      this._history.splice(this._cursor + 1);
    }

    this._history.push({ ...entry, timestamp: entry.timestamp ?? Date.now() });
    this._cursor = this._history.length - 1;

    if (this._history.length > MAX_HISTORY) {
      const excess = this._history.length - MAX_HISTORY;
      this._history.splice(0, excess);
      this._cursor -= excess;
    }
  }

  private _updateContext(): void {
    vscode.commands.executeCommand('setContext', 'kotlinJump.canNavigateBack',    this._cursor > 0);
    vscode.commands.executeCommand('setContext', 'kotlinJump.canNavigateForward', this._cursor < this._history.length - 1);
  }

  private _clear(): void {
    this._history.length = 0;
    this._cursor         = -1;
    this._lastActiveUri  = undefined;
    this._lastKnownPositions.clear();
    this._pendingToUri    = undefined;
    if (this._pendingClearTimer) {
      clearTimeout(this._pendingClearTimer);
      this._pendingClearTimer = undefined;
    }
    this._isNavigating    = false;
    this._navigatingToUri = undefined;
    this._updateContext();
  }

  // ── Event handlers ───────────────────────────────────────────────────────────

  private _onEditorChanged(editor: vscode.TextEditor | undefined): void {
    if (!editor) return;
    const newUri = editor.document.uri.toString();

    if (this._isNavigating) {
      this._lastActiveUri = newUri;
      return;
    }

    // Late-arriving event from our own navigation (fired after setTimeout(0) cleared
    // _isNavigating) — eat it so we don't push a spurious history entry.
    // We do NOT clear `_navigatingToUri` here: VS Code may still fire one
    // or more Command-kind selection events for this file (cursor restore,
    // viewport restore) AFTER this editor-changed event, and those need
    // the same guard so they aren't pushed as user navigations — pushing
    // them would silently truncate the forward stack and break Forward
    // immediately after Back. The 500 ms timer in `_navigateTo` is the
    // single point of truth for clearing the guard.
    if (this._navigatingToUri === newUri) {
      this._lastActiveUri = newUri;
      return;
    }

    const prevUri   = this._lastActiveUri;
    const prevKnown = prevUri ? this._lastKnownPositions.get(prevUri) : undefined;
    if (prevKnown && prevUri) {
      this._push({ uri: prevUri, line: prevKnown.line, character: prevKnown.character });
    }

    this._lastActiveUri = newUri;
    this._pendingToUri  = newUri;

    // Push a L0 placeholder that will be updated to the real position by selection
    // events in the next 500ms. Keep the window open so both VS Code's restored-state
    // event AND our explicit editor.selection set can update it — last wins.
    this._push({ uri: newUri, line: 0, character: 0 });
    this._updateContext();

    if (this._pendingClearTimer) clearTimeout(this._pendingClearTimer);
    this._pendingClearTimer = setTimeout(() => {
      if (this._pendingToUri === newUri) this._pendingToUri = undefined;
      this._pendingClearTimer = undefined;
    }, 500);
  }

  private _onSelectionChanged(e: vscode.TextEditorSelectionChangeEvent): void {
    const uri = e.textEditor.document.uri.toString();
    const pos = e.selections[0]?.active;
    if (!pos) return;

    const { kind } = e;

    // During navigation, absorb events — just update lastKnown, no history changes.
    if (this._isNavigating || this._navigatingToUri === uri) {
      this._lastKnownPositions.set(uri, { line: pos.line, character: pos.character });
      return;
    }

    // Pending placeholder from a recent editor switch — keep refining it on every
    // programmatic-kind event (VS Code's restore + our explicit editor.selection set).
    // Don't clear _pendingToUri here; the 500ms timer from _onEditorChanged does that.
    if (this._pendingToUri === uri && (kind === undefined || kind === vscode.TextEditorSelectionChangeKind.Command)) {
      this._history[this._cursor] = { uri, line: pos.line, character: pos.character };
      this._lastKnownPositions.set(uri, { line: pos.line, character: pos.character });
      this._updateContext();
      return;
    }

    if (kind === vscode.TextEditorSelectionChangeKind.Keyboard || kind === undefined) {
      this._lastKnownPositions.set(uri, { line: pos.line, character: pos.character });
      return;
    }

    if (kind === vscode.TextEditorSelectionChangeKind.Mouse) {
      // Cross-file mouse click → already handled by _onEditorChanged
      if (uri !== this._lastActiveUri) return;

      const known    = this._lastKnownPositions.get(uri);
      const distance = known ? Math.abs(pos.line - known.line) : Infinity;

      if (distance <= MOUSE_JUMP_THRESHOLD) {
        this._lastKnownPositions.set(uri, { line: pos.line, character: pos.character });
        return;
      }

      if (known) this._push({ uri, line: known.line, character: known.character });
      this._lastKnownPositions.set(uri, { line: pos.line, character: pos.character });
      this._push({ uri, line: pos.line, character: pos.character });
      this._updateContext();
      return;
    }

    if (kind === vscode.TextEditorSelectionChangeKind.Command) {
      // Same-file Command — record from + to (cross-file is handled by the placeholder above).
      const known = this._lastKnownPositions.get(uri);
      if (known) this._push({ uri, line: known.line, character: known.character });
      this._push({ uri, line: pos.line, character: pos.character });
      this._lastKnownPositions.set(uri, { line: pos.line, character: pos.character });
      this._updateContext();
    }
  }

  // ── Navigation commands ──────────────────────────────────────────────────────

  private async _back(): Promise<void> {
    if (this._cursor <= 0) return;
    this._cursor--;
    this._updateContext();
    await this._navigateTo(this._history[this._cursor]);
  }

  private async _forward(): Promise<void> {
    if (this._cursor >= this._history.length - 1) return;
    this._cursor++;
    this._updateContext();
    await this._navigateTo(this._history[this._cursor]);
  }

  private async _navigateTo(entry: NavEntry): Promise<void> {
    this._isNavigating    = true;
    this._navigatingToUri = entry.uri;
    try {
      const uri    = vscode.Uri.parse(entry.uri);
      const pos    = new vscode.Position(entry.line, entry.character);
      const doc    = await vscode.workspace.openTextDocument(uri);
      // Pass `selection` to showTextDocument so VS Code applies the
      // cursor + viewport ATOMICALLY with the document open. The
      // previous flow ( showTextDocument → editor.selection = pos )
      // raced with VS Code's own view-state restore, occasionally
      // landing the cursor at the file's saved position (often col 0)
      // instead of the entry's stored column. The setter and
      // revealRange below remain as belt-and-braces in case the host
      // ignores the option (older VS Code versions).
      const range  = new vscode.Range(pos, pos);
      const editor = await vscode.window.showTextDocument(doc, {
        preview:        false,
        preserveFocus:  false,
        selection:      range,
      });
      editor.selection = new vscode.Selection(pos, pos);
      editor.revealRange(
        range,
        vscode.TextEditorRevealType.InCenterIfOutsideViewport,
      );
    } catch {
      // File may have been deleted — silent no-op
    } finally {
      this._lastActiveUri = entry.uri;
      this._lastKnownPositions.set(entry.uri, { line: entry.line, character: entry.character });
      setTimeout(() => { this._isNavigating = false; }, 0);
      // Single point of truth for clearing _navigatingToUri. The
      // 500 ms window is generous enough to absorb VS Code's
      // post-show Command-kind selection events for both same-file
      // and cross-file navigations.
      setTimeout(() => { if (this._navigatingToUri === entry.uri) this._navigatingToUri = undefined; }, 500);
    }
  }
}
