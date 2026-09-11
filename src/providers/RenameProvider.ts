import * as vscode from 'vscode';
import { SymbolIndex, SymbolEntry } from '../indexer/SymbolIndex';
import { scanForUsages, scanImports, UsageResult, isExcluded, resolveSearchTarget } from './FindUsagesEngine';
import { resolveLocalScope, findLocalUsages, cachedLocalScopeIndex } from './DefinitionProvider';
import { isInsideCommentOrString, isInsideStringInterpolation } from '../util/textUtils';
import { FUN_RE, signatureEnd } from '../util/LocalScopeIndex';
import { ACCENT, nomAccentueComposite } from '../util/backtickName';

const WORD_RE = /[A-Za-z_]\w*/;

// ── Metadata constants ────────────────────────────────────────────────────────

const META_OCCURRENCES: vscode.WorkspaceEditEntryMetadata = {
  needsConfirmation: false,
  label: 'Rename occurrences',
};

const META_IMPORTS: vscode.WorkspaceEditEntryMetadata = {
  needsConfirmation: false,
  label: 'Update imports',
};

function metaFile(oldName: string, newName: string, ext = '.kt'): vscode.WorkspaceEditEntryMetadata {
  return {
    needsConfirmation: true,
    label: 'Rename file',
    description: `${oldName}${ext} → ${newName}${ext}`,
  };
}

// ── File-rename eligibility ───────────────────────────────────────────────────

const FILE_RENAME_KINDS = new Set<string>([
  'class', 'interface', 'object', 'enum',
  'dataClass', 'sealedClass', 'annotation',
]);

export function computeFileRename(
  entry: SymbolEntry,
  newName: string,
  index: SymbolIndex,
): vscode.Uri | null {
  if (entry.depth !== 0) return null;
  if (!FILE_RENAME_KINDS.has(entry.kind)) return null;

  const uriStr   = entry.uri.toString();
  const slashIdx = uriStr.lastIndexOf('/');
  const filename  = uriStr.slice(slashIdx + 1);
  // Java has the same one-public-type-per-file rule as Kotlin, so the
  // companion rename generalises: keep whichever extension the file carries.
  const ext = filename.endsWith('.kt') ? '.kt' : filename.endsWith('.java') ? '.java' : null;
  if (ext === null) return null;
  if (filename.slice(0, -ext.length) !== entry.name) return null;

  const newUriStr = uriStr.slice(0, slashIdx + 1) + newName + ext;
  if (index.fileUriStrings().includes(newUriStr)) return null; // clash guard

  return vscode.Uri.parse(newUriStr);
}

// ── Provider ──────────────────────────────────────────────────────────────────

/**
 * Name of the function whose parameter list declares the binding at
 * `declPos`, or null when the binding is a local of a body, a lambda
 * parameter or a for-loop variable.
 */
function parameterOwner(document: vscode.TextDocument, declPos: vscode.Position, word: string): string | null {
  const scope = cachedLocalScopeIndex(document);
  if (declPos.line >= scope.enclosingFun.length) return null;
  const funLine = scope.enclosingFun[declPos.line];
  if (funLine < 0 || declPos.line > signatureEnd(scope, funLine)) return null;
  const header = scope.lines[funLine];
  const m = FUN_RE.exec(header);
  if (!m || m[1] === word) return null;
  // On the header line the binding must sit inside the parentheses, not be
  // the function name or the receiver.
  if (declPos.line === funLine && declPos.character < header.indexOf('(', m.index)) return null;
  // `{ v -> ` on the header line is a lambda default, not a parameter.
  const before = scope.lines.slice(funLine, declPos.line + 1).join('\n');
  const upTo = before.length - (scope.lines[declPos.line].length - declPos.character);
  if (/\{[^}]*$/.test(before.slice(0, upTo))) return null;
  return m[1];
}

