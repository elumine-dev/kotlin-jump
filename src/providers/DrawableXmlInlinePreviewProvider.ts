import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { vectorXmlToSvg } from '../util/vectorToSvg';

const DRAWABLE_PATH_RE = /\/res\/drawable[^/]*\//;
const VECTOR_OPEN_RE   = /<vector\b/;

/**
 * Always-visible inline preview for Android <vector> drawables. When a
 * drawable XML containing a <vector> is open in the editor, a small
 * rendered thumbnail appears in the gutter beside the <vector> line,
 * no hover required. Hover the same line for a 256×256 popup variant,
 * DrawableXmlHoverProvider.ts (a separate class, not this one).
 *
 * Converts the XML to SVG via the workspace's existing `vectorXmlToSvg`
 * helper (also used by the R.drawable gutter thumbnails and hover) so
 * the rendering is identical across every surface. Non-vector
 * drawables (selectors, shapes, layer-list…) silently decline.
 *
 * Desktop-only: the gutter icon needs `gutterIconPath` to point at an
 * on-disk file (VS Code does not accept a data: URI there), so this keeps
 * a `node:fs` disk cache under `context.globalStorageUri`. The hover-only
 * half needed no such cache (a data: URI is enough for a hover popup) and
 * was split out specifically so it could register on the web too.
 */
export class DrawableXmlInlinePreviewProvider implements vscode.Disposable {
  private readonly cacheDir: string;
  // One decoration type per cached SVG file — VS Code requires the
  // gutter icon to be baked into the type, not into the per-line
  // decoration option. Reusing the same type across lines is cheap;
  // creating one per line would not be.
  private readonly typeByCachePath = new Map<string, vscode.TextEditorDecorationType>();
  private readonly subs: vscode.Disposable[] = [];
  private flushTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(storageUri: vscode.Uri) {
    this.cacheDir = path.join(storageUri.fsPath, 'vector-xml-preview');
    fs.mkdirSync(this.cacheDir, { recursive: true });

    this.subs.push(
      vscode.window.onDidChangeActiveTextEditor(() => this.scheduleFlush()),
      vscode.window.onDidChangeVisibleTextEditors(() => this.scheduleFlush()),
      vscode.workspace.onDidChangeTextDocument(e => {
        if (vscode.window.visibleTextEditors.some(ed => ed.document === e.document)) {
          this.scheduleFlush();
        }
      }),
    );

    this.flush();
  }

  // ── Always-visible gutter icon ───────────────────────────────────────
  // (Hover popup variant lives in DrawableXmlHoverProvider.ts.)
  private scheduleFlush(): void {
    clearTimeout(this.flushTimer);
    this.flushTimer = setTimeout(() => this.flush(), 80);
  }

  private async flush(): Promise<void> {
    for (const editor of vscode.window.visibleTextEditors) {
      const doc = editor.document;
      if (doc.languageId !== 'xml' || !DRAWABLE_PATH_RE.test(doc.uri.path)) {
        // Clear any stale decorations on this editor.
        for (const type of this.typeByCachePath.values()) editor.setDecorations(type, []);
        continue;
      }
      await this.applyForEditor(editor);
    }
  }

  private async applyForEditor(editor: vscode.TextEditor): Promise<void> {
    const doc = editor.document;
    const text = doc.getText();
    const vectorMatch = VECTOR_OPEN_RE.exec(text);
    if (!vectorMatch) return;

    const svg = vectorXmlToSvg(text);
    if (!svg) {
      // Drawable XML but not a vector — clear any prior decoration on
      // this editor so a stale icon doesn't survive an edit that
      // converted a vector into another drawable type.
      for (const type of this.typeByCachePath.values()) editor.setDecorations(type, []);
      return;
    }

    const cachePath = this.cachePathFor(doc.uri, svg);
    const type = this.decorationTypeFor(cachePath);

    const startPos = doc.positionAt(vectorMatch.index);
    const endPos   = doc.positionAt(vectorMatch.index + vectorMatch[0].length);

    // Apply only to THIS type for this editor; clear others so a file
    // that previously rendered a different SVG doesn't keep its old
    // gutter icon alongside the new one.
    for (const [otherCache, otherType] of this.typeByCachePath) {
      if (otherCache === cachePath) continue;
      editor.setDecorations(otherType, []);
    }
    editor.setDecorations(type, [{ range: new vscode.Range(startPos, endPos) }]);
  }

  private cachePathFor(uri: vscode.Uri, svg: string): string {
    // Hash the content so an edit that changes the SVG bytes lands on
    // a fresh cache entry — the gutter icon updates automatically as
    // the user types.
    const h = crypto.createHash('sha1').update(uri.path).update('\0').update(svg).digest('hex').slice(0, 16);
    const p = path.join(this.cacheDir, `${h}.svg`);
    if (!fs.existsSync(p)) {
      try { fs.writeFileSync(p, svg); } catch { /* ignore — flush() will retry */ }
    }
    return p;
  }

  private decorationTypeFor(cachePath: string): vscode.TextEditorDecorationType {
    let type = this.typeByCachePath.get(cachePath);
    if (type) return type;
    type = vscode.window.createTextEditorDecorationType({
      gutterIconPath: vscode.Uri.file(cachePath),
      gutterIconSize: 'contain',
    });
    this.typeByCachePath.set(cachePath, type);
    return type;
  }

  dispose(): void {
    clearTimeout(this.flushTimer);
    for (const t of this.typeByCachePath.values()) t.dispose();
    this.typeByCachePath.clear();
    for (const s of this.subs) s.dispose();
  }
}
