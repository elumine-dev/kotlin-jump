import * as vscode from 'vscode';
import { RResourceIndex } from '../indexer/RResourceIndex';

// Matches `name="key"` inside a resource tag
const RE_NAME_ATTR = /name="([A-Za-z_]\w*)"/g;

// Resource tag types on the current line → R class type
const TAG_TYPE_MAP: Array<[RegExp, 'string' | 'plurals' | 'array']> = [
  [/<plurals\b/, 'plurals'],
  [/<string-array\b/, 'array'],
  [/<string\b/, 'string'],
];

// Finds where the cursor is over a name="key" attribute in a resource XML line.
// Returns { key, rType } or null if no match.
// Skips attributes that appear inside an XML comment (<!-- ... -->).
function detectResourceAtPosition(
  lineText: string,
  character: number,
): { key: string; rType: 'string' | 'plurals' | 'array' } | null {
  // Build a comment-masked version of the line for tag-type detection,
  // and track comment spans to exclude name= attributes inside them.
  const commentSpans: Array<[number, number]> = [];
  const RE_COMMENT = /<!--[\s\S]*?-->/g;
  let cm: RegExpExecArray | null;
  while ((cm = RE_COMMENT.exec(lineText))) {
    commentSpans.push([cm.index, cm.index + cm[0].length]);
  }

  const isInComment = (pos: number) =>
    commentSpans.some(([s, e]) => pos >= s && pos < e);

  // Build a version of the line with comments blanked out — used for tag detection
  // so that tag names inside a comment don't trigger false positives.
  const maskedLine = commentSpans.length === 0 ? lineText
    : lineText.replace(/<!--[\s\S]*?-->/g, m => ' '.repeat(m.length));

  RE_NAME_ATTR.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = RE_NAME_ATTR.exec(lineText))) {
    const attrStart = m.index;
    const attrEnd   = attrStart + m[0].length;
    if (character < attrStart || character >= attrEnd) continue;
    if (isInComment(attrStart)) continue; // attribute is inside a comment — skip

    for (const [tagRe, rType] of TAG_TYPE_MAP) {
      if (tagRe.test(maskedLine)) return { key: m[1], rType };
    }
    return null; // name attr present but not a recognised resource tag
  }
  return null;
}

export class StringXmlDefinitionProvider implements vscode.DefinitionProvider {
  constructor(private readonly rIndex: RResourceIndex) {}

  provideDefinition(
    document: vscode.TextDocument,
    position: vscode.Position,
  ): vscode.Location[] {
    // Only process Android resource XML files
    if (!document.uri.path.includes('/res/')) return [];

    const lineText = document.lineAt(position.line).text;
    const hit = detectResourceAtPosition(lineText, position.character);
    if (!hit) return [];

    const { key, rType } = hit;
    const matchLen = `R.${rType}.${key}`.length;

    return this.rIndex.getUsages(rType, key).map(e =>
      new vscode.Location(
        vscode.Uri.parse(e.uri),
        new vscode.Range(
          new vscode.Position(e.line, e.character),
          new vscode.Position(e.line, e.character + matchLen),
        ),
      )
    );
  }
}
