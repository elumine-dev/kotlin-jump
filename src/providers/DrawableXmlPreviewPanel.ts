import * as vscode from 'vscode';
import { vectorXmlToSvg } from '../util/vectorToSvg';
import { SymbolIndex } from '../indexer/SymbolIndex';
import { isExcluded } from './FindUsagesEngine';
import { decodeUtf8 } from '../util/encoding';

const DRAWABLE_PATH_RE = /\/res\/drawable[^/]*\//;
const VECTOR_OPEN_RE = /<vector\b/;

/**
 * CodeLens above the <vector> opening tag of any drawable XML.
 *
 *   $(symbol-color) Open Vector Preview     |     N references
 *   <vector …>
 *
 * Two lenses on the same line:
 *
 *   1. Open Preview — re-opens the side preview panel after dismissal.
 *      Always emitted synchronously in `provideCodeLenses`.
 *   2. References   — count of `R.drawable.<name>` usages workspace-wide.
 *      Resolved asynchronously in `resolveCodeLens` so the lens shows
 *      up immediately ("…") and the count fills in once the scan
 *      completes. Click opens the standard references peek with every
 *      usage location.
 */
export class DrawableXmlPreviewLensProvider implements vscode.CodeLensProvider, vscode.Disposable {
  // Workspace scan is cheap to run, but it's still N file reads — and
  // VS Code calls `resolveCodeLens` whenever the doc state changes, so
  // we'd repeat the scan dozens of times per session. Cache per
  // drawable name; invalidate on SAVE (never on every keystroke).
  //
  // Why save and not every edit:
  //   - The scan reads via `vscode.workspace.fs.readFile`, which sees
  //     the on-disk content. In-memory unsaved edits are invisible to
  //     it, so the cached count CAN'T be wrong before a save.
  //   - `onDidChangeTextDocument` fires on every keystroke; clearing
  //     the cache there would trigger a full workspace scan on every
  //     character typed in any Kotlin/Java file that's open at the
  //     same time as a drawable XML. Worst-case behaviour, killed
  //     before it ships.
  private readonly _refsCache = new Map<string, vscode.Location[]>();
  private readonly _onDidChangeCodeLenses = new vscode.EventEmitter<void>();
  readonly onDidChangeCodeLenses = this._onDidChangeCodeLenses.event;
  private readonly _subs: vscode.Disposable[];

  constructor(private readonly index: SymbolIndex) {
    this._subs = [
      // Invalidate on save of any language that can host an
      // `R.drawable.X` reference. Saves are infrequent — typing
      // freely doesn't bust the cache.
      vscode.workspace.onDidSaveTextDocument(doc => {
        const lang = doc.languageId;
        if (lang !== 'kotlin' && lang !== 'java' && lang !== 'kotlinscript') return;
        if (this._refsCache.size === 0) return;
        this._refsCache.clear();
        this._onDidChangeCodeLenses.fire();
      }),
    ];
  }

  dispose(): void {
    for (const s of this._subs) s.dispose();
    this._onDidChangeCodeLenses.dispose();
    this._refsCache.clear();
  }

  provideCodeLenses(document: vscode.TextDocument): vscode.CodeLens[] {
    if (document.languageId !== 'xml') return [];
    if (!DRAWABLE_PATH_RE.test(document.uri.path)) return [];

    const text = document.getText();
    const m = VECTOR_OPEN_RE.exec(text);
    if (!m) return [];
    const pos = document.positionAt(m.index);
    const range = new vscode.Range(pos.line, 0, pos.line, 0);
    const drawableName = drawableNameOf(document.uri);
    return [
      new vscode.CodeLens(range, {
        title: '$(symbol-color) Open Vector Preview',
        command: 'kotlinJump.vectorPreview.show',
        tooltip: 'Open the side-by-side rendered preview for this <vector>.',
      }),
      // Placeholder lens. resolveCodeLens fills in the count + a real
      // command that opens the references peek with the actual hits.
      // Tagging the lens via a custom symbol on the range so resolve
      // can recognise its own placeholders.
      Object.assign(new vscode.CodeLens(range), {
        _kjDrawableName: drawableName,
        _kjDocUri: document.uri,
      }) as vscode.CodeLens,
    ];
  }

