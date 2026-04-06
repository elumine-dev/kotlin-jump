import * as vscode from 'vscode';
import { SymbolIndex } from '../indexer/SymbolIndex';
import { resolveBest } from '../util/ImportResolver';
import { readSignature, parseParams, KtParam } from '../util/SignatureReader';
import { isInsideCommentOrString } from '../util/textUtils';

// Matches a potential function/constructor call: lowercase-or-uppercase word followed by `(`
// We match both cases because constructors start with uppercase (e.g. `Column(`)
const CALL_RE = /\b([A-Za-z_]\w*)\s*\(/g;

export class KotlinInlayHintsProvider implements vscode.InlayHintsProvider {
  // Cache: fqn → parsed params (avoids reopening declaration docs on every keystroke)
  private readonly paramCache = new Map<string, KtParam[]>();

  constructor(private readonly index: SymbolIndex) {}

  async provideInlayHints(
    document: vscode.TextDocument,
    range: vscode.Range,
    token: vscode.CancellationToken,
  ): Promise<vscode.InlayHint[]> {
    const hints: vscode.InlayHint[] = [];

    // Track raw-string state across lines (""" toggles in/out of raw string)
    let inRawString = false;

    for (let lineNum = range.start.line; lineNum <= range.end.line; lineNum++) {
      if (token.isCancellationRequested) break;

      const line = document.lineAt(lineNum);
      const text = line.text;

      // Count """ occurrences on this line to toggle raw-string state
      const tripleCount = countTripleQuotes(text);
      if (inRawString) {
        if (tripleCount % 2 !== 0) inRawString = false;
        continue; // skip lines inside raw strings
      }
      if (tripleCount % 2 !== 0) inRawString = true;

      // Skip declaration lines — no hints on `fun foo(` itself (including with leading modifiers)
      if (/^\s*(?:(?:public|private|protected|internal|override|open|abstract|sealed|inline|suspend|operator|infix|external|actual|expect|companion|data|inner|noinline|crossinline|tailrec|lateinit|const)\s+)*(?:fun|class|data\s+class|object|interface|abstract\s+class|sealed\s+class|enum\s+class|annotation\s+class|typealias|val|var)\s/.test(text)) continue;
      // Skip comment lines
      if (/^\s*(\/\/|\/\*|\*)/.test(text)) continue;

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

        // Resolve the function entry
        const entry = (() => {
          const resolved = resolveBest(name, document, fqn => this.index.lookupFqn(fqn));
          if (resolved.matches.length === 1) return resolved.matches[0];
          if (resolved.matches.length > 1) return undefined; // ambiguous

          const hits = this.index.lookup(name).filter(
            e => e.kind === 'fun' || e.kind === 'composable' || e.kind === 'class' || e.kind === 'dataClass',
          );
          return hits.length === 1 ? hits[0] : undefined;
        })();

        if (!entry) continue;

        // Get params from cache or parse them
        let params = this.paramCache.get(entry.fqn);
        if (!params) {
          try {
            const declDoc = await vscode.workspace.openTextDocument(entry.uri);
            if (token.isCancellationRequested) break;
            const sig = readSignature(declDoc, entry);
            params = sig ? parseParams(sig) : [];
          } catch {
            params = [];
          }
          this.paramCache.set(entry.fqn, params);
        }

        if (params.length === 0) continue;

        // Find all arguments inside the call parens
        const argPositions = findArgPositions(document, lineNum, parenOffset, params.length);
        if (argPositions.length === 0) continue;

        // Emit one hint per argument, skipping named args and trailing lambdas
        for (let i = 0; i < Math.min(argPositions.length, params.length); i++) {
          const argPos = argPositions[i];
          if (!argPos) continue;

          // Skip if argument is already named: `foo(x = value)`
          const argText = getArgText(document, argPos, i, argPositions, lineNum, parenOffset);
          if (isNamedArg(argText)) continue;

          const param = params[i];
          const labelPart = new vscode.InlayHintLabelPart(`${param.name}:`);
          labelPart.location = new vscode.Location(
            entry.uri,
            new vscode.Position(entry.line, entry.character),
          );
          labelPart.tooltip = new vscode.MarkdownString(`**${param.name}**: \`${param.type}\``);

          const hint = new vscode.InlayHint(
            [labelPart],
            argPos,
            vscode.InlayHintKind.Parameter,
          );
          hint.paddingRight = true;
          hints.push(hint);
        }
      }
    }

    return hints;
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

      if (ch === ',' ) {
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

// Gets the text of argument `i` from its start position to the next comma or closing paren.
function getArgText(
  document: vscode.TextDocument,
  argPos: vscode.Position,
  argIndex: number,
  allPositions: vscode.Position[],
  _callLine: number,
  _parenOffset: number,
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
