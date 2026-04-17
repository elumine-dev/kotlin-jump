import * as vscode from 'vscode';
import { SymbolIndex, SymbolEntry } from '../indexer/SymbolIndex';
import { SymbolKind as KtKind } from '../indexer/KotlinParser';
import { resolveBest } from '../util/ImportResolver';
import { readSignature, extractKDoc, formatKDoc } from '../util/SignatureReader';

const WORD_RE = /[A-Za-z_]\w*/;

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
      if (hits.length === 1) {
        entry = hits[0];
      } else if (hits.length > 1) {
        const inFile = hits.filter(h => h.uri.toString() === document.uri.toString());
        if (inFile.length === 1) {
          entry = inFile[0];
        } else if (inFile.length > 1) {
          // Multiple overrides in same file (e.g. 3 impls of `execute` in AbstractClassDemo.kt)
          // — tiebreak by exact line so we show the symbol the cursor is actually on.
          const atLine = inFile.filter(h => h.line === position.line);
          if (atLine.length === 1) entry = atLine[0];
          else return null;
        } else {
          return null;
        }
      }
    }
    if (!entry) return null;

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

    // ── KDoc resolution for override methods ─────────────────────────────────
    // Rule: at the declaration site in the impl file, own KDoc is already visible
    // inline — suppressing it avoids showing it twice. Show inherited KDoc only
    // when the override has no KDoc of its own.
    let resolvedKDoc = kDoc;
    if (entry.isOverride && (entry.kind === 'fun' || entry.kind === 'composable')) {
      const isAtOwnDeclaration =
        position.line === entry.line &&
        entry.uri.toString() === document.uri.toString();

      if (kDoc && isAtOwnDeclaration) {
        resolvedKDoc = null; // already visible above the function — suppress
      } else if (!kDoc) {
        const baseEntry = this.index.findBaseMethod(entry);
        if (baseEntry) {
          let baseDoc: vscode.TextDocument | null = null;
          try { baseDoc = await vscode.workspace.openTextDocument(baseEntry.uri); } catch { /* non-fatal */ }
          if (baseDoc) resolvedKDoc = extractKDoc(baseDoc, baseEntry.line);
        }
      }
    }

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
    if (resolvedKDoc) {
      const docMd = new vscode.MarkdownString();
      docMd.appendMarkdown(resolvedKDoc);
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