  async resolveCodeLens(
    lens: vscode.CodeLens,
    token: vscode.CancellationToken,
  ): Promise<vscode.CodeLens | undefined> {
    const meta = lens as vscode.CodeLens & { _kjDrawableName?: string; _kjDocUri?: vscode.Uri };
    if (!meta._kjDrawableName || !meta._kjDocUri) return lens;

    const name = meta._kjDrawableName;
    const docUri = meta._kjDocUri;
    let locations = this._refsCache.get(name);
    if (!locations) {
      locations = await this.findDrawableUsages(name, token);
      if (token.isCancellationRequested) return lens;
      this._refsCache.set(name, locations);
    }

    // Single result → jump straight there. Multiple → references peek.
    // Zero → still use `showReferences` with an empty array so the
    // lens stays visible and the click feels intentional ("nothing to
    // show, you just confirmed it"). An empty `command.command`
    // string used to hide the lens entirely.
    const count = locations.length;
    if (count === 0) {
      // No-op-but-clickable lens. Use the auto-close wrapper too so the
      // empty peek (with its "no results" message) self-dismisses on
      // first navigation event — same UX contract as the populated
      // case below.
      lens.command = {
        title: 'No references',
        command: 'kotlinJump.vectorPreview.showRefsAutoClose',
        arguments: [docUri, new vscode.Position(0, 0), [] as vscode.Location[]],
        tooltip: 'No R.drawable / R.mipmap usage found workspace-wide.',
      };
    } else if (count === 1) {
      const loc = locations[0];
      lens.command = {
        title: '1 reference',
        command: 'kotlinJump.vectorPreview.gotoSingleRef',
        arguments: [loc.uri, loc.range.start],
        tooltip: 'Jump to the only R.drawable / R.mipmap usage of this resource.',
      };
    } else {
      lens.command = {
        title: `${count} references`,
        command: 'kotlinJump.vectorPreview.showRefsAutoClose',
        arguments: [docUri, new vscode.Position(0, 0), locations],
        tooltip: 'Show every R.drawable / R.mipmap usage of this resource.',
      };
    }
    return lens;
  }

  /**
   * Find every `R.drawable.<name>` (and `R.mipmap.<name>`) reference
   * across the workspace.
   *
   * We can't lean on the symbol-name index here: drawable resources
   * never appear as Kotlin/Java symbols, so `byName` and `byWord` are
   * both empty for `ic_banner` even when the codebase references it
   * a hundred times. Direct scan it is — concurrent reads, with a
   * `text.includes(prefix)` fast-path so files that don't even mention
   * the resource name skip the per-line regex entirely.
   */
  private async findDrawableUsages(
    name: string,
    token: vscode.CancellationToken,
  ): Promise<vscode.Location[]> {
    const drawablePrefix = `R.drawable.${name}`;
    const mipmapPrefix   = `R.mipmap.${name}`;
    const uriStrings = this.index.fileUriStrings().filter(u => !isExcluded(u));
    const re = new RegExp(`\\bR\\.(?:drawable|mipmap)\\.${escapeRegex(name)}\\b`, 'g');
    const out: vscode.Location[] = [];

    // Concurrency cap mirrors FindUsagesEngine's IO worker pool: keeps
    // file system pressure low on huge workspaces while still hiding
    // I/O latency.
    const CONCURRENCY = 32;
    let cursor = 0;
    const worker = async (): Promise<void> => {
      while (cursor < uriStrings.length && !token.isCancellationRequested) {
        const uriStr = uriStrings[cursor++];
        const uri = vscode.Uri.parse(uriStr);
        try {
          const bytes = await vscode.workspace.fs.readFile(uri);
          const text = decodeUtf8(bytes);
          if (!text.includes(drawablePrefix) && !text.includes(mipmapPrefix)) continue;
          const lines = text.split('\n');
          for (let i = 0; i < lines.length; i++) {
            re.lastIndex = 0;
            let m: RegExpExecArray | null;
            while ((m = re.exec(lines[i])) !== null) {
              out.push(new vscode.Location(uri, new vscode.Position(i, m.index)));
            }
          }
        } catch { /* skip unreadable */ }
      }
    };
    await Promise.all(Array.from({ length: CONCURRENCY }, worker));
    return out;
  }
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** `…/res/drawable/ic_banner.xml` → `ic_banner`. */
function drawableNameOf(uri: vscode.Uri): string {
  const file = uri.path.split('/').pop() ?? '';
  return file.replace(/\.xml$/i, '');
}

/**
 * Auto-opening side-by-side preview panel for Android <vector> drawables.
 *
 * UX contract — no manual interaction required:
 *
 *   - When the user opens (or focuses) a `res/drawable*\/*.xml` that
 *     contains a <vector>, a webview panel slides into the editor
 *     column beside the source. Code on the left, rendered SVG on
 *     the right.
 *   - The preview keeps focus on the source editor (`preserveFocus`)
 *     so typing is uninterrupted.
 *   - As the source changes, the preview re-renders (debounced 120 ms).
 *   - One panel is reused across files. Switching to another vector
 *     XML updates its content; switching to a non-drawable file leaves
 *     the panel showing the last vector (so it stays useful as a
 *     reference while you read related Kotlin code).
 *   - If the user closes the panel manually, we remember and stop
 *     auto-opening for the rest of the session — no nagging.
 */
export class DrawableXmlPreviewPanel implements vscode.Disposable {
  private panel?: vscode.WebviewPanel;
  /** Source URI of whatever is currently rendered. */
  private currentUri?: vscode.Uri;
  /** Set to `true` once the user closes the panel. We don't reopen automatically. */
  private dismissed = false;
  private updateTimer: ReturnType<typeof setTimeout> | undefined;
  private readonly subs: vscode.Disposable[] = [];

