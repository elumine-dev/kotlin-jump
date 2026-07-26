import * as vscode from 'vscode';
import { isInsideCommentOrString } from '../util/textUtils';

export interface NamedArgParam {
  name: string;
  isVararg?: boolean;
}

/** Resolves a callee (by simple name + arity) to its declared parameters.
 *  Sync in unit tests; the extension wires an async SymbolIndex-backed one. */
export type ParamResolver = (
  callee: string,
  arity: number,
) => { params: NamedArgParam[] } | null | Promise<{ params: NamedArgParam[] } | null>;

/**
 * Splits the inside of a call's parentheses into top-level arguments.
 * Commas nested in strings, char literals, parens/brackets/braces or
 * string templates (`${…}`) never split.
 */
export function splitTopLevelArguments(argListText: string): string[] {
  const args: string[] = [];
  let depth = 0;
  let start = 0;
  let inString: '"' | "'" | 'raw' | null = null;
  let templateDepth = 0;

  for (let i = 0; i < argListText.length; i++) {
    const ch = argListText[i];

    if (inString) {
      if (ch === '\\' && inString !== 'raw') {
        i++; // skip escaped char
        continue;
      }
      if (templateDepth > 0) {
        if (ch === '{') templateDepth++;
        else if (ch === '}') templateDepth--;
        continue;
      }
      if (ch === '$' && argListText[i + 1] === '{') {
        templateDepth = 1;
        i++;
        continue;
      }
      if (inString === 'raw' && argListText.startsWith('"""', i)) {
        inString = null;
        i += 2;
      } else if (inString === ch) {
        inString = null;
      }
      continue;
    }

    if (argListText.startsWith('"""', i)) {
      inString = 'raw';
      i += 2;
      continue;
    }
    if (ch === '"' || ch === "'") {
      inString = ch;
      continue;
    }
    if (ch === '(' || ch === '[' || ch === '{') depth++;
    else if (ch === ')' || ch === ']' || ch === '}') depth--;
    else if (ch === ',' && depth === 0) {
      args.push(argListText.slice(start, i).trim());
      start = i + 1;
    }
  }

  const last = argListText.slice(start).trim();
  if (last.length > 0 || args.length > 0) {
    if (last.length > 0) args.push(last);
  }
  return args;
}

/** `name = value` (but not `==`) → argument already named. */
function isNamedArgument(arg: string): boolean {
  return /^[A-Za-z_]\w*\s*=(?!=)/.test(arg.trim());
}

interface ParsedCall {
  head: string;       // text before `(` (optional receiver + name)
  callee: string;     // last identifier before `(`
  args: string[];
  trailing: string;   // text after `)`: trailing lambda included, verbatim
  hasTrailingLambda: boolean;
}

