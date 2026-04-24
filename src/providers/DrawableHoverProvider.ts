import * as vscode from 'vscode';
import { DrawableResourceIndex, DrawableVariant } from '../indexer/DrawableResourceIndex';
import { vectorXmlToSvg } from '../util/vectorToSvg';

const R_DRAWABLE_RE = /\bR\.(drawable|mipmap)\.([A-Za-z_]\w*)\b/g;

// Cap the file size we'll embed in a hover tooltip. Anything bigger
// degrades to a file-info hover (path + size + variants) without the
// inline preview, so the extension stays snappy on unexpectedly large
// raster assets.
const MAX_EMBED_BYTES = 256 * 1024;

const MIME_BY_EXT: Record<string, string> = {
  png:  'image/png',
  webp: 'image/webp',
  jpg:  'image/jpeg',
  jpeg: 'image/jpeg',
  svg:  'image/svg+xml',
  gif:  'image/gif',
  bmp:  'image/bmp',
};

export class DrawableHoverProvider implements vscode.HoverProvider {
  constructor(private readonly index: DrawableResourceIndex) {}

  async provideHover(
    document: vscode.TextDocument,
    position: vscode.Position,
  ): Promise<vscode.Hover | undefined> {
    if (document.languageId !== 'kotlin' && document.languageId !== 'java') return;

    const lineText = document.lineAt(position.line).text;
    R_DRAWABLE_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = R_DRAWABLE_RE.exec(lineText))) {
      const start = m.index;
      const end   = start + m[0].length;
      if (position.character < start || position.character >= end) continue;

      const kind = m[1]; // drawable | mipmap
      const key  = m[2];
      const entry = this.index.get(key);
      if (!entry) return;

      const pick = pickPreviewVariant(entry.variants);
      const md   = new vscode.MarkdownString();
      md.supportHtml = true;
      md.isTrusted   = true;

      await appendPreview(md, pick);
      appendHeader(md, kind, key, pick);
      appendVariantList(md, entry.variants);

      return new vscode.Hover(md, new vscode.Range(position.line, start, position.line, end));
    }
    return undefined;
  }
}

/** Prefer vector XML (scales cleanly), then default-density raster. */
function pickPreviewVariant(variants: readonly DrawableVariant[]): DrawableVariant {
  return (
    variants.find(v => v.ext === 'xml') ??
    variants.find(v => v.qualifier === 'drawable' || v.qualifier === 'mipmap') ??
    variants[0]
  );
}

async function appendPreview(md: vscode.MarkdownString, v: DrawableVariant): Promise<void> {
  try {
    const bytes = await vscode.workspace.fs.readFile(v.uri as vscode.Uri);
    if (bytes.byteLength > MAX_EMBED_BYTES && v.ext !== 'xml') {
      // Too big — file-info only. Caller still gets path + size afterwards.
      return;
    }

    if (v.ext === 'xml') {
      const xml = new TextDecoder().decode(bytes);
      const svg = vectorXmlToSvg(xml);
      if (svg) {
        const dataUri = `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
        const alt = escapeHtmlAttr(v.uri.path.split('/').pop() ?? 'vector');
        md.appendMarkdown(`<img src="${dataUri}" width="128" height="128" alt="${alt}" />\n\n`);
        return;
      }
      // Non-vector XML (selector, shape, layer-list, ripple, …) — we can't
      // render it as an image, but we can name its root element so the dev
      // isn't confused about why there's no thumbnail.
      const root = detectXmlRoot(xml);
      if (root) md.appendMarkdown(`*drawable type:* \`<${root}>\`\n\n`);
      return;
    }

    if (v.ext === 'svg') {
      const dataUri = `data:image/svg+xml;base64,${Buffer.from(bytes).toString('base64')}`;
      md.appendMarkdown(`<img src="${dataUri}" width="128" height="128" alt="svg" />\n\n`);
      return;
    }

    const mime    = MIME_BY_EXT[v.ext] ?? 'image/png';
    const dataUri = `data:${mime};base64,${Buffer.from(bytes).toString('base64')}`;
    const ninePatchNote = v.isNinePatch ? ' *(9-patch)*' : '';
    md.appendMarkdown(`<img src="${dataUri}" width="128" alt="${escapeHtmlAttr(v.ext)}" />${ninePatchNote}\n\n`);
  } catch {
    /* file unreadable — fall through to file-info only */
  }
}

function detectXmlRoot(xml: string): string | undefined {
  const m = /<([a-zA-Z][\w-]*)\b/.exec(xml.replace(/<\?xml[^?]*\?>/g, '').trim());
  return m?.[1];
}

// Escape for use inside a double-quoted HTML attribute. Critical because
// `MarkdownString.isTrusted=true` + `supportHtml=true` allows `command:`
// URIs — a malicious filename containing `"><a href="command:…">` would
// reach a trusted surface. Filenames come from disk, never trust them.
function escapeHtmlAttr(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function appendHeader(
  md: vscode.MarkdownString,
  kind: string,
  key: string,
  pick: DrawableVariant,
): void {
  const uriStr  = pick.uri.toString();
  const resIdx  = uriStr.lastIndexOf('/res/');
  const display = resIdx >= 0 ? uriStr.slice(resIdx + 1) : uriStr.split('/').slice(-2).join('/');
  md.appendMarkdown(`**R.${kind}.${key}** — \`${display}\`\n`);
}

function appendVariantList(
  md: vscode.MarkdownString,
  variants: readonly DrawableVariant[],
): void {
  if (variants.length <= 1) return;
  const qualifiers = variants
    .map(v => `${v.qualifier}/${v.ext}`)
    .filter((q, i, arr) => arr.indexOf(q) === i);
  md.appendMarkdown(`\n*Variants:* ${qualifiers.join(' · ')}`);
}
