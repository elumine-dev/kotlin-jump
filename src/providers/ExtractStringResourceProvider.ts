import * as vscode from 'vscode';
import { StringResourceIndex } from '../indexer/StringResourceIndex';

/**
 * KJ-005: Extract string resource, a quick fix that moves a literal into
 * strings.xml and replaces it with `stringResource(R.string.x)` (@Composable
 * context) or `R.string.x` (elsewhere). Companion to the KJ-004 lint.
 */

const MAX_NAME_LENGTH = 40;

/** snake_case name derived from the literal, unique against `existing`. */
export function suggestResourceName(literal: string, existing: Set<string>): string {
  const base = literal
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // diacritics
    .toLowerCase()
    .replace(/%\d*\$?[sdf]/g, ' ')   // placeholders kept out of the name
    .replace(/\$\{[^}]+\}/g, ' ')    // Kotlin templates kept out of the name too
    .replace(/\$\w+/g, ' ')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .replace(/_{2,}/g, '_');

  let name = base;
  if (name.length > MAX_NAME_LENGTH) {
    // cut at the last underscore before the limit (never mid-word)
    const cut = name.slice(0, MAX_NAME_LENGTH + 1);
    const lastSep = cut.lastIndexOf('_');
    name = lastSep > 0 ? cut.slice(0, lastSep) : cut.slice(0, MAX_NAME_LENGTH);
  }
  if (name.length === 0) name = 'extracted_string';
  if (/^\d/.test(name)) name = `s_${name}`;

  if (!existing.has(name)) return name;
  for (let i = 2; ; i++) {
    const candidate = `${name}_${i}`;
    if (!existing.has(candidate)) return candidate;
  }
}

/** Android strings.xml escaping: &, <, apostrophes, quotes. */
export function escapeForStringsXml(literal: string): string {
  const escaped = literal
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    // Same guard as the quote rule below: a Kotlin literal may already carry
    // an escaped apostrophe, and escaping it again wrote two backslashes into
    // strings.xml, so the app showed a stray backslash. Measured on a real
    // project: 2 of its 10624 template-free literals, across 9 files.
    .replace(/(?<!\\)'/g, "\\'")
    .replace(/(?<!\\)"/g, '\\"');
  // A leading `@` or `?` makes aapt read a resource reference.
  return /^[@?]/.test(escaped) ? '\\' + escaped : escaped;
}

/** Converts Kotlin templates (`$var`, `${expr}`) into positional Android
 *  placeholders: the XML value gets `%1$s`, and the expressions become the
 *  arguments at the call site. */
export function extractTemplateArgs(literal: string): { xmlValue: string; args: string[] } {
  const args: string[] = [];
  // `\$` is a literal dollar, not a template: "Price: \$100" was turned
  // into "Price: %1$s" with a bogus `100` argument.
  // A bare template starts with a letter: `"Price: $100"` is a literal.
  const TEMPLATE_RE = /(?<!\\)\$\{([^}]+)\}|(?<!\\)\$([A-Za-z_]\w*)/g;
  const hasTemplate = TEMPLATE_RE.test(literal);
  TEMPLATE_RE.lastIndex = 0;
  // With positional arguments, a literal `%` must be `%%` or aapt refuses
  // the mix of positional and non-positional substitutions.
  const source = hasTemplate ? literal.replace(/%/g, '%%') : literal;
  const xmlValue = source
    .replace(TEMPLATE_RE, (_m, braced, bare) => {
      args.push((braced ?? bare).trim());
      return `%${args.length}$s`;
    })
    .replace(/\\\$/g, '$');
  return { xmlValue, args };
}

/** Replacement text for the literal, depending on the call context.
 *  When there are arguments (coming from templates), stringResource/getString
 *  receives them as varargs. */
export function buildReplacement(
  literal: string,
  resName: string,
  context: 'composable' | 'code',
  args: string[] = [],
  resIdOnly = true,
): string {
  const argList = args.length > 0 ? `, ${args.join(', ')}` : '';
  if (context === 'composable') return `stringResource(R.string.${resName}${argList})`;
  if (args.length > 0) return `context.getString(R.string.${resName}${argList})`;
  // `val s = R.string.x` is an Int where a String was: only a resId setter
  // (`setText`, `setTitle`…) takes the bare id.
  return resIdOnly ? `R.string.${resName}` : `getString(R.string.${resName})`;
}

const RES_ID_SETTER_RE = /\b(?:setText|setHint|setTitle|setSubtitle|setContentDescription|setError|setMessage|setPositiveButton|setNegativeButton|setNeutralButton|setTitleText|setHelperText)\s*\($/;

/** True when the literal at `litStart` is the direct argument of a setter that accepts a resource id. */
export function isResIdSetterArgument(lineText: string, litStart: number): boolean {
  return RES_ID_SETTER_RE.test(lineText.slice(0, litStart).replace(/\s+$/, ''));
}

/** `onClick = { showSnackbar("Saved!") }`: the literal sits in an event lambda, which is not a composable scope. */
export function insideHandlerLambda(lineText: string, litStart: number): boolean {
  const before = lineText.slice(0, litStart);
  const m = /\bon[A-Z]\w*\s*=\s*\{[^}]*$/.exec(before);
  return m !== null;
}

/** Is the cursor inside the body of a @Composable function? */
export function isComposableContext(lines: string[], lineNum: number): boolean {
  const FUN_DECL =
    /^\s*(?:@\w+(?:\([^)]*\))?\s+)*(?:(?:public|private|internal|protected|override|inline|suspend)\s+)*fun\s/;
  for (let i = lineNum; i >= 0; i--) {
    if (FUN_DECL.test(lines[i])) {
      // Walk the annotations above, including one whose arguments span
      // lines (`@Preview(\n showBackground = true\n)`), which hid @Composable.
      let parens = 0;
      for (let j = i - 1; j >= Math.max(0, i - 15); j--) {
        const t = lines[j].trim();
        if (t.length === 0) continue;
        parens += (t.match(/\)/g)?.length ?? 0) - (t.match(/\(/g)?.length ?? 0);
        if (t.startsWith('@') && parens <= 0) {
          parens = 0;
          if (/@Composable\b/.test(t)) return true;
          continue;
        }
        if (parens > 0) continue;
        break;
      }
      // annotation on the same line: `@Composable fun X()`
      return /@Composable\s/.test(lines[i]);
    }
  }
  return false;
}

const STRING_LITERAL_RE = /"((?:[^"\\\n]|\\.)*)"/g;