  constructor() {
    this.subs.push(
      vscode.window.onDidChangeActiveTextEditor(e => this.onActiveEditor(e)),
      vscode.workspace.onDidChangeTextDocument(e => this.onDocChange(e)),
      vscode.workspace.onDidChangeConfiguration(e => {
        if (e.affectsConfiguration('kotlinJump.vectorPreview')) this.evaluate();
      }),
    );
    // Evaluate on activation so a vector XML already-open at startup
    // gets its preview without waiting for a focus change.
    this.evaluate();
  }

  /** Manual command target — re-opens the panel after the user dismissed it.
   *  Defensive against active-editor weirdness: if `activeTextEditor` doesn't
   *  point at a vector drawable XML (focus got eaten by a previous click,
   *  the preview's `preserveFocus` race, etc.), fall back to any visible
   *  drawable XML editor before giving up. The CodeLens above `<vector>`
   *  was a dead button without this guard. */
  show(): void {
    this.dismissed = false;
    const active = vscode.window.activeTextEditor;
    if (active && this.isVectorDrawableXml(active.document)) {
      this.openOrReuse(active);
      this.render(active.document);
      return;
    }
    for (const ed of vscode.window.visibleTextEditors) {
      if (this.isVectorDrawableXml(ed.document)) {
        this.openOrReuse(ed);
        this.render(ed.document);
        return;
      }
    }
    void vscode.window.showInformationMessage(
      'Open a vector drawable XML to preview it.',
    );
  }

  /** Manual command target — closes the panel programmatically (used by the demo). */
  close(): void {
    this.panel?.dispose();
  }

  // ── Reactivity ─────────────────────────────────────────────────────
  private onActiveEditor(_e: vscode.TextEditor | undefined): void {
    this.evaluate();
  }

  private onDocChange(e: vscode.TextDocumentChangeEvent): void {
    if (!this.panel || !this.currentUri) return;
    if (e.document.uri.toString() !== this.currentUri.toString()) return;
    clearTimeout(this.updateTimer);
    this.updateTimer = setTimeout(() => this.render(e.document), 120);
  }

  private evaluate(force = false): void {
    if (this.dismissed && !force) return;
    if (!this.autoOpenEnabled() && !force) return;

    const editor = vscode.window.activeTextEditor;
    if (!editor) return;
    const doc = editor.document;
    if (!this.isVectorDrawableXml(doc)) return;

    this.openOrReuse(editor);
    this.render(doc);
  }

  private isVectorDrawableXml(doc: vscode.TextDocument): boolean {
    if (doc.languageId !== 'xml') return false;
    if (!DRAWABLE_PATH_RE.test(doc.uri.path)) return false;
    // Cheap text scan — we don't want to convert the whole doc to SVG
    // just to decide whether a preview is worth opening.
    return /<vector\b/.test(doc.getText());
  }

