import * as vscode from 'vscode';
import { parse, RawSymbol } from '../indexer/KotlinParser';
import { sanitizeForUsageScan } from './UnusedImportProvider';
import { findMatchingParen } from '../util/SignatureReader';
import { rangeEndLine } from '../util/symbolRanges';
import { reportDecorations } from '../util/demoProbe';

/**
 * KJ-025: unused parameter detection + removal quick fix.
 *
 * Flags three structurally file-local cases (zero false positives by design,
 * false negatives accepted — same philosophy as KJ-009's wildcard rule):
 *   1. `ctorParam` — primary-constructor parameter without val/var
 *   2. `ctorProp`  — `private val`/`private var` constructor property unused in the file
 *   3. `funParam`  — parameter of a `private fun` with a body
 *
 * Never flagged: override/operator/expect/actual/abstract/external/`main`,
 * data/enum/annotation/value classes, interfaces, objects, annotated
 * declarations or parameters, vararg, backticked names, anything under
 * `@Suppress`. Local shadowing and named-argument labels count as usages
 * (false negatives, locked by tests).
 *
 * Rendering: Warning diagnostic + DiagnosticTag.Unnecessary (VS Code fades
 * the range natively). The quick fix removes the declaration AND the matching
 * argument at every unambiguous call site; ambiguous sites (overloads,
 * homonym classes, `::references`) are skipped, and cross-file edits go
 * through the Refactor Preview (needsConfirmation).
 */

export type UnusedParamKind = 'ctorParam' | 'ctorProp' | 'funParam';

export interface UnusedParam {
  /** 0-based line of the parameter name token. */
  line: number;
  /** 0-based start column of the name token. */
  character: number;
  name: string;
  kind: UnusedParamKind;
  /** Index in the declaration's parameter list (positional argument removal). */
  paramIndex: number;
  /** Class or function owning the parameter (call-site search). */
  ownerName: string;
  /** Absolute offsets of the declaration segment to delete (comma included). */
  declStart: number;
  declEnd: number;
  /** Offset where a param-site annotation can be inserted (before modifiers). */
  annotationInsert: number;
}

// The pure scanning primitives moved to src/util/kotlinScan.ts so the
// KJ-032 dry-run harness can run them without an extension host.
// Re-exported: the KJ-025/026/027/028/030/031 suites import them from here.
export {
  FILE_SUPPRESS_RE, suppressesDiagnostic,
  UNUSED_DECLARATION, UNUSED_PARAMETER, UNUSED_VARIABLE,
  SUPPRESS_NAMES, BENIGN_FUN_ANNOTATIONS,
  buildLineStarts, offsetToPos, collectAnnotationTargets,
  findCtorParen, splitParamSegments, matchBrace, depthZeroColon,
} from '../util/kotlinScan';
export type { Seg } from '../util/kotlinScan';
import type { Seg } from '../util/kotlinScan';
import {
  FILE_SUPPRESS_RE, suppressesDiagnostic, UNUSED_PARAMETER,
  SUPPRESS_NAMES, BENIGN_FUN_ANNOTATIONS,
  buildLineStarts, offsetToPos, collectAnnotationTargets,
  findCtorParen, splitParamSegments, matchBrace, depthZeroColon,
} from '../util/kotlinScan';






/**
 * Deletion range for one segment of a comma-separated list: the trimmed
 * segment plus its separator comma. When the segment owns its whole line
 * (multi-line lists), the entire line goes, newline included.
 */
