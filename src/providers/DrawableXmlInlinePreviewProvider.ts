import * as vscode from 'vscode';
import { vectorXmlToSvg } from '../util/vectorToSvg';

/**
 * Hover provider for Android <vector> drawables. Hovering the
 * <vector> opening tag in any res/drawable*\/*.xml pops up a 256×256
 * rendered preview beside the cursor.
 *
 * The XML is converted to SVG via the workspace's existing
 * `vectorXmlToSvg` helper (also used by the gutter thumbnail and
 * R.drawable hover providers, so identical rendering across surfaces).
 * Non-vector XML drawables (selectors, shapes, layer-list, …) silently
 * decline to render — there's no faithful raster conversion path for
 * those, and a "drawable type:" line on hover would compete with
 * VS Code's native XML hovers.
 */
export class DrawableXmlInlinePreviewProvider implements vscode.HoverProvider {
  provideHover(
    document: vscode.TextDocument,
    position: vscode.Position,
  ): vscode.Hover | undefined {
    if (document.languageId !== 'xml') return;

    // Cheap path filter: only fire inside `res/drawable*/`. Saves the
    // full-document parse on unrelated XMLs (build files, manifests…).
    if (!/\/res\/drawable[^/]*\//.test(document.uri.path)) return;

    const text = document.getText();
    // Locate the `<vector` opening tag. If the cursor isn't on its
    // line, defer to other hovers — keeps mid-document attribute hovers
    // (VS Code's built-in colour picker on `android:fillColor=` etc.)
    // unaffected.
    const vectorMatch = /<vector\b/.exec(text);
    if (!vectorMatch) return;
    const vectorLine = document.positionAt(vectorMatch.index).line;
    if (position.line !== vectorLine) return;

    const svg = vectorXmlToSvg(text);
    if (!svg) return;

    const dataUri = `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
    const md = new vscode.MarkdownString();
    md.supportHtml = true;
    md.isTrusted = false;
    md.appendMarkdown(`<img src="${dataUri}" width="256" height="256" alt="vector preview" />\n\n`);
    md.appendMarkdown(`*${document.uri.path.split('/').pop()}*`);

    // Anchor the hover at the `<vector>` token range so VS Code highlights
    // it on hover — same affordance the user sees on `R.drawable.x`.
    const start = document.positionAt(vectorMatch.index);
    const end = document.positionAt(vectorMatch.index + vectorMatch[0].length);
    return new vscode.Hover(md, new vscode.Range(start, end));
  }
}
