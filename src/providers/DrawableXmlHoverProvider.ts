import * as vscode from 'vscode';
import { vectorXmlToSvg } from '../util/vectorToSvg';
import { utf8ToBase64 } from '../util/encoding';

const DRAWABLE_PATH_RE = /\/res\/drawable[^/]*\//;
const VECTOR_OPEN_RE   = /<vector\b/;

/**
 * Hover-triggered 256x256 preview for Android <vector> drawables, split out
 * of DrawableXmlInlinePreviewProvider so this half (zero Node dependencies)
 * can register on the web. The other half (an always-visible gutter icon,
 * DrawableXmlInlinePreviewProvider.ts) needs a disk cache keyed by a hash of
 * the SVG content and is desktop-only; see that file's header comment.
 *
 * Builds a data: URI from the SVG directly (same approach already used by
 * DrawableHoverProvider.ts for R.drawable.* hovers, already web-enabled).
 * No gutter icon here, so none of the "gutterIconPath requires an on-disk
 * file" constraints that block the other half apply.
 */
export class DrawableXmlHoverProvider implements vscode.HoverProvider {
  provideHover(
    document: vscode.TextDocument,
    position: vscode.Position,
  ): vscode.Hover | undefined {
    if (document.languageId !== 'xml') return;
    if (!DRAWABLE_PATH_RE.test(document.uri.path)) return;

    const text = document.getText();
    const vectorMatch = VECTOR_OPEN_RE.exec(text);
    if (!vectorMatch) return;
    const vectorLine = document.positionAt(vectorMatch.index).line;
    if (position.line !== vectorLine) return;

    const svg = vectorXmlToSvg(text);
    if (!svg) return;

    const dataUri = `data:image/svg+xml;base64,${utf8ToBase64(svg)}`;
    const md = new vscode.MarkdownString();
    md.supportHtml = true;
    md.isTrusted = false;
    md.appendMarkdown(`<img src="${dataUri}" width="256" height="256" alt="vector preview" />\n\n`);
    md.appendMarkdown(`*${document.uri.path.split('/').pop()}*`);

    const start = document.positionAt(vectorMatch.index);
    const end = document.positionAt(vectorMatch.index + vectorMatch[0].length);
    return new vscode.Hover(md, new vscode.Range(start, end));
  }
}