  private autoOpenEnabled(): boolean {
    return vscode.workspace
      .getConfiguration('kotlinJump.vectorPreview')
      .get<boolean>('autoOpen', true);
  }

  // ── Panel lifecycle ────────────────────────────────────────────────
  private openOrReuse(editor: vscode.TextEditor): void {
    if (this.panel) {
      // Already open — reveal in its column without taking focus.
      this.panel.reveal(this.panel.viewColumn ?? vscode.ViewColumn.Beside, /* preserveFocus= */ true);
      return;
    }
    // Open BESIDE the source so code stays on the left, preview right.
    this.panel = vscode.window.createWebviewPanel(
      'kotlinJump.vectorPreview',
      'Vector Preview',
      { viewColumn: vscode.ViewColumn.Beside, preserveFocus: true },
      // Webview is a static SVG render — no scripts, no message passing.
      // `retainContextWhenHidden` avoids flicker when the user pops the
      // panel into the background tab and back.
      { enableScripts: false, retainContextWhenHidden: true },
    );
    this.panel.iconPath = new vscode.ThemeIcon('symbol-color');
    this.panel.onDidDispose(() => {
      this.panel = undefined;
      this.currentUri = undefined;
      this.dismissed = true; // user closed it — respect that for the session
    }, null, this.subs);

    // Bring focus straight back to the source editor — `preserveFocus`
    // already covers the createWebviewPanel call, but
    // `retainContextWhenHidden` + a freshly-opened panel sometimes
    // briefly steals focus on macOS. Explicit re-focus is belt+braces.
    void vscode.window.showTextDocument(editor.document, {
      viewColumn: editor.viewColumn,
      preserveFocus: false,
      preview: false,
    });
  }

  private render(doc: vscode.TextDocument): void {
    if (!this.panel) return;
    const svg = vectorXmlToSvg(doc.getText());
    if (!svg) return; // user mid-edit may have a temporarily-invalid SVG
    this.currentUri = doc.uri;
    const filename = doc.uri.path.split('/').pop() ?? 'vector';
    this.panel.title = `Preview · ${filename}`;
    this.panel.webview.html = buildHtml(svg, filename);
  }

  dispose(): void {
    clearTimeout(this.updateTimer);
    for (const s of this.subs) s.dispose();
    this.panel?.dispose();
  }
}

function buildHtml(svg: string, filename: string): string {
  // Embed the SVG verbatim (not as an <img src>) so the rendered
  // result respects the vector's intrinsic size + crisp scaling. The
  // outer <main> centres it in the panel and a checkered background
  // makes transparency visible.
  const safeName = filename.replace(/[<>&"]/g, c =>
    ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c] as string));
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline';">
  <style>
    :root {
      color-scheme: light dark;
    }
    html, body {
      margin: 0;
      height: 100%;
    }
    body {
      display: flex;
      flex-direction: column;
      font-family: var(--vscode-font-family);
      color: var(--vscode-foreground);
      background: var(--vscode-editor-background);
    }
    header {
      padding: 8px 12px;
      border-bottom: 1px solid var(--vscode-panel-border);
      font-size: 12px;
      opacity: 0.8;
      flex: 0 0 auto;
    }
    main {
      flex: 1 1 auto;
      display: flex;
      align-items: center;
      justify-content: center;
      /* Checkered background so transparent regions in the vector are
         legible — same convention as Photoshop, Figma, Android Studio. */
      background-image:
        linear-gradient(45deg, #2a2a2a 25%, transparent 25%),
        linear-gradient(-45deg, #2a2a2a 25%, transparent 25%),
        linear-gradient(45deg, transparent 75%, #2a2a2a 75%),
        linear-gradient(-45deg, transparent 75%, #2a2a2a 75%);
      background-size: 16px 16px;
      background-position: 0 0, 0 8px, 8px -8px, -8px 0;
      background-color: #1e1e1e;
    }
    main > svg {
      max-width: 90%;
      max-height: 90%;
      width: auto;
      height: auto;
    }
  </style>
</head>
<body>
  <header>${safeName}</header>
  <main>${svg}</main>
</body>
</html>`;
}
