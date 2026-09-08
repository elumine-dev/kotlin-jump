import * as vscode from 'vscode';
import { SymbolIndex, SymbolEntry } from '../indexer/SymbolIndex';
import { SymbolKind as KtKind } from '../indexer/KotlinParser';
import { resolveBest, resolveExplicit } from '../util/ImportResolver';
import { readSignature, extractKDoc, formatKDoc, escapeAngleBrackets, locateDeclLine } from '../util/SignatureReader';
import { isInsideCommentOrString, isInsideStringInterpolation } from '../util/textUtils';
import { resolveLocalScope } from './DefinitionProvider';

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

    // Plain string / comment guard — text inside a string literal or
    // comment is NOT a code reference. Without this check, hovering
    // `Level` in `"Level $level"` would show the workspace's
    // top-level `Level` constant — wrong info, very visible.
    if (document.languageId === 'kotlin' || document.languageId === 'java') {
      const lineText  = document.lineAt(position.line).text;
      const wordStart = wordRange.start.character;
      if (isInsideCommentOrString(lineText, wordStart)) {
        const isShortInterp = wordStart >= 1 && lineText[wordStart - 1] === '$';
        const isFullInterp  = isInsideStringInterpolation(lineText, wordStart);
        if (!isShortInterp && !isFullInterp) return null;
      }
    }

    // Local-scope guard — when the word is a function parameter, local
    // val/var, for-loop binding, or lambda parameter, the workspace
    // index can only return WRONG info (a top-level symbol that
    // happens to share the name). Suppress the hover entirely rather
    // than mislead. Cmd+Click still navigates correctly to the local
    // declaration through DefinitionProvider's same logic.
    if (resolveLocalScope(document, position, word)) {
      return null;
    }

    // Prefer import-resolved entry for precision; fall back only when unambiguous
    let entry: SymbolEntry | undefined;
    const resolved = resolveBest(word, document, fqn => this.index.lookupFqn(fqn));
    if (resolved.matches.length === 1) {
      entry = resolved.matches[0];
    } else if (resolved.matches.length > 1) {
      return null; // ambiguous wildcard imports — avoid showing the wrong symbol
    }
    // A word on an import or package line is a path segment, not a symbol.
    if (/^\s*(?:import|package)\s/.test(document.lineAt(position.line).text)) return null;
    // `import com.example.util.format` names a target the index does not hold
    // (a library without sources): a same-named symbol elsewhere is not it.
    if (!entry && resolveExplicit(word, document).exact.length > 0) return null;
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

    // The index follows the file on disk: while the declaring document is
    // dirty, entry.line can point at the neighbour's KDoc. readSignature
    // relocates the declaration; the KDoc must follow it.
    const kDoc = declDoc ? extractKDoc(declDoc, locateDeclLine(declDoc, entry)) : null;
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
          if (baseDoc) resolvedKDoc = extractKDoc(baseDoc, locateDeclLine(baseDoc, baseEntry));
        }
      }
    }

    // ── Signature block ───────────────────────────────────────────────────────
    const sigMd = new vscode.MarkdownString();
    // The signature already carries the annotation when it sits on the fun line.
    sigMd.appendCodeblock(entry.isComposable && !/@Composable\b/.test(sig) ? `@Composable\n${sig}` : sig, 'kotlin');

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
      docMd.appendMarkdown(escapeAngleBrackets(resolvedKDoc));
      sections.push(docMd);
    }

    // ── Variants for sealed classes and enum entries ──────────────────────────
    if (entry.kind === 'sealedClass' || entry.kind === 'enum') {
      const fileSymbols = this.index.getFileSymbols(entry.uri.toString());
      // Subtypes live anywhere in the package (top level, other files), not
      // only nested in the body: `data class Err : Result()` after the class
      // and every `sealed interface` implementation were missing.
      const impls = entry.kind === 'sealedClass'
        ? this.index.lookupImplementations(entry.name).filter(e =>
          e.packageName === entry!.packageName && !e.isCompanion && !e.name.startsWith('$')
          && e.supertypes?.includes(entry!.name) && SEALED_CHILD_KINDS.has(e.kind))
        : [];
      const variantsMd  = buildVariantsSection(entry, fileSymbols, declDoc, impls);
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
  impls: readonly SymbolEntry[] = [],
): vscode.MarkdownString | null {
  const isEnum   = parent.kind === 'enum';
  const children: SymbolEntry[] = [];
  const seen = new Set<string>();

  // Collect direct children: symbols after the parent line at depth+1
  let seenParent = false;
  for (const e of fileSymbols) {
    if (!seenParent) {
      if (e.line === parent.line && e.name === parent.name) seenParent = true;
      continue;
    }
    if (e.depth <= parent.depth) break; // left the parent's body
    if (e.depth !== parent.depth + 1)  continue; // skip deeply nested
    if (e.isCompanion) continue; // a sealed class's companion is not a subtype
    if (isEnum  && e.kind === ENUM_ENTRY_KIND)    { children.push(e); seen.add(e.fqn); }
    if (!isEnum && SEALED_CHILD_KINDS.has(e.kind)) { children.push(e); seen.add(e.fqn); }
  }
  for (const e of impls) {
    if (seen.has(e.fqn)) continue;
    seen.add(e.fqn);
    children.push(e);
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