/**
 * Ranges of `param =` labels inside calls of `funName`: the live document
 * first, then the workspace when the index knows exactly one function of
 * that name (another `Screen` elsewhere would have its own `title`).
 */
async function namedArgLabelRanges(
  document: vscode.TextDocument,
  funName: string,
  param: string,
  index: SymbolIndex,
  token: vscode.CancellationToken,
): Promise<[vscode.Uri, vscode.Range][]> {
  const out: [vscode.Uri, vscode.Range][] = [];
  const own = document.uri.toString();
  const callRe = new RegExp(`\\b${funName}\\s*\\(`, 'g');
  const collect = (lines: string[], uri: vscode.Uri, line: number, col: number) => {
    for (const r of labelRangesInCall(lines, line, col, param)) out.push([uri, r]);
  };

  const ownLines = document.getText().split('\n');
  for (let i = 0; i < ownLines.length; i++) {
    callRe.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = callRe.exec(ownLines[i]))) {
      if (isInsideCommentOrString(ownLines[i], m.index)) continue;
      collect(ownLines, document.uri, i, m.index + m[0].length);
    }
  }

  const declared = index.lookup(funName).filter(e => e.kind === 'fun' || e.kind === 'composable');
  if (declared.length !== 1) return out;
  const uris = index.fileUriStrings().filter(u => u !== own && !isExcluded(u));
  const hits = await scanForUsages(funName, document, index, uris, token);
  const byFile = new Map<string, UsageResult[]>();
  for (const h of hits) {
    if (h.uriString === own) continue;
    const list = byFile.get(h.uriString) ?? [];
    list.push(h);
    byFile.set(h.uriString, list);
  }
  for (const [uriStr, list] of byFile) {
    if (token.isCancellationRequested) break;
    let lines: string[];
    try { lines = (await vscode.workspace.openTextDocument(vscode.Uri.parse(uriStr))).getText().split('\n'); }
    catch { continue; }
    for (const h of list) {
      const after = lines[h.line]?.slice(h.character + funName.length) ?? '';
      const paren = /^\s*\(/.exec(after);
      if (!paren) continue;
      collect(lines, h.uri, h.line, h.character + funName.length + paren[0].length);
    }
  }
  return out;
}

/**
 * `param =` labels at the top level of the argument list that starts right
 * after the `(` at (line, col). Walks up to 200 lines, balancing every
 * bracket so a lambda argument's own assignments are not labels.
 */
function labelRangesInCall(lines: string[], line: number, col: number, param: string): vscode.Range[] {
  const out: vscode.Range[] = [];
  const labelRe = new RegExp(`(^\\s*|[(,]\\s*)(${param})\\s*=(?!=)`, 'g');
  let depth = 0;
  const stop = Math.min(lines.length - 1, line + 200);
  for (let li = line; li <= stop; li++) {
    const text = lines[li];
    const from = li === line ? col : 0;
    // Labels on this line at depth 0 of the call
    if (depth === 0) {
      labelRe.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = labelRe.exec(text))) {
        const at = m.index + m[1].length;
        if (at < from) continue;
        if (isInsideCommentOrString(text, at)) continue;
        if (depthBetween(text, from, at) !== 0) continue;
        out.push(new vscode.Range(li, at, li, at + param.length));
      }
    }
    for (let c = from; c < text.length; c++) {
      const ch = text[c];
      if (ch !== '(' && ch !== ')' && ch !== '{' && ch !== '}' && ch !== '[' && ch !== ']') continue;
      if (isInsideCommentOrString(text, c)) continue;
      if (ch === '(' || ch === '{' || ch === '[') depth++;
      else if (--depth < 0) return out; // the call's closing paren
    }
  }
  return out;
}

function depthBetween(text: string, from: number, to: number): number {
  let d = 0;
  for (let c = from; c < to; c++) {
    const ch = text[c];
    if (ch === '(' || ch === '{' || ch === '[') d++;
    else if (ch === ')' || ch === '}' || ch === ']') d--;
  }
  return d;
}

