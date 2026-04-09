import * as vscode from 'vscode';
import { SymbolEntry, SymbolIndex } from '../indexer/SymbolIndex';
import { resolveBest } from '../util/ImportResolver';
import { readSignature, parseParams, extractReturnType, KtParam } from '../util/SignatureReader';
import { isInsideCommentOrString } from '../util/textUtils';
import { Logger, NullLogger } from '../util/logger';

// Matches a potential function/constructor call: lowercase-or-uppercase word followed by `(`
// We match both cases because constructors start with uppercase (e.g. `Column(`)
const CALL_RE = /\b([A-Za-z_]\w*)\s*\(/g;

// Matches an untyped val/var declaration: no `: Type` annotation before `=`
// Captures: (1) val|var, (2) varName, (3) RHS expression
const VAL_VAR_RE = /^\s*(?:(?:public|private|protected|internal|override|open|abstract|actual|expect|const|lateinit)\s+)*(val|var)\s+(\w+)\s*=\s*(.+)$/;

const DECL_RE = /^\s*(?:(?:public|private|protected|internal|override|open|abstract|sealed|inline|suspend|operator|infix|external|actual|expect|companion|data|inner|noinline|crossinline|tailrec|lateinit|const)\s+)*(?:fun|class|data\s+class|object|interface|abstract\s+class|sealed\s+class|enum\s+class|annotation\s+class|typealias|val|var)\s/;

// Same as DECL_RE but without val/var — used to guard pass1 so param hints
// still appear on `val x : Type = call(...)` lines.
const FUN_DECL_RE = /^\s*(?:(?:public|private|protected|internal|override|open|abstract|sealed|inline|suspend|operator|infix|external|actual|expect|companion|data|inner|noinline|crossinline|tailrec|lateinit|const)\s+)*(?:fun|class|data\s+class|object|interface|abstract\s+class|sealed\s+class|enum\s+class|annotation\s+class|typealias)\s/;

const CALL_KINDS = new Set(['fun', 'composable', 'class', 'dataClass'] as const);

export class KotlinInlayHintsProvider implements vscode.InlayHintsProvider {
  // Cache: fqn → parsed params (avoids reopening declaration docs on every keystroke)
  private readonly paramCache = new Map<string, KtParam[]>();
  // Cache: fqn → extracted return type (null = cached miss)
  private readonly returnTypeCache = new Map<string, string | null>();

  // EventEmitter so extension.ts can notify VS Code to re-request hints after settings change
  private readonly _onDidChangeInlayHints = new vscode.EventEmitter<void>();
  readonly onDidChangeInlayHints = this._onDidChangeInlayHints.event;

  fireChange(): void {
    this.log.debug('[InlayHints] fireChange() — invalidating all hints');
    this.paramCache.clear();
    this.returnTypeCache.clear();
    this._onDidChangeInlayHints.fire();
  }

  dispose(): void {
    this._onDidChangeInlayHints.dispose();
  }

  constructor(
    private readonly index: SymbolIndex,
    private readonly log: Logger | NullLogger = new NullLogger(),
  ) {}

  async provideInlayHints(
    document: vscode.TextDocument,
    range: vscode.Range,
    token: vscode.CancellationToken,
  ): Promise<vscode.InlayHint[]> {
    // Read settings dynamically so changes take effect without Reload Window
    const cfg = vscode.workspace.getConfiguration('kotlinJump');
    const showParamNames    = cfg.get<boolean>('inlayHints.parameterNames', true);
    const showInferredTypes = cfg.get<boolean>('inlayHints.inferredTypes', false);

    this.log.debug(
      `[InlayHints] provideInlayHints — file=${document.fileName?.split('/').pop() ?? '<doc>'} ` +
      `showParamNames=${showParamNames} showInferredTypes=${showInferredTypes} ` +
      `range=${range.start.line}:${range.start.character}→${range.end.line}:${range.end.character}`,
    );

    if (!showParamNames && !showInferredTypes) {
      this.log.debug('[InlayHints] both features disabled — returning []');
      return [];
    }

    const hints: vscode.InlayHint[] = [];

    // Track raw-string state across lines (""" toggles in/out of raw string)
    let inRawString = false;

    for (let lineNum = range.start.line; lineNum <= range.end.line; lineNum++) {
      if (token.isCancellationRequested) {
        this.log.debug(`[InlayHints] cancellation requested at line ${lineNum}`);
        break;
      }

      const line = document.lineAt(lineNum);
      const text = line.text;

      // Count """ occurrences on this line to toggle raw-string state
      const tripleCount = countTripleQuotes(text);
      if (inRawString) {
        if (tripleCount % 2 !== 0) inRawString = false;
        continue; // skip lines inside raw strings
      }
      if (tripleCount % 2 !== 0) {
        this.log.debug(`[InlayHints] line ${lineNum} — raw string opened, skipping`);
        inRawString = true;
      }

      // Skip pure comment lines (both passes)
      if (/^\s*(\/\/|\/\*|\*)/.test(text)) continue;

      const isDecl    = DECL_RE.test(text);
      const isFunDecl = FUN_DECL_RE.test(text);

      // ── Pass 1: parameter name hints ─────────────────────────────────────
      if (showParamNames && !isFunDecl) {
        CALL_RE.lastIndex = 0;
        let match: RegExpExecArray | null;

        while ((match = CALL_RE.exec(text)) !== null) {
          if (token.isCancellationRequested) break;

          // Skip matches inside string literals or comments
          if (isInsideCommentOrString(text, match.index)) continue;

          const name = match[1];
          const parenOffset = match.index + match[0].length - 1; // position of `(`

          // Skip very short names — too noisy and almost never useful
          if (name.length < 2) continue;

          const entry = this.resolveCallEntry(name, document);
          if (!entry) {
            this.log.debug(`[InlayHints] pass1 line ${lineNum} — ${name}() → no entry (unknown or ambiguous)`);
            continue;
          }

          // Get params from cache or parse them
          let params = this.paramCache.get(entry.fqn);
          if (!params) {
            try {
              const declDoc = await vscode.workspace.openTextDocument(entry.uri);
              if (token.isCancellationRequested) break;
              const sig = readSignature(declDoc, entry);
              params = sig ? parseParams(sig) : [];
              this.log.debug(`[InlayHints] pass1 — ${entry.fqn} sig="${sig}" params=[${params.map(p => p.name).join(', ')}]`);
            } catch (err) {
              this.log.warn(`[InlayHints] pass1 — openTextDocument failed for ${entry.fqn}: ${err}`);
              params = [];
            }
            this.paramCache.set(entry.fqn, params);
          }

          if (params.length === 0) {
            this.log.debug(`[InlayHints] pass1 line ${lineNum} — ${name}() → 0 params, skip`);
            continue;
          }

          // Find all arguments inside the call parens
          const argPositions = findArgPositions(document, lineNum, parenOffset, params.length);
          if (argPositions.length === 0) {
            this.log.debug(`[InlayHints] pass1 line ${lineNum} — ${name}() → 0 arg positions found`);
            continue;
          }

          // Emit one hint per argument, skipping named args and trailing lambdas
          let emitted = 0;
          for (let i = 0; i < Math.min(argPositions.length, params.length); i++) {
            const argPos = argPositions[i];
            if (!argPos) continue;

            // Skip if argument is already named: `foo(x = value)`
            const argText = getArgText(document, argPos, i, argPositions);
            if (isNamedArg(argText)) {
              this.log.debug(`[InlayHints] pass1 line ${lineNum} — ${name}() arg[${i}] named, skip`);
              continue;
            }

            const param = params[i];
            const labelPart = new vscode.InlayHintLabelPart(`${param.name}:`);
            labelPart.location = new vscode.Location(
              entry.uri,
              new vscode.Position(entry.line, entry.character),
            );
            labelPart.tooltip = new vscode.MarkdownString(`**${param.name}**: \`${param.type}\``);

            const hint = new vscode.InlayHint(
              argPos,
              [labelPart],
              vscode.InlayHintKind.Parameter,
            );
            hint.paddingRight = true;
            hints.push(hint);
            emitted++;
          }
          if (emitted > 0) {
            this.log.debug(`[InlayHints] pass1 line ${lineNum} — ${name}() → ${emitted} param hint(s) emitted`);
          }
        }
      }

      // ── Pass 2: inferred type hints on untyped val/var ───────────────────
      if (showInferredTypes && isDecl) {
        const valMatch = VAL_VAR_RE.exec(text);
        if (!valMatch) {
          this.log.debug(`[InlayHints] pass2 line ${lineNum} — isDecl=true but VAL_VAR_RE no match (fun/class/etc)`);
        } else {
          const varName = valMatch[2];
          const rhs     = valMatch[3];
          this.log.debug(`[InlayHints] pass2 line ${lineNum} — VAL_VAR_RE match: varName="${varName}" rhs="${rhs.slice(0, 60)}"`);

          // Find the first function/constructor call on the RHS
          CALL_RE.lastIndex = 0;
          const callMatch = CALL_RE.exec(rhs);
          if (!callMatch) {
            this.log.debug(`[InlayHints] pass2 line ${lineNum} — no CALL_RE match in rhs (literal or no-paren expr)`);
          } else if (callMatch[1].length < 2) {
            this.log.debug(`[InlayHints] pass2 line ${lineNum} — callName="${callMatch[1]}" too short (<2), skip`);
          } else {
            const callName = callMatch[1];

            // Compute call offset precisely: rhs starts at (matchStr.length - rhs.length)
            // since VAL_VAR_RE captures rhs as (.+)$ — it always ends the match string.
            const rhsOffset = valMatch[0].length - rhs.length;
            const callOffset = rhsOffset + callMatch.index;

            if (isInsideCommentOrString(text, callOffset)) {
              this.log.debug(`[InlayHints] pass2 line ${lineNum} — "${callName}" is inside string/comment, skip`);
            } else {
              const entry = this.resolveCallEntry(callName, document);
              if (!entry) {
                this.log.debug(`[InlayHints] pass2 line ${lineNum} — resolveCallEntry("${callName}") → undefined (unknown or ambiguous)`);
              } else {
                this.log.debug(`[InlayHints] pass2 line ${lineNum} — resolveCallEntry("${callName}") → fqn=${entry.fqn}`);

                // Get return type from cache (null = cached miss, undefined = not cached)
                if (!this.returnTypeCache.has(entry.fqn)) {
                  let rt: string | null = null;
                  try {
                    const declDoc = await vscode.workspace.openTextDocument(entry.uri);
                    if (!token.isCancellationRequested) {
                      const sig = readSignature(declDoc, entry);
                      rt = sig ? extractReturnType(sig) : null;
                      this.log.debug(`[InlayHints] pass2 — ${entry.fqn} sig="${sig}" extractReturnType="${rt}"`);
                    }
                  } catch (err) {
                    this.log.warn(`[InlayHints] pass2 — openTextDocument failed for ${entry.fqn}: ${err}`);
                  }
                  this.returnTypeCache.set(entry.fqn, rt);
                }

                const returnType = this.returnTypeCache.get(entry.fqn);
                if (!returnType) {
                  this.log.debug(`[InlayHints] pass2 line ${lineNum} — returnType is null for ${entry.fqn} (Unit/Nothing/no-fun), skip`);
                } else {
                  // Compute varName column precisely within the match string
                  // (avoids double-indexOf which can match wrong occurrences)
                  const matchStr   = valMatch[0];
                  const kwEnd      = matchStr.indexOf(valMatch[1]) + valMatch[1].length;
                  const varNameCol = matchStr.indexOf(varName, kwEnd);

                  if (varNameCol === -1) {
                    this.log.warn(`[InlayHints] pass2 line ${lineNum} — varNameCol not found for "${varName}" in matchStr, skip`);
                  } else {
                    const hintPos = new vscode.Position(lineNum, varNameCol + varName.length);

                    const labelPart = new vscode.InlayHintLabelPart(`: ${returnType}`);
                    labelPart.location = new vscode.Location(
                      entry.uri,
                      new vscode.Position(entry.line, entry.character),
                    );

                    const hint = new vscode.InlayHint(hintPos, [labelPart], vscode.InlayHintKind.Type);
                    hint.paddingLeft = true;
                    hint.textEdits = [vscode.TextEdit.insert(hintPos, `: ${returnType}`)];
                    hints.push(hint);
                    this.log.debug(`[InlayHints] pass2 line ${lineNum} — ✓ hint emitted: "${varName}" → ": ${returnType}" at col ${hintPos.character}`);
                  }
                }
              }
            }
          }
        }
      }
    }

    this.log.debug(`[InlayHints] provideInlayHints done — ${hints.length} hint(s) total`);
    return hints;
  }

  // Resolves a call name to a single unambiguous SymbolEntry (fun/composable/class/dataClass).
  // Returns undefined when the name is ambiguous or unknown.
  private resolveCallEntry(name: string, document: vscode.TextDocument): SymbolEntry | undefined {
    const resolved = resolveBest(name, document, fqn => this.index.lookupFqn(fqn));
    if (resolved.matches.length === 1) return resolved.matches[0];
    if (resolved.matches.length > 1) return undefined; // ambiguous

    const hits = this.index.lookup(name).filter(e => CALL_KINDS.has(e.kind as any));
    return hits.length === 1 ? hits[0] : undefined;
  }
}

// Finds the start positions of each argument inside `foo(arg1, arg2)`.
// `parenOffset` is the column of `(` on `lineNum`.
// Returns an array of vscode.Position, one per argument.
function findArgPositions(
  document: vscode.TextDocument,
  startLine: number,
  parenOffset: number,
  maxArgs: number,
): vscode.Position[] {
  const positions: vscode.Position[] = [];
  let depth = 0;
  let argStarted = false;

  // Scan up to 20 lines forward to handle multi-line calls
  const scanEnd = Math.min(startLine + 20, document.lineCount);

  for (let ln = startLine; ln < scanEnd; ln++) {
    const text = document.lineAt(ln).text;
    const startCol = ln === startLine ? parenOffset : 0;

    for (let col = startCol; col < text.length; col++) {
      const ch = text[col];

      if (ch === '(' || ch === '[' || ch === '{') {
        if (depth === 0 && ch === '(') {
          depth = 1;
          argStarted = false;
          continue;
        }
        depth++;
        if (!argStarted) {
          argStarted = true;
          positions.push(new vscode.Position(ln, col));
        }
        continue;
      }

      if (ch === ')' || ch === ']' || ch === '}') {
        if (depth === 1 && ch === ')') {
          return positions; // done
        }
        depth--;
        continue;
      }

      if (depth !== 1) continue;

      if (ch === ',') {
        argStarted = false;
        continue;
      }

      // First non-whitespace character of a new argument
      if (!argStarted && ch !== ' ' && ch !== '\t') {
        argStarted = true;
        positions.push(new vscode.Position(ln, col));
        if (positions.length >= maxArgs) return positions;
      }
    }
  }

  return positions;
}

// Gets the text of argument `i` from its start position to the next argument start.
function getArgText(
  document: vscode.TextDocument,
  argPos: vscode.Position,
  argIndex: number,
  allPositions: vscode.Position[],
): string {
  const line = document.lineAt(argPos.line).text;
  const nextPos = allPositions[argIndex + 1];

  if (nextPos && nextPos.line === argPos.line) {
    return line.slice(argPos.character, nextPos.character);
  }

  // Single line: take to end of line (rough approximation for named-arg check)
  return line.slice(argPos.character, Math.min(argPos.character + 60, line.length));
}

// Checks if the argument text starts with `name = ` (named argument syntax).
function isNamedArg(argText: string): boolean {
  return /^\s*[A-Za-z_]\w*\s*=(?!=)/.test(argText);
}

// Counts the number of `"""` occurrences in a line (each toggles raw-string state).
function countTripleQuotes(s: string): number {
  let count = 0, i = 0;
  while (i <= s.length - 3) {
    if (s[i] === '"' && s[i + 1] === '"' && s[i + 2] === '"') { count++; i += 3; }
    else i++;
  }
  return count;
}
