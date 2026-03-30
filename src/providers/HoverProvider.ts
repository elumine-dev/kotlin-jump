import * as vscode from 'vscode';
import { SymbolIndex, SymbolEntry } from '../indexer/SymbolIndex';
import { SymbolKind as KtKind } from '../indexer/KotlinParser';
import { resolveBest } from '../util/ImportResolver';

const WORD_RE = /[A-Za-z_]\w*/;
const MAX_SIG_LINES     = 12;
const MAX_DISPLAY_LINES = 8;

export class KotlinHoverProvider implements vscode.HoverProvider {
  constructor(private readonly index: SymbolIndex) {}

  async provideHover(
    document: vscode.TextDocument,
    position: vscode.Position,
    token: vscode.CancellationToken,
  ): Promise<vscode.Hover | null> {
    const wordRange = document.getWordRangeAtPosition(position, WORD_RE);
    if (!wordRange) return null;

    const word = document.getText(wordRange);
    if (word.length < 2) return null;

    // Prefer import-resolved entry for precision; fall back only when unambiguous
    let entry: SymbolEntry | undefined;
    const resolved = resolveBest(word, document, fqn => this.index.lookupFqn(fqn));
    if (resolved.matches.length === 1) {
      entry = resolved.matches[0];
    } else if (resolved.matches.length > 1) {
      return null; // ambiguous wildcard imports — avoid showing the wrong symbol
    }
    if (!entry) {
      const hits = this.index.lookup(word);
      if (hits.length !== 1) return null;
      entry = hits[0];
    }

    if (token.isCancellationRequested) return null;

    // Open declaration document once — reused for both KDoc and signature
    let declDoc: vscode.TextDocument | null = null;
    try { declDoc = await vscode.workspace.openTextDocument(entry.uri); }
    catch { /* non-fatal — fallback signatures used below */ }

    if (token.isCancellationRequested) return null;

    const kDoc = declDoc ? extractKDoc(declDoc, entry.line) : null;
    const sig  = declDoc
      ? (readSignature(declDoc, entry) ?? fallbackSig(entry))
      : fallbackSig(entry);

    // ── Signature block ───────────────────────────────────────────────────────
    const sigMd = new vscode.MarkdownString();
    sigMd.appendCodeblock(entry.isComposable ? `@Composable\n${sig}` : sig, 'kotlin');

    // ── Package + file + module ───────────────────────────────────────────────
    const fileName = entry.uri.path.split('/').pop() ?? '';
    const metaMd = new vscode.MarkdownString();
    metaMd.appendMarkdown(`*${entry.packageName || '(default package)'}*`);
    metaMd.appendMarkdown(`\n\n\`${fileName}\``);
    if (entry.moduleName) metaMd.appendMarkdown(` — \`${entry.moduleName}\``);

    const sections: vscode.MarkdownString[] = [sigMd, metaMd];

    // ── KDoc comment (shown below another divider) ────────────────────────────
    if (kDoc) {
      const docMd = new vscode.MarkdownString();
      docMd.appendMarkdown(kDoc);
      sections.push(docMd);
    }

    // ── Variants for sealed classes and enum entries ──────────────────────────
    if (entry.kind === 'sealedClass' || entry.kind === 'enum') {
      const fileSymbols = this.index.getFileSymbols(entry.uri.toString());
      const variantsMd  = buildVariantsSection(entry, fileSymbols, declDoc);
      if (variantsMd) sections.push(variantsMd);
    }

    return new vscode.Hover(sections, wordRange);
  }
}

// ── Signature extraction ──────────────────────────────────────────────────────
// Reads the actual source lines from the declaration file.
// Stops at `{` (body start) or `=` for functions/composables only.
// Handles multi-line parameter lists by tracking paren depth.