function parseCall(callText: string): ParsedCall | null {
  const headMatch = /^(\s*(?:[\w.?]+\.)?([A-Za-z_]\w*)\s*)\(/.exec(callText);
  if (!headMatch) return null;

  const openIndex = headMatch[1].length;
  // Find the matching closing paren by reusing the splitter: scan with the
  // same state machine.
  let depth = 0;
  let inString: '"' | "'" | 'raw' | null = null;
  let close = -1;
  for (let i = openIndex; i < callText.length; i++) {
    const ch = callText[i];
    if (inString) {
      if (ch === '\\' && inString !== 'raw') { i++; continue; }
      if (inString === 'raw' && callText.startsWith('"""', i)) { inString = null; i += 2; }
      else if (inString === ch) inString = null;
      continue;
    }
    if (callText.startsWith('"""', i)) { inString = 'raw'; i += 2; continue; }
    if (ch === '"' || ch === "'") { inString = ch; continue; }
    if (ch === '(') depth++;
    else if (ch === ')') {
      depth--;
      if (depth === 0) { close = i; break; }
    }
  }
  if (close < 0) return null;

  const trailing = callText.slice(close + 1);
  return {
    head: callText.slice(0, openIndex),
    callee: headMatch[2],
    args: splitTopLevelArguments(callText.slice(openIndex + 1, close)),
    trailing,
    hasTrailingLambda: /^\s*\{/.test(trailing),
  };
}

export class NamedArgumentsActionProvider implements vscode.CodeActionProvider {
  static readonly ACTION_TITLE = 'Add names to call arguments';

  constructor(private readonly resolve: ParamResolver) {}

  /**
   * Pure core of the refactoring: returns the call text with the `name =`
   * prefixes inserted, or null when the action does not apply (unknown
   * callee, everything already named, no nameable argument).
   */
  buildNamedCall(callText: string): string | null {
    const parsed = parseCall(callText);
    if (!parsed) return null;

    const arity = parsed.args.length + (parsed.hasTrailingLambda ? 1 : 0);
    const resolved = this.resolve(parsed.callee, arity);
    // Sync contract: an async resolver cannot serve the pure path.
    if (!resolved || resolved instanceof Promise) return null;
    return this.buildFrom(parsed, resolved);
  }

  private buildFrom(parsed: ParsedCall, resolved: { params: NamedArgParam[] }): string | null {
    const { params } = resolved;
    let changed = false;
    let varargReached = false;

    const named = parsed.args.map((arg, i) => {
      const param = params[i];
      if (!param || varargReached) return arg;
      if (param.isVararg) {
        varargReached = true;
        return arg;
      }
      if (isNamedArgument(arg)) return arg;
      changed = true;
      return `${param.name} = ${arg}`;
    });

    if (!changed) return null;
    return `${parsed.head}(${named.join(', ')})${parsed.trailing}`;
  }

  async provideCodeActions(
    document: vscode.TextDocument,
    range: vscode.Range | vscode.Selection,
  ): Promise<vscode.CodeAction[]> {
    const line = document.lineAt(range.start.line).text;
    const cursor = range.start.character;

    // Candidate call: the innermost one whose parentheses contain the
    // cursor (v1: calls that fit on a single line).
    const callRe = /\b(?:[\w.?]+\.)?[A-Za-z_]\w*\s*\(/g;
    let best: { start: number; text: string } | null = null;
    let m: RegExpExecArray | null;
    while ((m = callRe.exec(line)) !== null) {
      if (isInsideCommentOrString(line, m.index)) continue;
      const parsedLen = spanLength(line.slice(m.index));
      if (parsedLen < 0) continue;
      const end = m.index + parsedLen;
      if (cursor >= m.index && cursor <= end && (!best || m.index > best.start)) {
        best = { start: m.index, text: line.slice(m.index, end) };
      }
    }
    if (!best) return [];

    const parsed = parseCall(best.text);
    if (!parsed) return [];
    const arity = parsed.args.length + (parsed.hasTrailingLambda ? 1 : 0);
    const resolved = await Promise.resolve(this.resolve(parsed.callee, arity));
    if (!resolved) return [];
    const rewritten = this.buildFrom(parsed, resolved);
    if (!rewritten) return [];

    const action = new vscode.CodeAction(
      NamedArgumentsActionProvider.ACTION_TITLE,
      vscode.CodeActionKind.RefactorRewrite,
    );
    action.edit = new vscode.WorkspaceEdit();
    action.edit.replace(
      document.uri,
      new vscode.Range(range.start.line, best.start, range.start.line, best.start + best.text.length),
      rewritten,
    );
    return [action];
  }
}

/** Length of the whole call (matched parentheses + attached trailing lambda). */
function spanLength(span: string): number {
  const parsed = parseCall(span);
  if (!parsed) return -1;
  let len = parsed.head.length + 1; // head + '('
  len += parsed.args.join(', ').length; // approximation; exact recomputation below
  // Exact recomputation: find the matching closing paren.
  let depth = 0;
  let inString: '"' | "'" | null = null;
  for (let i = parsed.head.length; i < span.length; i++) {
    const ch = span[i];
    if (inString) {
      if (ch === '\\') { i++; continue; }
      if (ch === inString) inString = null;
      continue;
    }
    if (ch === '"' || ch === "'") { inString = ch; continue; }
    if (ch === '(') depth++;
    else if (ch === ')') {
      depth--;
      if (depth === 0) {
        let end = i + 1;
        const after = span.slice(end);
        const lambda = /^\s*\{/.exec(after);
        if (lambda) {
          // include the trailing lambda up to its matching brace
          let bDepth = 0;
          for (let j = end + after.indexOf('{'); j < span.length; j++) {
            if (span[j] === '{') bDepth++;
            else if (span[j] === '}') {
              bDepth--;
              if (bDepth === 0) return j + 1;
            }
          }
          return span.length;
        }
        return end;
      }
    }
  }
  return -1;
}
