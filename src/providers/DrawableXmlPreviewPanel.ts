import * as vscode from 'vscode';
import { vectorXmlToSvg } from '../util/vectorToSvg';

const DRAWABLE_PATH_RE = /\/res\/drawable[^/]*\//;

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