/** Plain literals of a line, `${ … }` templates included even when they hold quotes. */
function plainLiterals(lineText: string): { start: number; end: number; literal: string }[] {
  const out: { start: number; end: number; literal: string }[] = [];
  let i = 0;
  while (i < lineText.length) {
    if (lineText.startsWith('"""', i)) { const close = lineText.indexOf('"""', i + 3); i = close === -1 ? lineText.length : close + 3; continue; }
    if (lineText[i] !== '"') { i++; continue; }
    const start = i;
    let depth = 0;
    let j = i + 1;
    for (; j < lineText.length; j++) {
      const ch = lineText[j];
      if (ch === '\\') { j++; continue; }
      if (depth > 0) {
        if (ch === '{') depth++;
        else if (ch === '}') depth--;
        else if (ch === '"') { const c = lineText.indexOf('"', j + 1); if (c === -1) break; j = c; }
        continue;
      }
      if (ch === '$' && lineText[j + 1] === '{') { depth = 1; j++; continue; }
      if (ch === '"') break;
    }
    if (j >= lineText.length) break;
    out.push({ start, end: j + 1, literal: lineText.slice(start + 1, j) });
    i = j + 1;
  }
  return out;
}
// Single-line raw string. The plain matcher saw `"""Hello"""` as `""`,
// `"Hello"`, `""` and replaced only the middle one: `""stringResource(…)""`.
const RAW_LITERAL_RE = /"""([\s\S]*?)"""/g;