/** Remplace le nom accentue partout ou il apparait LITTERALEMENT dans ce fichier. */
function renommerNomAccentue(
  document: vscode.TextDocument,
  accent: { content: string },
  newName: string,
): vscode.WorkspaceEdit | null {
  const litteral = ACCENT + accent.content + ACCENT;
  const edit = new vscode.WorkspaceEdit();
  let trouve = 0;
  for (let l = 0; l < document.lineCount; l++) {
    const texte = document.lineAt(l).text;
    let at = texte.indexOf(litteral);
    while (at >= 0) {
      edit.replace(
        document.uri,
        new vscode.Range(l, at + 1, l, at + litteral.length - 1),
        newName,
        META_OCCURRENCES,
      );
      trouve++;
      at = texte.indexOf(litteral, at + litteral.length);
    }
  }
  return trouve === 0 ? null : edit;
}

export class KotlinRenameProvider implements vscode.RenameProvider {
  constructor(private readonly index: SymbolIndex) {}

  prepareRename(
    document: vscode.TextDocument,
    position: vscode.Position,
  ): { range: vscode.Range; placeholder: string } | null {
    // Un nom accentue compose se renomme EN ENTIER. Voir `nomAccentueComposite`.
    const accent = nomAccentueComposite(document, position);
    if (accent) {
      return {
        range: new vscode.Range(position.line, accent.start, position.line, accent.end),
        placeholder: accent.content,
      };
    }

    const wordRange = document.getWordRangeAtPosition(position, WORD_RE);
    if (!wordRange) return null;
    const word = document.getText(wordRange);
    if (word.length < 2) return null;

    // Refuse rename on plain string / comment text — these are not
    // symbols. Allow short ($word) and full ${word} interpolation.
    if (document.languageId === 'kotlin' || document.languageId === 'java') {
      const lineText = document.lineAt(position.line).text;
      const start    = wordRange.start.character;
      if (isInsideCommentOrString(lineText, start)) {
        const isShortInterp = start >= 1 && lineText[start - 1] === '$';
        const isFullInterp  = isInsideStringInterpolation(lineText, start);
        if (!isShortInterp && !isFullInterp) return null;
      }
    }

    // A local symbol (parameter, val/var, for/lambda binding) is
    // renameable even if the workspace index has no entry for the
    // word. Also: when a local exists, we MUST allow rename and
    // scope it locally — otherwise provideRenameEdits would scan the
    // workspace and rewrite every same-named symbol. That was the
    // data-loss bug Kevin is guarding against.
    if (resolveLocalScope(document, position, word)) {
      return { range: wordRange, placeholder: word };
    }
    if (this.index.lookup(word).length === 0) return null;
    return { range: wordRange, placeholder: word };
  }