function readSignature(doc: vscode.TextDocument, entry: SymbolEntry): string | null {
  // For fun/composable, `=` also marks an expression body → cut there too
  const cutAtEquals = entry.kind === 'fun' || entry.kind === 'composable';

  const lines: string[] = [];
  let parenDepth = 0;

  for (
    let i = entry.line;
    i < Math.min(entry.line + MAX_SIG_LINES, doc.lineCount);
    i++
  ) {
    const text = doc.lineAt(i).text;
    let cutAt = -1;

    for (let j = 0; j < text.length; j++) {
      const ch = text[j];
      if      (ch === '(') parenDepth++;
      else if (ch === ')') parenDepth--;
      else if (ch === '{' && parenDepth === 0) { cutAt = j; break; }
      else if (ch === '=' && parenDepth === 0 && cutAtEquals) { cutAt = j; break; }
    }

    if (cutAt !== -1) {
      const part = text.slice(0, cutAt).trimEnd();
      if (part.trim()) lines.push(part);
      break;
    }

    lines.push(text.trimEnd());

    // Stop as soon as parens are balanced — signature is complete
    if (parenDepth === 0) break;
  }

  if (lines.length === 0) return null;

  // Strip common leading indentation
  const minIndent = lines
    .filter(l => l.trim().length > 0)
    .reduce((min, l) => Math.min(min, l.length - l.trimStart().length), Infinity);
  const normalized = lines.map(l => l.slice(isFinite(minIndent) ? minIndent : 0));

  // Strip trailing comma/semicolon (enum entries: `FLASH_AND_GLOW,`)
  if (normalized.length === 1) {
    normalized[0] = normalized[0].replace(/[,;]\s*$/, '');
  }

  // Truncate very long signatures (e.g. data classes with 20 fields)
  if (normalized.length > MAX_DISPLAY_LINES) {
    return [
      ...normalized.slice(0, MAX_DISPLAY_LINES),
      '    // ...',
    ].join('\n');
  }

  return normalized.join('\n') || null;
}

// ── KDoc extraction ───────────────────────────────────────────────────────────
// Walks backward from the declaration line, skipping annotations and blank
// lines, then extracts and formats a /** ... */ or // comment block.

function extractKDoc(doc: vscode.TextDocument, declarationLine: number): string | null {
  // Skip annotations (@Composable, @Override, etc.) and blank lines above the declaration
  let line = declarationLine - 1;
  while (line >= 0) {
    const t = doc.lineAt(line).text.trim();
    if (t === '' || t.startsWith('@')) { line--; continue; }
    break;
  }
  if (line < 0) return null;

  const lastLine = doc.lineAt(line).text.trim();

  // ── Block KDoc: /** ... */ ────────────────────────────────────────────────
  if (lastLine.endsWith('*/')) {
    // Single-line: /** This is a comment. */
    const single = /\/\*\*\s*(.*?)\s*\*\//.exec(lastLine);
    if (single) return formatKDoc([single[1]]);

    // Multi-line: scan backward to find /**
    const rawLines: string[] = [];
    for (let i = line; i >= Math.max(0, line - 60); i--) {
      rawLines.unshift(doc.lineAt(i).text);
      if (doc.lineAt(i).text.trim().startsWith('/**')) break;
    }
    if (!rawLines[0].trim().startsWith('/**')) return null;

    const content = rawLines.map((l, idx) => {
      const t = l.trim();
      if (idx === 0) return t.replace(/^\/\*\*\s?/, '');
      if (t === '*/') return null;
      return t.replace(/^\*\s?/, '');
    }).filter((l): l is string => l !== null);

    return formatKDoc(content);
  }

  // ── Line comment block: consecutive // lines ──────────────────────────────
  if (lastLine.startsWith('//')) {
    const rawLines: string[] = [];
    for (let i = line; i >= Math.max(0, line - 20); i--) {
      const t = doc.lineAt(i).text.trim();
      if (!t.startsWith('//')) break;
      rawLines.unshift(t.replace(/^\/\/\s?/, ''));
    }
    return rawLines.length > 0 ? rawLines.join('\n') : null;
  }

  return null;
}