/** String literal UNDER the cursor, not just the first one on the line. */
export function literalAtPosition(
  lineText: string,
  character: number,
): { literal: string; start: number; length: number; raw?: boolean } | null {
  RAW_LITERAL_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = RAW_LITERAL_RE.exec(lineText)) !== null) {
    if (character >= m.index && character <= m.index + m[0].length) {
      return { literal: m[1], start: m.index, length: m[0].length, raw: true };
    }
  }
  for (const lit of plainLiterals(lineText)) {
    if (character >= lit.start && character <= lit.end) {
      return { literal: lit.literal, start: lit.start, length: lit.end - lit.start };
    }
  }
  STRING_LITERAL_RE.lastIndex = 0;
  while ((m = STRING_LITERAL_RE.exec(lineText)) !== null) {
    if (character >= m.index && character <= m.index + m[0].length) {
      return { literal: m[1], start: m.index, length: m[0].length };
    }
  }
  return null;
}

export class ExtractStringResourceProvider implements vscode.CodeActionProvider {
  static readonly ACTION_TITLE = 'Extract string resource';

  constructor(private readonly stringIndex: StringResourceIndex) {}

  async provideCodeActions(
    document: vscode.TextDocument,
    range: vscode.Range | vscode.Selection,
  ): Promise<vscode.CodeAction[]> {
    const cfg = vscode.workspace.getConfiguration('kotlinJump');
    if (!cfg.get<boolean>('extractStringResource', true)) return [];
    if (document.languageId !== 'kotlin' && document.languageId !== 'java') return [];

    const line = document.lineAt(range.start.line).text;
    const hit = literalAtPosition(line, range.start.character);
    if (!hit || hit.literal.length === 0) return [];
    const litStart = hit.start;
    const m: { 0: string; 1: string } = { 0: line.slice(hit.start, hit.start + hit.length), 1: hit.literal };

    const existing = new Set<string>(this.stringIndex.allKeys());
    // Java has no string templates: `"Total: $amount"` is the text itself.
    const { xmlValue, args } = document.languageId === 'java'
      ? { xmlValue: m[1], args: [] as string[] }
      : extractTemplateArgs(m[1]);
    const resName = suggestResourceName(m[1], existing);

    const targetXml = this.pickTargetStringsXml(document.uri);
    if (!targetXml) return [];

    const lines = document.getText().split('\n');
    const context = isComposableContext(lines, range.start.line) && !insideHandlerLambda(line, litStart) ? 'composable' : 'code';
    const resIdOnly = isResIdSetterArgument(line, litStart);

    const action = new vscode.CodeAction(
      `${ExtractStringResourceProvider.ACTION_TITLE} → R.string.${resName}`,
      vscode.CodeActionKind.RefactorExtract,
    );
    action.edit = new vscode.WorkspaceEdit();

    // 1. replace the literal (templates become arguments)
    action.edit.replace(
      document.uri,
      new vscode.Range(range.start.line, litStart, range.start.line, litStart + m[0].length),
      buildReplacement(m[1], resName, context, args, resIdOnly),
    );

    // 2. insert into strings.xml (before </resources>)
    const xmlDoc = await vscode.workspace.openTextDocument(targetXml);
    const xmlText = xmlDoc.getText();
    const closeIdx = xmlText.lastIndexOf('</resources>');
    if (closeIdx < 0) return [];
    const insertPos = xmlDoc.positionAt(closeIdx);
    action.edit.insert(
      targetXml,
      insertPos,
      `    <string name="${resName}">${escapeForStringsXml(xmlValue)}</string>\n`,
    );

    // Save strings.xml after the edit: without it the watcher does not
    // reindex and the "Cannot resolve" diagnostic stays stale on the new ref.
    action.command = {
      command: 'kotlin-jump.extractString.saveTarget',
      title: 'Save strings.xml',
      arguments: [targetXml],
    };

    return [action];
  }

  /** Base strings.xml (values/) closest to the edited file. */
  private pickTargetStringsXml(from: vscode.Uri): vscode.Uri | undefined {
    const candidates = this.stringIndex.baseFiles() as vscode.Uri[];
    if (candidates.length === 0) return undefined;
    if (candidates.length === 1) return candidates[0];
    // multi-module: longest common path prefix with the source file
    const fromPath = from.fsPath;
    let best = candidates[0];
    let bestLen = -1;
    for (const c of candidates) {
      const prefix = commonPrefixLength(fromPath, c.fsPath);
      if (prefix > bestLen) {
        bestLen = prefix;
        best = c;
      }
    }
    return best;
  }
}

function commonPrefixLength(a: string, b: string): number {
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  return i;
}