  async provideRenameEdits(
    document: vscode.TextDocument,
    position: vscode.Position,
    newName: string,
    token: vscode.CancellationToken,
  ): Promise<vscode.WorkspaceEdit | null> {
    // Un nom accentue compose ne concerne que son propre fichier. Mesure sur un
    // projet reel : 1086 de ces 1090 noms n'existent que dans un fichier, et
    // les 4 restants sont des tests homonymes de classes differentes, qu'il ne
    // faut surtout pas lier entre eux.
    const accent = nomAccentueComposite(document, position);
    if (accent) return renommerNomAccentue(document, accent, newName);

    const wordRange = document.getWordRangeAtPosition(position, WORD_RE);
    if (!wordRange) return null;
    const word = document.getText(wordRange);
    if (word.length < 2) return null;

    // Local-scoped rename: cursor is on a parameter / local val/var /
    // for/lambda binding. Edit ONLY the declaration + its in-function
    // usages. NEVER fan out to the workspace — that was the original
    // data-loss bug (renaming a local `name` would rewrite every
    // workspace `name` symbol).
    const localDecl = resolveLocalScope(document, position, word);
    if (localDecl) {
      // Place the cursor at the declaration to drive findLocalUsages
      // forward-scan from there.
      const declPos    = localDecl.range.start;
      const declUsages = findLocalUsages(document, declPos, word);
      const edit = new vscode.WorkspaceEdit();
      // Declaration itself.
      edit.replace(document.uri, localDecl.range, newName, META_OCCURRENCES);
      // Each usage.
      for (const usage of declUsages) {
        edit.replace(document.uri, usage.range, newName, META_OCCURRENCES);
      }
      // A parameter is also named at every call site: `Screen(title = "x")`
      // kept the old label and stopped compiling.
      const owner = parameterOwner(document, declPos, word);
      if (owner) {
        for (const [uri, range] of await namedArgLabelRanges(document, owner, word, this.index, token)) {
          edit.replace(uri, range, newName, META_OCCURRENCES);
        }
      }
      return edit;
    }

    const decls = this.index.lookup(word);
    if (decls.length === 0) return null;

    // `private` symbols have no cross-file callers in valid code — rename
    // only needs to touch the declaring file. `scanImports` would never
    // find an import of a private symbol anyway. Skip the workspace
    // URI parse + picomatch entirely.
    const target = resolveSearchTarget(word, document, this.index);
    const uriStrings = target?.isPrivate
      ? [target.uri.toString()]
      : this.index.fileUriStrings().filter(u => !isExcluded(u));

    // Both scans run in parallel
    const [codeResults, importResults] = await Promise.all([
      scanForUsages(word, document, this.index, uriStrings, token),
      scanImports(word, this.index, uriStrings, token, target),
    ]);

    if (token.isCancellationRequested) return null;
    if (codeResults.length === 0 && importResults.length === 0) return null;

    // Build per-URI edit tuple arrays — one set() call per file,
    // with per-edit metadata so VS Code groups them in the preview panel.
    const editsByUri = new Map<
      string,
      [vscode.TextEdit, vscode.WorkspaceEditEntryMetadata | undefined][]
    >();

    const push = (r: UsageResult, meta: vscode.WorkspaceEditEntryMetadata) => {
      let arr = editsByUri.get(r.uriString);
      if (!arr) { arr = []; editsByUri.set(r.uriString, arr); }
      arr.push([
        vscode.TextEdit.replace(
          new vscode.Range(r.line, r.character, r.line, r.character + word.length),
          newName,
        ),
        meta,
      ]);
    };

    for (const r of codeResults)   push(r, META_OCCURRENCES);
    for (const r of importResults) push(r, META_IMPORTS);

    const edit = new vscode.WorkspaceEdit();
    for (const [uriStr, tuples] of editsByUri) {
      edit.set(vscode.Uri.parse(uriStr), tuples);
    }

    // Optional file rename — only for class-like top-level declarations.
    // Use resolveSearchTarget to pick the specific declaration referenced by the
    // document context, preventing the wrong file from being renamed when multiple
    // classes share the same simple name across packages.
    const resolved = resolveSearchTarget(word, document, this.index);
    const fileEntry = (() => {
      if (resolved && resolved.depth === 0 && FILE_RENAME_KINDS.has(resolved.kind)) {
        return resolved; // unambiguous target from import/package resolution
      }
      // Fallback: only when there is exactly one class-like declaration globally
      const candidates = decls.filter(d => d.depth === 0 && FILE_RENAME_KINDS.has(d.kind));
      return candidates.length === 1 ? candidates[0] : null;
    })();
    if (fileEntry) {
      const newUri = computeFileRename(fileEntry, newName, this.index);
      if (newUri) {
        edit.renameFile(
          fileEntry.uri,
          newUri,
          { overwrite: false },
          metaFile(fileEntry.name, newName, fileEntry.uri.path.endsWith('.java') ? '.java' : '.kt'),
        );
      }
    }

    return edit;
  }
}
