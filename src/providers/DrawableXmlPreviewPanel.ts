import * as vscode from 'vscode';
import { vectorXmlToSvg } from '../util/vectorToSvg';
import { SymbolIndex } from '../indexer/SymbolIndex';
import { scanForUsagesWithTarget, isExcluded } from './FindUsagesEngine';

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
export class DrawableXmlPreviewLensProvider implements vscode.CodeLensProvider {
  constructor(private readonly index: SymbolIndex) {}

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
    const locations = await this.findDrawableUsages(name, token);

    lens.command = {
      title: locations.length === 0 ? 'No references'
           : locations.length === 1 ? '1 reference'
           : `${locations.length} references`,
      command: 'editor.action.showReferences',
      // showReferences signature: (uri, position, locations).
      // We anchor the peek at the start of the file so VS Code's "no
      // results" message attributes correctly when the count is 0.
      arguments: [docUri, new vscode.Position(0, 0), locations],
      tooltip: 'Show every R.drawable usage of this resource workspace-wide.',
    };
    return lens;
  }

  /**
   * Find every `R.drawable.<name>` reference. We pre-narrow file
   * candidates via the inverted word index (the symbol name appears in
   * code somewhere), then post-filter so unrelated `<name>` tokens
   * (e.g. an identically-named property) don't pollute the count.
   */
  private async findDrawableUsages(
    name: string,
    token: vscode.CancellationToken,
  ): Promise<vscode.Location[]> {
    if (this.index.lookup(name).length === 0
        && !this.index.getFilesContainingWord(name)) {
      // No file even mentions the word — the workspace genuinely has
      // zero usages. Avoids a no-op full scan.
      // (lookup() handles symbols, word index handles raw textual hits.)
    }
    const uriStrings = this.index.fileUriStrings().filter(u => !isExcluded(u));
    const raw = await scanForUsagesWithTarget(name, undefined, this.index, uriStrings, token);
    if (token.isCancellationRequested) return [];

    // Keep only the matches preceded by `R.drawable.` (or `R.mipmap.`,
    // since Android lets you reference drawables from mipmaps too).
    const out: vscode.Location[] = [];
    for (const r of raw) {
      const before = r.lineText.slice(Math.max(0, r.character - 11), r.character);
      if (before === 'R.drawable.' || before === 'R.mipmap.') {
        // Only "R.mipmap." is 10 chars — re-check.
      }
      // Cleaner check: regex on the slice ending exactly at r.character.
      const head = r.lineText.slice(0, r.character);
      if (/\bR\.(?:drawable|mipmap)\.$/.test(head)) {
        out.push(new vscode.Location(r.uri, new vscode.Position(r.line, r.character)));
      }
    }
    return out;
  }
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

  /** Manual command target — re-opens the panel after the user dismissed it. */
  show(): void {
    this.dismissed = false;
    this.evaluate(/* force= */ true);
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