// Converts raw KDoc lines to a Markdown string, formatting @tags.
function formatKDoc(lines: string[]): string | null {
  if (lines.length === 0) return null;

  const result: string[] = [];
  let inParam = false;

  for (const line of lines) {
    if (!line.trim()) {
      result.push('');
      inParam = false;
      continue;
    }

    // @param name description
    const param = /^@param\s+(\w+)\s*(.*)/.exec(line);
    if (param) {
      if (!inParam) { result.push(''); inParam = true; }
      result.push(`- \`${param[1]}\` — ${param[2]}`);
      continue;
    }

    // @return / @returns
    const ret = /^@returns?\s+(.+)/.exec(line);
    if (ret) { result.push(`\n**Returns:** ${ret[1]}`); inParam = false; continue; }

    // @throws / @exception
    const thr = /^@(?:throws|exception)\s+(\w+)\s*(.*)/.exec(line);
    if (thr) { result.push(`\n**Throws** \`${thr[1]}\`${thr[2] ? ': ' + thr[2] : ''}`); inParam = false; continue; }

    // @see
    const see = /^@see\s+(.+)/.exec(line);
    if (see) { result.push(`\n**See:** ${see[1]}`); inParam = false; continue; }

    // @deprecated
    const dep = /^@deprecated\s*(.*)/.exec(line);
    if (dep) { result.push(`\n> ⚠️ **Deprecated.** ${dep[1]}`); inParam = false; continue; }

    // @since
    const since = /^@since\s+(.+)/.exec(line);
    if (since) { result.push(`\n**Since:** ${since[1]}`); inParam = false; continue; }

    // Unknown tag — skip
    if (line.startsWith('@')) continue;

    result.push(line);
    inParam = false;
  }

  const formatted = result.join('\n').trim();
  return formatted || null;
}

// ── Variants section (sealed class subtypes / enum entries) ──────────────────

const SEALED_CHILD_KINDS = new Set<KtKind>(['class','dataClass','object','sealedClass','interface','annotation']);
const ENUM_ENTRY_KIND:   KtKind = 'enum';

const KIND_LABEL: Record<KtKind, string> = {
  class: 'class', interface: 'interface', object: 'object',
  enum: 'enum class', dataClass: 'data class', sealedClass: 'sealed class',
  annotation: 'annotation class', fun: 'fun', composable: 'fun',
  val: 'val', var: 'var', typealias: 'typealias',
};

function buildVariantsSection(
  parent: SymbolEntry,
  fileSymbols: SymbolEntry[],
  doc: vscode.TextDocument | null,
): vscode.MarkdownString | null {
  const isEnum   = parent.kind === 'enum';
  const children: SymbolEntry[] = [];

  // Collect direct children: symbols after the parent line at depth+1
  let seenParent = false;
  for (const e of fileSymbols) {
    if (!seenParent) {
      if (e.line === parent.line && e.name === parent.name) seenParent = true;
      continue;
    }
    if (e.depth <= parent.depth) break; // left the parent's body
    if (e.depth !== parent.depth + 1)  continue; // skip deeply nested
    if (isEnum  && e.kind === ENUM_ENTRY_KIND)    children.push(e);
    if (!isEnum && SEALED_CHILD_KINDS.has(e.kind)) children.push(e);
  }

  if (children.length === 0) return null;

  const md = new vscode.MarkdownString();
  const heading = isEnum ? '**Entries**' : '**Subtypes**';
  md.appendMarkdown(`${heading} *(${children.length})*\n\n`);

  for (const child of children) {
    if (isEnum) {
      md.appendMarkdown(`- \`${child.name}\`\n`);
    } else {
      const kindStr = KIND_LABEL[child.kind] ?? child.kind;
      md.appendMarkdown(`- \`${child.name}\` *${kindStr}*\n`);
    }
  }

  return md;
}


function fallbackSig(entry: SymbolEntry): string {
  const labels: Record<KtKind, string> = {
    class: 'class', interface: 'interface', object: 'object',
    enum: 'enum class', dataClass: 'data class', sealedClass: 'sealed class',
    annotation: 'annotation class', fun: 'fun', composable: 'fun',
    val: 'val', var: 'var', typealias: 'typealias',
  };
  return `${labels[entry.kind]} ${entry.name}`;
}