function segmentDeletionRange(text: string, segs: Seg[], index: number, lineStarts: number[]): { start: number; end: number } {
  const seg = segs[index];
  let start = seg.start;
  while (start < seg.end && /\s/.test(text[start])) start++;
  let end = seg.end;
  while (end > start && /\s/.test(text[end - 1])) end--;

  if (index < segs.length - 1) {
    // not last: eat the following comma + spaces (not newlines)
    end = seg.end + 1;
    while (end < text.length && (text[end] === ' ' || text[end] === '\t')) end++;
  } else if (text[seg.end] === ',') {
    end = seg.end + 1; // trailing comma
  } else if (index > 0) {
    // last of several: eat the preceding comma
    start = segs[index - 1].end;
  }

  // full-line segment → delete the line
  const { line: startLine } = offsetToPos(lineStarts, start);
  const lineStart = lineStarts[startLine];
  const lineEnd = startLine + 1 < lineStarts.length ? lineStarts[startLine + 1] : text.length;
  if (
    text.slice(lineStart, start).trim() === '' &&
    text.slice(end, lineEnd).trim() === '' &&
    end <= lineEnd
  ) {
    return { start: lineStart, end: lineEnd };
  }
  return { start, end };
}


export function findUnusedParameters(text: string): UnusedParam[] {
  if (!/\b(?:class|fun)\b/.test(text)) return [];
  const fileSuppress = FILE_SUPPRESS_RE.exec(text);
  if (fileSuppress && suppressesDiagnostic(fileSuppress[1], UNUSED_PARAMETER)) return [];

  const symbols = parse('inline', text).symbols;
  const clean = sanitizeForUsageScan(text);
  const lines = text.split('\n');
  const lineStarts = buildLineStarts(text);
  const lastLine = lines.length - 1;
  const annoTargets = collectAnnotationTargets(clean);
  // Annotations attached to this declaration: their target is the first code
  // character of the decl (between line start and the symbol name column).
  const annosFor = (sym: RawSymbol): string[] => {
    const lo = lineStarts[sym.line];
    const hi = lo + sym.character;
    return annoTargets.filter(a => a.target >= lo && a.target <= hi).map(a => a.name);
  };
  const result: UnusedParam[] = [];

  // The symbol-based extent (rangeEndLine) truncates too early when the body
  // is an expression containing an object/lambda: the parser records that
  // `object :` as a SIBLING (braces not open yet on the decl line), e.g.
  // `private fun city(id: String) = object : Model { fun getId() = id }`.
  // The balanced-brace extent of the real body wins; over-scanning can only
  // produce false negatives, never false positives.
  const scanCandidates = (
    owner: RawSymbol,
    ownerIndex: number,
    openParen: number,
    candidates: { seg: Seg; segs: Seg[]; segIndex: number; nameOffset: number; name: string; kind: UnusedParamKind }[],
    structuralEnd = 0,
  ): void => {
    if (candidates.length === 0) return;
    const endLine = rangeEndLine(symbols, ownerIndex, lastLine);
    const endOffset = Math.max(
      endLine + 1 < lineStarts.length ? lineStarts[endLine + 1] : text.length,
      structuralEnd,
    );
    for (const c of candidates) {
      const regionStart = c.kind === 'ctorProp' ? 0 : openParen;
      const regionEnd = c.kind === 'ctorProp' ? clean.length : endOffset;
      // blank the candidate's own declaration segment, then look for the name
      const scanStr =
        clean.slice(regionStart, c.seg.start) +
        ' '.repeat(c.seg.end - c.seg.start) +
        clean.slice(c.seg.end, regionEnd);
      if (new RegExp(`\\b${c.name}\\b`).test(scanStr)) continue;
      const pos = offsetToPos(lineStarts, c.nameOffset);
      const del = segmentDeletionRange(text, c.segs, c.segIndex, lineStarts);
      let trimStart = c.seg.start;
      while (trimStart < c.seg.end && /\s/.test(text[trimStart])) trimStart++;
      result.push({
        line: pos.line,
        character: pos.character,
        name: c.name,
        kind: c.kind,
        paramIndex: c.segIndex,
        ownerName: owner.name,
        declStart: del.start,
        declEnd: del.end,
        annotationInsert: trimStart,
      });
    }
  };

  const collectParams = (
    openParen: number,
    closeParen: number,
    forClass: boolean,
  ): { seg: Seg; segs: Seg[]; segIndex: number; nameOffset: number; name: string; kind: UnusedParamKind }[] => {
    const segs = splitParamSegments(clean, openParen + 1, closeParen, text);
    const out: { seg: Seg; segs: Seg[]; segIndex: number; nameOffset: number; name: string; kind: UnusedParamKind }[] = [];
    for (let si = 0; si < segs.length; si++) {
      const seg = segs[si];
      const segText = clean.slice(seg.start, seg.end);
      if (segText.includes('@')) continue; // annotated param
      const colon = depthZeroColon(clean, seg);
      if (colon === -1) continue;
      const before = clean.slice(seg.start, colon);
      if (before.includes('`')) continue; // backticked name
      if (/\bvararg\b/.test(before)) continue;
      if (/\boverride\b/.test(before)) continue;
      const nameMatch = /([A-Za-z_]\w*)\s*$/.exec(before);
      if (!nameMatch) continue;
      const name = nameMatch[1];
      if (name.startsWith('_')) continue; // `_event`: intentionally-unused convention
      const nameOffset = seg.start + nameMatch.index;
      const hasValVar = /\b(?:val|var)\b/.test(before.slice(0, nameMatch.index));
      const isPrivate = /\bprivate\b/.test(before);
      let kind: UnusedParamKind;
      if (forClass) {
        if (hasValVar) {
          if (!isPrivate) continue; // public property: visible outside the file
          kind = 'ctorProp';
        } else {
          kind = 'ctorParam';
        }
      } else {
        kind = 'funParam';
      }
      out.push({ seg, segs, segIndex: si, nameOffset, name, kind });
    }
    return out;
  };

  for (let idx = 0; idx < symbols.length; idx++) {
    const sym = symbols[idx];

    if (sym.kind === 'class' || sym.kind === 'sealedClass') {
      const declLine = lines[sym.line];
      const annoNames = annosFor(sym);
      if (annoNames.some(n => SUPPRESS_NAMES.has(n) || n === 'JvmInline')) continue;
      if (/\bvalue\s+class\b/.test(declLine)) continue;
      // ctorProp only: any class annotation may imply codegen/reflection reads
      const classIsAnnotated = annoNames.length > 0;
      const nameEnd = lineStarts[sym.line] + sym.character + sym.name.length;
      const openParen = findCtorParen(clean, nameEnd);
      if (openParen === -1) continue;
      const closeParen = findMatchingParen(clean, openParen);
      if (closeParen === -1) continue;
      let candidates = collectParams(openParen, closeParen, true);
      if (classIsAnnotated) candidates = candidates.filter(c => c.kind !== 'ctorProp');
      // class body extent by brace matching (first `{` after the header)
      const bodyBrace = clean.indexOf('{', closeParen);
      const bodyClose = bodyBrace === -1 ? -1 : matchBrace(clean, bodyBrace);
      scanCandidates(sym, idx, openParen, candidates, bodyClose === -1 ? 0 : bodyClose + 1);
      continue;
    }

    if (sym.kind === 'fun' || sym.kind === 'composable') {
      if (!sym.isPrivate) continue;
      if (sym.isOverride || sym.isOperator || sym.isAbstract || sym.isExpect || sym.isActual) continue;
      if (sym.name === 'main' || sym.name.startsWith('`')) continue;
      const annoNames = annosFor(sym);
      if (annoNames.some(a => !BENIGN_FUN_ANNOTATIONS.has(a))) continue;
      let i = lineStarts[sym.line] + sym.character + sym.name.length;
      while (i < clean.length && /\s/.test(clean[i])) i++;
      if (clean[i] !== '(') continue;
      const openParen = i;
      const closeParen = findMatchingParen(clean, openParen);
      if (closeParen === -1) continue;
      // body required: `{` or `=` after the signature but BEFORE the next
      // sibling symbol — otherwise a bodiless fun (external, header) followed
      // by another fun would borrow that fun's body opener
      const endLine = rangeEndLine(symbols, idx, lastLine);
      const endOffset = endLine + 1 < lineStarts.length ? lineStarts[endLine + 1] : text.length;
      const after = clean.slice(closeParen + 1, Math.min(endOffset, closeParen + 801));
      const bodyRel = after.search(/[{=]/);
      if (bodyRel === -1) continue;
      // structural body extent: block body → its balanced braces; expression
      // body → the balanced extent of the first `{` in the expression, if any
      // (lambda or object expression)
      const bodyAbs = closeParen + 1 + bodyRel;
      let braceAbs = -1;
      if (after[bodyRel] === '{') {
        braceAbs = bodyAbs;
      } else {
        const rel = clean.slice(bodyAbs, bodyAbs + 400).indexOf('{');
        if (rel !== -1) braceAbs = bodyAbs + rel;
      }
      let structuralEnd = 0;
      if (braceAbs !== -1) {
        const close = matchBrace(clean, braceAbs);
        if (close !== -1) structuralEnd = close + 1;
      }
      scanCandidates(sym, idx, openParen, collectParams(openParen, closeParen, false), structuralEnd);
    }
  }

  return result;
}

// ── Call-site argument removal ───────────────────────────────────────────────

export interface CallEdit {
  start: number;
  end: number;
}

export interface CallScanResult {
  edits: CallEdit[];
  /** Ambiguous or unparseable sites left untouched. */
  skipped: number;
}

/**
 * Computes the argument deletions needed in ONE file when removing
 * `param` from `param.ownerName`'s signature. Pure and offset-based.
 */
export function computeCallSiteEdits(
  text: string,
  param: Pick<UnusedParam, 'name' | 'paramIndex' | 'ownerName' | 'kind'>,
  lang: 'kotlin' | 'java' = 'kotlin',
): CallScanResult {
  const clean = sanitizeForUsageScan(text);

  // Java writes the same intentions with a different syntax, and every guard
  // below was written against Kotlin's. Rather than teach each one two
  // dialects, bail on the whole file whenever a Java construct could hide a
  // call whose arity we would silently break.
  if (lang === 'java') {
    const owner = param.ownerName;
    // `Owner::new` is a constructor reference; removing a parameter changes
    // the functional interface it satisfies.
    if (new RegExp(`\\b${owner}\\s*::`).test(clean)) return { edits: [], skipped: 1 };
    // `class Sub extends Owner` hides the call inside `super(a, b)`, which we
    // cannot map positionally without parsing the constructor.
    if (new RegExp(`\\bextends\\s+${owner}\\b`).test(clean)) return { edits: [], skipped: 1 };
    // A homonym declared here makes every call site in this file ambiguous.
    // `record` and `@interface` are Java kinds the Kotlin guard never knew.
    if (new RegExp(`\\b(?:class|interface|enum|record|@interface)\\s+${owner}\\b`).test(clean)) {
      return { edits: [], skipped: 1 };
    }
  }
  const lineStarts = buildLineStarts(text);
  const isCtor = param.kind !== 'funParam';
  const edits: CallEdit[] = [];
  let skipped = 0;

  // A function/constructor reference changes arity with the removal: bail on the file.
  if (new RegExp(`::\\s*${param.ownerName}\\b`).test(clean)) return { edits: [], skipped: 1 };
  // Subclass whose supertype list names the class WITHOUT calling its ctor
  // (`class Sub : Owner { constructor(x) : super(x, 2) }`) hides the call in
  // `super(…)`. Only bail when a `super(` actually exists — a plain type
  // annotation (`val x: Owner`) must not silence the whole file.
  if (
    isCtor &&
    /:\s*super\s*\(/.test(clean) &&
    new RegExp(`:\\s*${param.ownerName}\\b(?!\\s*[<(])`).test(clean)
  ) {
    return { edits: [], skipped: 1 };
  }

  const nameRe = new RegExp(`\\b${param.ownerName}\\b`, 'g');
  const openParens: number[] = [];
  let m: RegExpExecArray | null;
  while ((m = nameRe.exec(clean)) !== null) {
    // optional generic arguments: `Box<Int>(…)` — '<' must touch the name so
    // a comparison (`count < 3`) is never mistaken for type arguments
    let j = m.index + param.ownerName.length;
    if (clean[j] === '<') {
      let depth = 0;
      while (j < clean.length) {
        const c = clean[j];
        if (c === '-' && clean[j + 1] === '>') { j += 2; continue; }
        if (c === '<') depth++;
        else if (c === '>') { depth--; j++; if (depth === 0) break; continue; }
        j++;
      }
    }
    while (j < clean.length && (clean[j] === ' ' || clean[j] === '\t')) j++;
    if (clean[j] !== '(') continue;
    const openParen = j;
    // exclude the declaration itself (fun/class/interface/object keyword before the name)
    let k = m.index - 1;
    while (k >= 0 && /\s/.test(clean[k])) k--;
    const wordEnd = k + 1;
    while (k >= 0 && /\w/.test(clean[k])) k--;
    const prevWord = clean.slice(k + 1, wordEnd);
    if (['fun', 'class', 'interface', 'object', 'enum'].includes(prevWord)) continue;
    // method call on another receiver (`other.render(…)`) may be a different
    // symbol — only `this.` and bare calls are provably ours. Qualified ctor
    // calls (`com.pkg.ClassName(…)`) stay allowed.
    if (!isCtor) {
      const before = clean.slice(Math.max(0, m.index - 12), m.index);
      if (/\.\s*$/.test(before) && !/\bthis\s*\.\s*$/.test(before)) {
        skipped++;
        continue;
      }
    }
    openParens.push(openParen);
  }
  // Secondary-constructor delegation, only INSIDE the declaring class's body:
  // a `: this(…)` in another class of the same file targets that other class.
  if (isCtor) {
    const syms = parse('call-scan', text).symbols;
    const ci = syms.findIndex(
      s => (s.kind === 'class' || s.kind === 'sealedClass' || s.kind === 'dataClass') && s.name === param.ownerName,
    );
    if (ci !== -1) {
      const endLine = rangeEndLine(syms, ci, lineStarts.length - 1);
      const from = lineStarts[syms[ci].line];
      const to = endLine + 1 < lineStarts.length ? lineStarts[endLine + 1] : text.length;
      const region = clean.slice(from, to);
      // 2+ secondary ctors: `this(…)` may delegate to another secondary, not
      // the primary — positional mapping would be wrong
      const secondaryCtors = (region.match(/\bconstructor\s*\(/g) ?? []).length;
      const thisRe = /:\s*this\s*\(/g;
      let tm: RegExpExecArray | null;
      while ((tm = thisRe.exec(region)) !== null) {
        if (secondaryCtors > 1) { skipped++; continue; }
        openParens.push(from + tm.index + tm[0].length - 1);
      }
    }
  }

  for (const openParen of openParens) {
    const closeParen = findMatchingParen(clean, openParen);
    if (closeParen === -1) { skipped++; continue; }
    const segs = splitParamSegments(clean, openParen + 1, closeParen, text);
    if (segs.length === 0) continue; // no args passed (defaults)

    const namedIdx = segs.findIndex(s =>
      new RegExp(`^\\s*${param.name}\\s*=(?!=)`).test(clean.slice(s.start, s.end)),
    );
    if (namedIdx !== -1) {
      edits.push(segmentDeletionRange(text, segs, namedIdx, lineStarts));
      continue;
    }
    // not passed at all: not by name (namedIdx === -1) and not positionally
    // (fewer args than paramIndex+1 — positional args keep their index even
    // mixed with named-in-position args) → nothing to remove at this site
    if (segs.length <= param.paramIndex) continue;
    // positional removal: every arg up to paramIndex must itself be positional
    const namedFlags = segs.map(s => /^\s*\w+\s*=(?!=)/.test(clean.slice(s.start, s.end)));
    if (namedFlags.every(Boolean)) continue; // fully-named call without our param
    const anyNamedBefore = namedFlags.slice(0, param.paramIndex + 1).some(Boolean);
    if (anyNamedBefore) { skipped++; continue; }
    edits.push(segmentDeletionRange(text, segs, param.paramIndex, lineStarts));
  }

  return { edits, skipped };
}

// ── VS Code glue ─────────────────────────────────────────────────────────────

const CONFIG_KEY = 'unusedParameters';
const DEBOUNCE_MS = 400;

function toRange(text: string, start: number, end: number): vscode.Range {
  const lineStarts = buildLineStarts(text);
  const s = offsetToPos(lineStarts, start);
  const e = offsetToPos(lineStarts, end);
  return new vscode.Range(s.line, s.character, e.line, e.character);
}

export class UnusedParameterProvider implements vscode.Disposable {
  private readonly _collection = vscode.languages.createDiagnosticCollection('kotlin-jump-unused-parameters');
  private readonly _subs: vscode.Disposable[];
  private _timer: ReturnType<typeof setTimeout> | undefined;

  constructor() {
    this._subs = [
      vscode.window.onDidChangeActiveTextEditor(() => this._refresh()),
      vscode.workspace.onDidChangeTextDocument(e => {
        if (e.document === vscode.window.activeTextEditor?.document) this._refreshDebounced();
      }),
      vscode.workspace.onDidCloseTextDocument(doc => this._collection.delete(doc.uri)),
      vscode.workspace.onDidChangeConfiguration(e => {
        if (e.affectsConfiguration(`kotlinJump.${CONFIG_KEY}`)) this._refresh();
      }),
    ];
    this._refresh();
  }

  private _refreshDebounced(): void {
    if (this._timer) clearTimeout(this._timer);
    this._timer = setTimeout(() => this._refresh(), DEBOUNCE_MS);
  }

  private _refresh(): void {
    const editor = vscode.window.activeTextEditor;
    if (!editor || editor.document.languageId !== 'kotlin') return;

    const enabled = vscode.workspace.getConfiguration('kotlinJump').get<boolean>(CONFIG_KEY, true);
    if (!enabled) {
      this._collection.clear();
      reportDecorations('unusedParams', 0);
      return;
    }

    const unused = findUnusedParameters(editor.document.getText());
    const diags = unused.map(u => {
      const noun = u.kind === 'ctorProp' ? 'Property' : 'Parameter';
      const d = new vscode.Diagnostic(
        new vscode.Range(u.line, u.character, u.line, u.character + u.name.length),
        `${noun} '${u.name}' is never used`,
        vscode.DiagnosticSeverity.Warning,
      );
      d.tags = [vscode.DiagnosticTag.Unnecessary];
      d.source = 'kotlin-jump';
      d.code = 'unused-parameter';
      return d;
    });
    this._collection.set(editor.document.uri, diags);
    reportDecorations('unusedParams', diags.length);
  }

  dispose(): void {
    if (this._timer) clearTimeout(this._timer);
    this._collection.dispose();
    for (const s of this._subs) s.dispose();
  }
}

export class UnusedParameterCodeActionProvider implements vscode.CodeActionProvider {
  static readonly providedCodeActionKinds = [vscode.CodeActionKind.QuickFix];

  async provideCodeActions(
    document: vscode.TextDocument,
    range: vscode.Range | vscode.Selection,
  ): Promise<vscode.CodeAction[]> {
    const cfg = vscode.workspace.getConfiguration('kotlinJump');
    if (!cfg.get<boolean>(CONFIG_KEY, true)) return [];
    if (document.languageId !== 'kotlin') return [];

    const text = document.getText();
    const targets = findUnusedParameters(text).filter(u => u.line === range.start.line);
    if (targets.length === 0) return [];

    const actions: vscode.CodeAction[] = [];
    for (const param of targets) {
      const removeAction = await this._buildRemoveAction(document, text, param);
    if (removeAction) actions.push(removeAction);
      actions.push(this._buildSuppressAction(document, text, param));
    }
    return actions;
  }

  private async _buildRemoveAction(
    document: vscode.TextDocument,
    text: string,
    param: UnusedParam,
  ): Promise<vscode.CodeAction | undefined> {
    const edit = new vscode.WorkspaceEdit();
    edit.delete(document.uri, toRange(text, param.declStart, param.declEnd));

    const symbols = parse('inline', text).symbols;
    const ownerDecls = symbols.filter(s => s.name === param.ownerName).length;

    let argCount = 0;
    let fileCount = 0;
    let skipped = 0;

    if (ownerDecls > 1) {
      // overloads / homonym in the same file: every call site is ambiguous
      skipped++;
    } else {
      const local = computeCallSiteEdits(text, param);
      skipped += local.skipped;
      for (const e of local.edits) {
        // the declaration deletion may overlap a `this(…)` match — guard
        if (e.start >= param.declStart && e.start < param.declEnd) continue;
        edit.delete(document.uri, toRange(text, e.start, e.end));
        argCount++;
      }
      if (local.edits.length > 0) fileCount = 1;

      if (param.kind !== 'funParam') {
        const cross = await this._crossFileEdits(document, param, edit);
        // A truncated scan may have missed the one call site that matters, and
        // missing one means a broken build. Offer no removal at all.
        if (cross.truncated) return undefined;
        argCount += cross.argCount;
        fileCount += cross.fileCount;
        skipped += cross.skipped;
      }
    }

    let title = `Remove unused parameter '${param.name}'`;
    if (argCount > 0) {
      title += ` and ${argCount} argument${argCount > 1 ? 's' : ''}`;
      if (fileCount > 1) title += ` in ${fileCount} files`;
    }
    if (skipped > 0) title += ` (${skipped} ambiguous site${skipped > 1 ? 's' : ''} skipped)`;

    const action = new vscode.CodeAction(title, vscode.CodeActionKind.QuickFix);
    action.edit = edit;
    action.isPreferred = true;
    return action;
  }

  private async _crossFileEdits(
    document: vscode.TextDocument,
    param: UnusedParam,
    edit: vscode.WorkspaceEdit,
  ): Promise<{ argCount: number; fileCount: number; skipped: number; truncated?: boolean }> {
    let argCount = 0;
    let fileCount = 0;
    let skipped = 0;
    // Java callers were invisible here, so the fix could delete a parameter a
    // `new Owner(a, b)` still passes. The cap matters just as much: truncating
    // means missing call sites, which means a broken build, so the family's
    // rule "a truncated corpus produces nothing" applies and we refuse.
    const CAP = 20000;
    const files = await vscode.workspace.findFiles(
      '**/*.{kt,java}', '**/{node_modules,build,.git,out,dist}/**', CAP);
    if (files.length >= CAP) return { argCount: 0, fileCount: 0, skipped: 0, truncated: true };
    const declRe = new RegExp(`\\b(?:class|interface|object)\\s+${param.ownerName}\\b`);
    const decoder = new TextDecoder();
    for (const uri of files) {
      if (uri.toString() === document.uri.toString()) continue;
      let other: string;
      try {
        other = decoder.decode(await vscode.workspace.fs.readFile(uri));
      } catch {
        continue;
      }
      if (!other.includes(param.ownerName)) continue;
      if (declRe.test(other)) {
        // homonym class declared elsewhere: this file's call sites are ambiguous
        skipped++;
        continue;
      }
      const res = computeCallSiteEdits(other, param, uri.fsPath.endsWith('.java') ? 'java' : 'kotlin');
      skipped += res.skipped;
      if (res.edits.length === 0) continue;
      fileCount++;
      for (const e of res.edits) {
        edit.delete(uri, toRange(other, e.start, e.end), {
          needsConfirmation: true,
          label: `Remove argument for '${param.name}'`,
        });
        argCount++;
      }
    }
    return { argCount, fileCount, skipped };
  }

  private _buildSuppressAction(
    document: vscode.TextDocument,
    text: string,
    param: UnusedParam,
  ): vscode.CodeAction {
    // parameter-site suppression works for all three kinds and keeps the edit
    // local; inserted before the modifiers (`@Suppress(…) private val x`)
    const id = param.kind === 'ctorProp' ? 'unused' : 'UNUSED_PARAMETER';
    const pos = offsetToPos(buildLineStarts(text), param.annotationInsert);
    const edit = new vscode.WorkspaceEdit();
    edit.insert(document.uri, new vscode.Position(pos.line, pos.character), `@Suppress("${id}") `);
    const action = new vscode.CodeAction(`Suppress with @Suppress("${id}")`, vscode.CodeActionKind.QuickFix);
    action.edit = edit;
    return action;
  }
}
